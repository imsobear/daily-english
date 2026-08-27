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
import { normalizeHeadword } from '#/lib/dictionary'
import {
  completeEntry,
  ensureEntry,
  ensureIpa,
  isDefined,
  loadEntries,
  needsCard,
  type EntriesDb,
  type Entry,
} from '#/lib/entries'
import type { LessonEnv } from '#/lib/generate-lesson'
import { CEFR_LEVELS, type CefrLevel } from '#/lib/settings'
import { poolLevel } from '#/lib/vocabulary'

/**
 * Define, speak and describe the whole vocabulary pool, ahead of anyone asking.
 *
 * The Explore feed shows words nobody in the app has necessarily met before,
 * and defining one costs a dictionary fetch, speaking it costs TTS, and
 * writing its card costs half a minute of a large model. Done on demand, every
 * card in a fresh feed would arrive blank and silent. The pool is fixed and
 * shared by every learner, so doing it once ahead of time buys a feed that
 * never waits again.
 *
 * Everything here is skip-if-present, which makes the pass resumable: run it
 * again after adding words to the pool and it only does the new ones. That is
 * also what lets the cards be rationed — a run stops describing when it hits
 * its budget, and tomorrow's run picks up exactly where it left off.
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

/**
 * Cards per run, sized to the free Workers AI allowance.
 *
 * Workers AI gives away 10,000 Neurons a day, and one card off gpt-oss-120b
 * costs somewhere near ninety of them once the model has finished thinking —
 * a hundred words is most of a day and none of a bill. The pool is thousands
 * of words, so the pass is meant to be run again tomorrow rather than turned
 * up: it skips whatever is already carded, and the words a learner actually
 * meets get theirs from `waitUntil` long before the pass arrives.
 */
export const DESCRIBE_BUDGET = 100

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
 * The three phases are separable because they cost differently: senses come
 * from the free dictionary, audio from OpenAI at a fraction of a cent a word,
 * and cards from Workers AI against a daily allowance. A run that only wants
 * one of them should be able to say so.
 */
export async function prewarmBatch(
  env: LessonEnv,
  headwords: string[],
  options: { speak?: boolean; describeLimit?: number } = {},
): Promise<PrewarmTally> {
  const speak = options.speak ?? true
  // How many cards this batch may write. Counted down as they are, so four
  // words describing at once cannot spend the same slot twice.
  let describeLeft = options.describeLimit ?? headwords.length
  const db = drizzle(env.DB, { schema }) as EntriesDb
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
      if (!isDefined(entry)) {
        entry = (await ensureEntry(db, word)) ?? entry
        tally.defined += 1
      } else if (!entry.ipa) {
        // Defined, but the dictionary was too slow the day it was met.
        await ensureIpa(db, word)
      }
    } catch (error) {
      tally.failed += 1
      console.error('prewarm: could not define', word, error)
    }

    // Skip-if-present, like everything else here, so a second run costs
    // nothing for the words a first one already wrote.
    if (needsCard(entry) && describeLeft > 0) {
      describeLeft -= 1
      try {
        const written = await completeEntry(env, db, word, entry?.headword)
        if (written) tally.described += 1
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
