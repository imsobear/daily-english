import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { inArray, eq, sql } from 'drizzle-orm'

import * as schema from '#/db/schema'
import { dictionaryEntries } from '#/db/schema'
import type { DeepSeekConfig } from '#/lib/deepseek'
import {
  buildEntry,
  normalizeHeadword,
  type DictionaryHit,
  type DictionarySense,
} from '#/lib/dictionary'
import { readWordDetail } from '#/lib/word-detail'

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

/** A word saved but not yet defined. Enrichment runs after the response. */
export const PENDING = 'pending'

export function isDefined(entry: Entry | undefined): entry is Entry {
  return Boolean(entry && entry.senseSource !== PENDING)
}

/** Entries whose senses came from the dictionary's historical ordering. */
export function needsBetterSenses(entry: Entry | undefined) {
  return !entry || entry.senseSource !== 'model'
}

export function entrySenses(entry: Entry | undefined): DictionarySense[] {
  return parseJson<DictionarySense>(entry?.definitions).flatMap((sense) =>
    typeof sense?.definition === 'string' && sense.definition
      ? [
          {
            partOfSpeech:
              typeof sense.partOfSpeech === 'string'
                ? sense.partOfSpeech
                : 'unknown',
            definition: sense.definition,
          },
        ]
      : [],
  )
}

/** The richer card, once the pre-warm pass has written one. */
export function entryDetail(entry: Entry | undefined) {
  return readWordDetail(entry?.detail)
}

export function entryExamples(entry: Entry | undefined): string[] {
  return parseJson<string>(entry?.examples).filter(
    (item) => typeof item === 'string',
  )
}

function parseJson<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
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
  const row: Entry = {
    normalized,
    headword,
    ipa: null,
    definitions: '[]',
    examples: '[]',
    senseSource: PENDING,
    detail: null,
    audioKey: null,
    updatedAt: new Date().toISOString(),
  }
  await db.insert(dictionaryEntries).values(row).onConflictDoNothing()
  return (await loadEntry(db, normalized)) ?? row
}

/**
 * Store a definition, without discarding a better one that arrived first.
 *
 * Two learners can save the same new word at the same moment and both look it
 * up; whichever write lands second must not replace model-written senses with
 * the dictionary's.
 */
export async function saveEntry(
  db: EntriesDb,
  hit: DictionaryHit,
): Promise<Entry> {
  const normalized = normalizeHeadword(hit.headword)
  const senseSource = hit.senseSource ?? 'legacy'
  const row: Entry = {
    normalized,
    headword: hit.headword,
    ipa: hit.ipa ?? null,
    definitions: JSON.stringify(hit.definitions),
    examples: JSON.stringify(hit.examples),
    senseSource,
    // Left alone on conflict below: a definition arriving late must not throw
    // away a card the pre-warm pass has already written.
    detail: null,
    audioKey: null,
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
        definitions: row.definitions,
        examples: row.examples,
        senseSource,
        updatedAt: row.updatedAt,
      },
      where:
        senseSource === 'model'
          ? undefined
          : sql`${dictionaryEntries.senseSource} != 'model'`,
    })

  return (await loadEntry(db, normalized)) ?? row
}

/**
 * The entry for a word, defining it first if nobody has yet.
 *
 * A word already described by the model is returned untouched — the whole
 * point of the shared table is that the lookup happens once. Dictionary-only
 * senses are worth redoing, because their historical ordering is what made
 * "despite" a noun meaning disdain.
 */
export async function ensureEntry(
  db: EntriesDb,
  normalized: string,
  config: DeepSeekConfig | null,
): Promise<Entry | undefined> {
  const existing = await loadEntry(db, normalized)
  if (existing && !needsBetterSenses(existing)) return existing
  // Without a model there is nothing better to fetch than what we already have.
  if (existing && isDefined(existing) && !config) return existing

  const hit = await buildEntry(normalized, config)
  if (!hit) return existing
  return saveEntry(db, hit)
}
