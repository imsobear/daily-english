import { drizzle } from 'drizzle-orm/d1'
import { asc, eq, ne } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { dictionaryEntries, words } from '#/db/schema'
import {
  readOpenAiApiKey,
  readTtsMockUrl,
  synthesizeSpeech,
  TTS_VOICE,
} from '#/lib/ai'
import { normalizeHeadword } from '#/lib/dictionary'
import {
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
import { poolEntry, poolLevel } from '#/lib/vocabulary'
import { describeWordTwice, readWorkersAi } from '#/lib/word-card'

/**
 * Define, speak and describe words, ahead of anyone asking.
 *
 * This is the only thing in the app that calls the model that writes cards. A
 * card is half a minute of a large model and a share of a daily allowance, so
 * asking for one while somebody waits would be slow at best and rationed at
 * worst; here a slow answer costs nobody anything and the budget is spent on
 * purpose. Requests fetch the dictionary and leave it at that.
 *
 * Everything here is skip-if-present, which makes the pass resumable: run it
 * again after adding words and it only does the new ones. That is also what
 * lets the cards be rationed — a run stops describing when it hits its budget,
 * and tomorrow's run picks up exactly where it left off.
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
 * Cards per run, sized to a night's share of the free Workers AI allowance.
 *
 * Workers AI gives away 10,000 Neurons a day and one card off gpt-oss-120b
 * costs somewhere near seventy-five of them, counting the answers thrown away
 * for having no Chinese in them. That is about 130 cards; a hundred leaves room
 * for the retries and for anything else on the account.
 *
 * The cron in `src/worker.ts` spends this every night, and the pass skips
 * whatever is already carded, so words fill a hundred at a time without anyone
 * deciding to do it.
 */
export const DESCRIBE_BUDGET = 100

/**
 * Saved words considered per run, a few times the card budget so that the
 * words behind today's hundred are already queued for tomorrow.
 */
const DEMANDED_LIMIT = 500

/** In-flight lookups inside one batch, to stay polite to both providers. */
const CONCURRENCY = 4

/** One workflow step's worth of words. `level` only names the step. */
export type PrewarmBatch = { level: string; offset: number; words: string[] }

function batched(level: string, headwords: string[]): PrewarmBatch[] {
  const batches: PrewarmBatch[] = []
  for (let offset = 0; offset < headwords.length; offset += PREWARM_BATCH) {
    batches.push({
      level,
      offset,
      words: headwords.slice(offset, offset + PREWARM_BATCH),
    })
  }
  return batches
}

export function prewarmPlan(
  levels: CefrLevel[] = [...CEFR_LEVELS],
): PrewarmBatch[] {
  return levels.flatMap((level) =>
    batched(
      level,
      poolLevel(level).map((word) => word.headword),
    ),
  )
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
 * The level to pitch a card at.
 *
 * Words the pool has never carried are the ones a learner typed in themselves,
 * and B1 is the middle of the range rather than a guess about them.
 */
function levelOf(normalized: string): CefrLevel {
  return poolEntry(normalized)?.level ?? 'B1'
}

/**
 * Give one word the card the model writes: senses in frequency order, each
 * with its Chinese and an example, plus collocations and family.
 *
 * Returns false when nothing usable came back, which leaves the dictionary
 * senses in place and the word eligible for the next run.
 */
export async function describeEntry(
  env: LessonEnv,
  db: EntriesDb,
  normalized: string,
  headword?: string,
) {
  const card = await describeWordTwice({
    headword: headword ?? normalized,
    level: levelOf(normalized),
    ...readWorkersAi(env),
  })
  if (!card) return false

  await db
    .update(dictionaryEntries)
    .set({
      senses: JSON.stringify(card.senses),
      collocations: JSON.stringify(card.collocations),
      family: JSON.stringify(card.family),
      source: 'model',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dictionaryEntries.normalized, normalized))
  return true
}

/**
 * The words learners have saved and the model has not described yet.
 *
 * These go before the pool, because a word somebody typed in or tapped out of
 * an article is a word they chose, and it may not be in the pool at all —
 * which, now that nothing describes a word on demand, would leave it holding
 * dictionary senses for good. Oldest first, so a word cannot be pushed down
 * the list forever by newer ones.
 */
export async function demandedWords(db: EntriesDb, limit = DEMANDED_LIMIT) {
  const rows = await db
    .selectDistinct({
      normalized: words.normalized,
      createdAt: words.createdAt,
    })
    .from(words)
    .innerJoin(
      dictionaryEntries,
      eq(dictionaryEntries.normalized, words.normalized),
    )
    .where(ne(dictionaryEntries.source, 'model'))
    .orderBy(asc(words.createdAt))
    .limit(limit)
  return rows.map((row) => row.normalized)
}

/** The saved words, as steps for the workflow to walk. */
export async function demandedPlan(env: LessonEnv): Promise<PrewarmBatch[]> {
  const db = drizzle(env.DB, { schema }) as EntriesDb
  return batched('saved', await demandedWords(db))
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
        const written = await describeEntry(env, db, word, entry?.headword)
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
