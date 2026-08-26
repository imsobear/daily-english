import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { dictionaryEntries } from '#/db/schema'
import { lookupDictionary, type DictionaryHit } from '#/lib/dictionary'
import type { CefrLevel } from '#/lib/settings'
import { poolEntry } from '#/lib/vocabulary'
import {
  describeWordTwice,
  readList,
  readWorkersAi,
  type Sense,
  type WordRelative,
} from '#/lib/word-card'

/**
 * The shared word store.
 *
 * Everything lexical about a word — how it sounds, what it means, how it is
 * used — belongs to the language rather than to whoever saved it, so it is
 * looked up once and read by everyone afterwards. A learner's row in `words`
 * keeps only their own progress and points here by normalized headword.
 *
 * Functions take the database handle because both request handlers and the
 * lesson workflow use this, and the workflow builds its own from the job env.
 */
export type EntriesDb = DrizzleD1Database<typeof schema>

export type Entry = typeof dictionaryEntries.$inferSelect

/**
 * How good an entry's senses are, and so what is left to do to it.
 *
 * The three values are a ladder rather than a set of origins: a word starts
 * reserved and empty, the free dictionary gets it showable within a second,
 * and the model eventually replaces that with senses in modern frequency
 * order, each with its own Chinese and example. Nothing ever moves back down.
 */
export const PENDING = 'pending'

/** Whether there is anything to show a learner yet. */
export function isDefined(entry: Entry | undefined): entry is Entry {
  return Boolean(entry && entry.source !== PENDING)
}

/** Whether the model still owes this word a card. */
export function needsCard(entry: Entry | undefined) {
  return !entry || entry.source !== 'model'
}

export function entrySenses(entry: Entry | undefined): Sense[] {
  return readList<Sense>(entry?.senses).flatMap((sense) =>
    sense && typeof sense.definition === 'string' && sense.definition
      ? [
          {
            pos: typeof sense.pos === 'string' ? sense.pos : '',
            definition: sense.definition,
            zh: typeof sense.zh === 'string' ? sense.zh : null,
            examples: Array.isArray(sense.examples)
              ? sense.examples.filter((item) => typeof item === 'string')
              : [],
          },
        ]
      : [],
  )
}

export function entryCollocations(entry: Entry | undefined) {
  return readList<string>(entry?.collocations).filter(
    (item) => typeof item === 'string',
  )
}

export function entryFamily(entry: Entry | undefined) {
  return readList<WordRelative>(entry?.family).filter((item) => item?.word)
}

/** Every example the entry has, for the prompts that seed an article. */
export function entryExamples(entry: Entry | undefined) {
  return entrySenses(entry).flatMap((sense) => sense.examples)
}

/**
 * The level to pitch a card at.
 *
 * Words the pool has never carried are the ones a learner typed in themselves,
 * and B1 is the middle of the range rather than a guess about them.
 */
export function levelOf(normalized: string): CefrLevel {
  return poolEntry(normalized)?.level ?? 'B1'
}

/** Read many entries at once, so a word list costs one extra query. */
export async function loadEntries(db: EntriesDb, normalized: string[]) {
  const wanted = [...new Set(normalized)]
  const found = new Map<string, Entry>()
  if (wanted.length === 0) return found

  // D1 caps bound variables per statement well below a long word list.
  for (let i = 0; i < wanted.length; i += 50) {
    const rows = await db.query.dictionaryEntries.findMany({
      where: inArray(dictionaryEntries.normalized, wanted.slice(i, i + 50)),
    })
    for (const row of rows) found.set(row.normalized, row)
  }
  return found
}

export async function loadEntry(db: EntriesDb, normalized: string) {
  return db.query.dictionaryEntries.findFirst({
    where: eq(dictionaryEntries.normalized, normalized),
  })
}

/**
 * Reserve the entry for a word we have only just met.
 *
 * Saving a word returns immediately and defines it afterwards, so the row has
 * to exist in between or the word list would have nothing to join to.
 */
export async function stubEntry(
  db: EntriesDb,
  normalized: string,
  headword: string,
): Promise<Entry> {
  await db
    .insert(dictionaryEntries)
    .values({
      normalized,
      headword,
      source: PENDING,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
  return (
    (await loadEntry(db, normalized)) ?? {
      normalized,
      headword,
      ipa: null,
      senses: '[]',
      collocations: '[]',
      family: '[]',
      source: PENDING,
      audioKey: null,
      updatedAt: new Date().toISOString(),
      definitions: '[]',
      examples: '[]',
      senseSource: 'legacy',
      detail: null,
    }
  )
}

/**
 * Store the dictionary's answer, without overwriting the model's.
 *
 * Two learners can meet the same new word at the same moment and both look it
 * up, and a word can be looked up again years after the model described it —
 * neither may replace a card with a stopgap, which is what the `where` guards.
 */
export async function saveDictionary(
  db: EntriesDb,
  normalized: string,
  hit: DictionaryHit,
): Promise<Entry> {
  const row = {
    normalized,
    headword: hit.headword,
    ipa: hit.ipa ?? null,
    senses: JSON.stringify(hit.senses),
    source: 'dictionary',
    updatedAt: new Date().toISOString(),
  }

  await db
    .insert(dictionaryEntries)
    .values(row)
    .onConflictDoUpdate({
      target: dictionaryEntries.normalized,
      set: {
        headword: row.headword,
        ipa: row.ipa,
        senses: row.senses,
        source: row.source,
        updatedAt: row.updatedAt,
      },
      where: sql`${dictionaryEntries.source} != 'model'`,
    })

  return (await loadEntry(db, normalized)) ?? ({ ...row } as Entry)
}

/**
 * The entry a learner can be shown right now.
 *
 * One path for every way a word arrives — saved from the list, tapped in an
 * article, dealt by the Explore feed. Read what we have; if it is only a
 * reservation, spend up to three seconds on the free dictionary so the screen
 * has something on it. What is missing after that is the model's job, and the
 * caller hands `completeEntry` to `waitUntil` rather than waiting for it.
 */
export async function ensureEntry(
  db: EntriesDb,
  normalized: string,
  headword = normalized,
): Promise<Entry | undefined> {
  const existing = await loadEntry(db, normalized)
  if (isDefined(existing)) return existing

  const hit = await lookupDictionary(normalized).catch((error: unknown) => {
    console.error('Dictionary lookup failed', normalized, error)
    return null
  })
  if (!hit) return existing ?? (await stubEntry(db, normalized, headword))
  return saveDictionary(db, normalized, hit)
}

/**
 * Fetch a pronunciation for a word that has senses but no IPA.
 *
 * The dictionary is the only source of one, and it is also the flakiest thing
 * here — three seconds is not long, and it rate-limits a burst. A word that
 * lost that race would otherwise stay silent for good, because once the model
 * writes its card nothing looks the word up again. The pass calls this; no
 * request path does, since nobody should wait twice for the same slow host.
 */
export async function ensureIpa(db: EntriesDb, normalized: string) {
  const hit = await lookupDictionary(normalized).catch((error: unknown) => {
    console.error('Dictionary lookup failed', normalized, error)
    return null
  })
  if (!hit?.ipa) return false

  await db
    .update(dictionaryEntries)
    .set({ ipa: hit.ipa })
    .where(
      and(
        eq(dictionaryEntries.normalized, normalized),
        isNull(dictionaryEntries.ipa),
      ),
    )
  return true
}

export type WordCardEnv = {
  CLOUDFLARE_ACCOUNT_ID?: string
  WORKERS_AI_API_TOKEN?: string
  WORKERS_AI_MOCK_URL?: string
}

/**
 * Give one word the card the model writes: senses in frequency order, each
 * with its Chinese and an example, plus collocations and family.
 *
 * Half a minute of a large model, so no request ever waits on it — the pass
 * does it ahead of time and `waitUntil` does it for whatever the pass missed.
 * Returns false when nothing usable came back, which leaves the dictionary
 * senses in place and the word eligible for the next run.
 */
export async function completeEntry(
  env: WordCardEnv,
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
 * Everything one word needs, in the order a learner notices it missing.
 *
 * Handed to `waitUntil` by whichever request first met the word, so it runs
 * after the response and its cost is bounded by how many new words a person
 * can meet in a day.
 */
export async function fillEntry(
  env: WordCardEnv,
  db: EntriesDb,
  normalized: string,
  headword?: string,
) {
  const entry = await ensureEntry(db, normalized, headword)
  if (!needsCard(entry)) return
  await completeEntry(env, db, normalized, entry?.headword ?? headword)
}
