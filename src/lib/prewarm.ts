import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { dictionaryEntries } from '#/db/schema'
import {
  readOpenAiApiKey,
  readTtsMockUrl,
  synthesizeSpeech,
  TTS_VOICE,
} from '#/lib/ai'
import { isDeepSeekConfigured, readDeepSeekConfig } from '#/lib/deepseek'
import { normalizeHeadword } from '#/lib/dictionary'
import {
  ensureEntry,
  loadEntries,
  needsBetterSenses,
  type EntriesDb,
  type Entry,
} from '#/lib/entries'
import type { LessonEnv } from '#/lib/generate-lesson'
import { CEFR_LEVELS, type CefrLevel } from '#/lib/settings'
import { poolEntry, poolLevel } from '#/lib/vocabulary'
import {
  describeWordTwice,
  readWorkersAi,
  serializeWordDetail,
} from '#/lib/word-detail'

/**
 * Define, speak and describe the whole vocabulary pool, ahead of anyone asking.
 *
 * The Explore feed shows words nobody in the app has necessarily met before,
 * and defining one costs a dictionary fetch plus a model call, speaking it
 * costs TTS, and writing its card costs twenty seconds of a large model —
 * seconds at best, half a minute at worst. Done on demand, every card in a
 * fresh feed would arrive blank and silent. The pool is fixed and small,
 * though, and all three are shared by every learner, so paying for all of it
 * once is a few dollars for a feed that never waits again.
 *
 * Everything here is skip-if-present, which makes the pass resumable: run it
 * again after adding words to the pool and it only does the new ones.
 */
export type PrewarmTally = {
  seen: number
  defined: number
  spoken: number
  described: number
  failed: number
}

export const EMPTY_TALLY: PrewarmTally = {
  seen: 0,
  defined: 0,
  spoken: 0,
  described: 0,
  failed: 0,
}

export function addTally(a: PrewarmTally, b: PrewarmTally): PrewarmTally {
  return {
    seen: a.seen + b.seen,
    defined: a.defined + b.defined,
    spoken: a.spoken + b.spoken,
    described: a.described + b.described,
    failed: a.failed + b.failed,
  }
}

/**
 * Words per step. Small enough that a step is a handful of seconds of network
 * waiting, large enough that the whole pool is a couple of hundred steps.
 */
export const PREWARM_BATCH = 20

/** In-flight lookups inside one batch, to stay polite to both providers. */
const CONCURRENCY = 4

export function prewarmPlan(levels: CefrLevel[] = [...CEFR_LEVELS]) {
  return levels.flatMap((level) => {
    const words = poolLevel(level).map((word) => word.headword)
    const batches: { level: CefrLevel; offset: number; words: string[] }[] = []
    for (let offset = 0; offset < words.length; offset += PREWARM_BATCH) {
      batches.push({
        level,
        offset,
        words: words.slice(offset, offset + PREWARM_BATCH),
      })
    }
    return batches
  })
}

async function inBatches<T>(items: T[], run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(run))
  }
}

function audioKeyFor(normalized: string) {
  return `word-audio/${TTS_VOICE}/${normalized}.mp3`
}

/**
 * Write the usage pattern, collocations and family for one word.
 *
 * Slow — twenty seconds is normal for a model this size — which is exactly why
 * it happens here rather than when someone opens a card.
 */
async function describe(
  env: LessonEnv,
  db: EntriesDb,
  entry: Entry | undefined,
  normalized: string,
) {
  const detail = await describeWordTwice({
    headword: entry?.headword ?? normalized,
    level: levelOf(normalized),
    ...readWorkersAi(env),
  })
  if (!detail) return false

  await db
    .update(dictionaryEntries)
    .set({ detail: serializeWordDetail(detail) })
    .where(eq(dictionaryEntries.normalized, normalized))
  return true
}

/**
 * The level to pitch the card at.
 *
 * Words the pool has never carried are the ones a learner typed in themselves,
 * and B1 is the middle of the range rather than a guess about them.
 */
function levelOf(normalized: string): CefrLevel {
  return poolEntry(normalized)?.level ?? 'B1'
}

/**
 * Bring one batch of headwords up to date.
 *
 * The three phases are separable because they fail differently and cost
 * differently: definitions come from DeepSeek and the free dictionary, audio
 * from OpenAI, cards from Workers AI, and a run that only wants to fill in one
 * of them should be able to say so.
 */
export async function prewarmBatch(
  env: LessonEnv,
  headwords: string[],
  options: { speak?: boolean; describe?: boolean } = {},
): Promise<PrewarmTally> {
  const speak = options.speak ?? true
  const writeCards = options.describe ?? true
  const db = drizzle(env.DB, { schema }) as EntriesDb
  const config = isDeepSeekConfigured(env) ? readDeepSeekConfig(env) : null
  const normalized = headwords.map(normalizeHeadword)

  // A batch that cannot even read the table is a batch where every word is
  // looked up the slow way and probably fails; that is a tally to report, not
  // an exception to kill a two hour run with.
  const entries = await loadEntries(db, normalized).catch((error: unknown) => {
    console.error('prewarm: could not read entries', error)
    return new Map<string, Entry>()
  })

  const tally: PrewarmTally = { ...EMPTY_TALLY, seen: headwords.length }

  await inBatches(normalized, async (word) => {
    let entry = entries.get(word)
    try {
      if (needsBetterSenses(entry)) {
        entry = (await ensureEntry(db, word, config)) ?? entry
        tally.defined += 1
      }
    } catch (error) {
      tally.failed += 1
      console.error('prewarm: could not define', word, error)
    }

    // Skip-if-present, like everything else here, so a second run costs
    // nothing for the words a first one already wrote.
    if (writeCards && !entry?.detail) {
      try {
        if (await describe(env, db, entry, word)) tally.described += 1
      } catch (error) {
        tally.failed += 1
        console.error('prewarm: could not describe', word, error)
      }
    }

    if (!speak) return
    const key = audioKeyFor(word)
    if (entry?.audioKey === key) return
    try {
      const { audio, contentType } = await synthesizeSpeech({
        // The trailing period keeps the model from clipping the final
        // consonant, matching what the word-audio endpoint does.
        text: `${entry?.headword ?? word}.`,
        mockUrl: readTtsMockUrl(env),
        apiKey: readOpenAiApiKey(env),
      })
      await env.AUDIO.put(key, audio, { httpMetadata: { contentType } })
      await db
        .update(dictionaryEntries)
        .set({ audioKey: key })
        .where(eq(dictionaryEntries.normalized, word))
      tally.spoken += 1
    } catch (error) {
      tally.failed += 1
      console.error('prewarm: could not speak', word, error)
    }
  })

  return tally
}
