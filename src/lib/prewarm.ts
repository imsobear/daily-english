import { drizzle } from 'drizzle-orm/d1'
import { asc, eq, lt, ne, or } from 'drizzle-orm'

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
  ensureDictionarySenses,
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
import {
  CARD_VERSION,
  describeWordTwice,
  readWorkersAi,
} from '#/lib/word-card'

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
 * Cards per run. A guard against a mistake, not a budget to spend.
 *
 * A card measures about 800 tokens in and 1,250 out, which at gpt-oss-120b's
 * rate is roughly 110 Neurons; the free allocation of 10,000 a day is therefore
 * about ninety cards, and everything past it bills at $0.011 per 1,000 on the
 * Workers Paid plan. Two thousand is some two dollars, and around three and a
 * half hours at four words at a time.
 *
 * The whole pool is only five dollars, so the pace was never really about the
 * money: only a word whose card is missing or behind the current recipe costs
 * anything, and a run over a warm pool spends nothing at all. What this number
 * is really for is the day something marks every word stale by accident —
 * uncapped, that is the pool rewritten nightly and a bill to find out by.
 */
export const DESCRIBE_BUDGET = 2000

/**
 * Saved words considered per run. Everyone's lists together come to a couple
 * of hundred, so this is a ceiling on a query rather than a real ration.
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
 * Give one word the card the model writes: senses in frequency order, each
 * with its Chinese and two examples, plus collocations and family.
 *
 * What the model is given matters more than anything else here. The pool knows
 * the part of speech it teaches the word as, and the row keeps what the
 * dictionary said; asked without either, the model wrote the verb "dance" onto
 * the card for "dancing" and nobody found out for a month. A word described
 * before the dictionary text was kept gets it fetched again rather than
 * rewritten from nothing.
 *
 * Returns false when nothing usable came back, which leaves the senses that
 * are there in place and the word eligible for the next run.
 */
export async function describeEntry(
  env: LessonEnv,
  db: EntriesDb,
  normalized: string,
  entry?: Entry,
) {
  const pool = poolEntry(normalized)
  const grounding = entry
    ? await ensureDictionarySenses(db, entry)
    : { senses: [], reachable: true }

  // A word that already has a card can wait for a night the dictionary
  // answers. Rewriting it during an outage would spend the call, lose the
  // grounding that is the point of the rewrite, and stamp the word as done.
  if (!grounding.reachable && entry?.source === 'model') return false

  const card = await describeWordTwice(
    {
      headword: entry?.headword ?? normalized,
      // A word the pool never carried is one a learner typed in or tapped out
      // of an article, and B1 is the middle of the range rather than a guess
      // about them.
      level: pool?.level ?? 'B1',
      pos: pool?.pos ?? null,
      dictionary: grounding.senses,
    },
    readWorkersAi(env),
  )
  if (!card) return false

  await db
    .update(dictionaryEntries)
    .set({
      senses: JSON.stringify(card.senses),
      collocations: JSON.stringify(card.collocations),
      family: JSON.stringify(card.family),
      source: 'model',
      cardVersion: CARD_VERSION,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dictionaryEntries.normalized, normalized))
  return true
}

/**
 * The words learners have saved whose cards are not the ones we would write
 * today — never described, or described by an older recipe.
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
    .where(
      or(
        ne(dictionaryEntries.source, 'model'),
        lt(dictionaryEntries.cardVersion, CARD_VERSION),
      ),
    )
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
        const written = await describeEntry(env, db, word, entry)
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
