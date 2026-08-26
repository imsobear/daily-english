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
import { poolLevel } from '#/lib/vocabulary'

/**
 * Define and speak the whole vocabulary pool, ahead of anyone asking.
 *
 * The browse feed shows words nobody in the app has necessarily met before,
 * and defining one costs a dictionary fetch plus a model call while speaking
 * it costs TTS — seconds either way. Done on demand, every card in a fresh
 * feed would arrive blank and silent. The pool is fixed and small, though, and
 * both the entry and the audio are shared by every learner, so paying for all
 * of it once is a few dollars for a feed that never waits again.
 *
 * Everything here is skip-if-present, which makes the pass resumable: run it
 * again after adding words to the pool and it only does the new ones.
 */
export type PrewarmTally = {
  seen: number
  defined: number
  spoken: number
  failed: number
}

export const EMPTY_TALLY: PrewarmTally = {
  seen: 0,
  defined: 0,
  spoken: 0,
  failed: 0,
}

export function addTally(a: PrewarmTally, b: PrewarmTally): PrewarmTally {
  return {
    seen: a.seen + b.seen,
    defined: a.defined + b.defined,
    spoken: a.spoken + b.spoken,
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
 * Bring one batch of headwords up to date.
 *
 * `speak` is separable because the two halves fail differently: definitions
 * come from DeepSeek and the free dictionary, audio from OpenAI, and a run
 * that only wants to fill in the cheap half should be able to say so.
 */
export async function prewarmBatch(
  env: LessonEnv,
  headwords: string[],
  options: { speak?: boolean } = {},
): Promise<PrewarmTally> {
  const speak = options.speak ?? true
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
