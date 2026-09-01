import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { dictionaryEntries } from '#/db/schema'
import { lookupDictionary, type DictionaryHit } from '#/lib/dictionary'
import {
  CARD_VERSION,
  readList,
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

/** Whether the dictionary still owes this word its first senses. */
export function needsSenses(entry: Entry | undefined) {
  return !entry || entry.source === PENDING
}

/**
 * Whether the model still owes this word a card.
 *
 * True for a word it has never described and for one it described by an older
 * recipe, which are the same job: ask again with what we know now. Nothing
 * else in the app decides this, so bumping `CARD_VERSION` is the whole of
 * rolling a better prompt out to words that already have a card.
 */
export function needsCard(entry: Entry | undefined) {
  return !entry || entry.source !== 'model' || entry.cardVersion < CARD_VERSION
}

export function entrySenses(entry: Entry | undefined): Sense[] {
  return sensesOf(entry?.senses)
}

/**
 * What the free dictionary said, for the model to work from.
 *
 * Empty for a word described before this column existed. The pass fetches
 * them again in that case rather than leaving the rewrite to work from
 * nothing, which is the whole point of keeping them.
 */
export function entryDictionarySenses(entry: Entry | undefined): Sense[] {
  return sensesOf(entry?.dictionarySenses)
}

function sensesOf(raw: string | null | undefined): Sense[] {
  return readList<Sense>(raw).flatMap((sense) =>
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
      dictionarySenses: '[]',
      collocations: '[]',
      family: '[]',
      source: PENDING,
      cardVersion: 0,
      audioKey: null,
      updatedAt: new Date().toISOString(),
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
  const senses = JSON.stringify(hit.senses)
  const row = {
    normalized,
    headword: hit.headword,
    ipa: hit.ipa ?? null,
    senses,
    dictionarySenses: senses,
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
 * Put the dictionary's senses back on a row that predates keeping them.
 *
 * Only ever writes into an empty column: what the dictionary says today is a
 * fine starting point for a rewrite, and a poor reason to overwrite the
 * starting point an earlier rewrite already used.
 *
 * `reachable` is the difference between a word the dictionary has nothing for
 * and a dictionary that is having a bad afternoon — it drops every request
 * that misses its cache for hours at a time. The first is a fact about the
 * word and the second is a reason to come back tomorrow, and they are
 * indistinguishable from the empty list alone.
 */
export async function ensureDictionarySenses(
  db: EntriesDb,
  entry: Entry,
): Promise<{ senses: Sense[]; reachable: boolean }> {
  const kept = entryDictionarySenses(entry)
  if (kept.length > 0) return { senses: kept, reachable: true }

  let reachable = true
  const hit = await lookupDictionary(entry.normalized).catch(
    (error: unknown) => {
      console.error('Dictionary lookup failed', entry.normalized, error)
      reachable = false
      return null
    },
  )
  if (!hit?.senses.length) return { senses: [], reachable }

  await db
    .update(dictionaryEntries)
    .set({ dictionarySenses: JSON.stringify(hit.senses) })
    .where(
      and(
        eq(dictionaryEntries.normalized, entry.normalized),
        eq(dictionaryEntries.dictionarySenses, '[]'),
      ),
    )
  return { senses: hit.senses, reachable: true }
}

/**
 * The entry a learner can be shown right now.
 *
 * One path for every way a word arrives — saved from the list, tapped in an
 * article, dealt by the Explore feed. Read what we have; if it is only a
 * reservation, spend up to three seconds on the free dictionary so the screen
 * has something on it. Nothing here calls the model: a card takes half a
 * minute to write, and the nightly pass writes them where a slow answer costs
 * nobody anything.
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
