import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq } from 'drizzle-orm'

import { getDb, waitUntil } from '#/db'
import { wordOffers, words } from '#/db/schema'
import { normalizeHeadword } from '#/lib/dictionary'
import {
  ensureEntry,
  entryCollocations,
  entryFamily,
  entrySenses,
  isDefined,
  loadEntries,
  loadEntry,
  needsSenses,
  stubEntry,
  type EntriesDb,
  type Entry,
} from '#/lib/entries'
import { TTS_VOICE } from '#/lib/ai'
import { requireUser } from '#/lib/session'
import { pickRecommendations, type RecommendedWord } from '#/lib/vocabulary'
import type { Sense, WordRelative } from '#/lib/word-card'
import { readSettings, type Settings } from '#/server/settings'

export type WordCard = {
  id: string
  headword: string
  ipa: string | null
  audioUrl: string
  senses: Sense[]
  collocations: string[]
  family: WordRelative[]
  source: string
  createdAt: string
  dictionaryMiss: boolean
  familiarity: number
  dueAt: number | null
}

export type WordsPage = {
  words: WordCard[]
  settings: Settings
}

function toCard(
  row: typeof words.$inferSelect,
  entry: Entry | undefined,
): WordCard {
  const senses = entrySenses(entry)
  return {
    id: row.id,
    headword: entry?.headword ?? row.headword,
    ipa: entry?.ipa ?? null,
    // Every word is speakable: the endpoint synthesises on first play, and
    // keys the clip by the word itself so it is spoken once for everyone.
    audioUrl: `/api/word-audio/${encodeURIComponent(row.normalized)}?v=${TTS_VOICE}`,
    senses,
    collocations: entryCollocations(entry),
    family: entryFamily(entry),
    source: row.source,
    createdAt: row.createdAt,
    dictionaryMiss: senses.length === 0,
    familiarity: row.familiarity,
    dueAt: row.dueAt,
  }
}

/** Attach each row's shared entry in a single extra query. */
async function toCards(db: EntriesDb, rows: (typeof words.$inferSelect)[]) {
  const entries = await loadEntries(
    db,
    rows.map((row) => row.normalized),
  )
  return rows.map((row) => toCard(row, entries.get(row.normalized)))
}

export const listWords = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  const db = getDb()
  const rows = await db.query.words.findMany({
    where: eq(words.userId, user.id),
    orderBy: desc(words.createdAt),
  })
  return toCards(db, rows)
})

export const getWordsPage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WordsPage> => {
    const user = await requireUser()
    const db = getDb()
    const settings = await readSettings(user.id)
    const rows = await db.query.words.findMany({
      where: eq(words.userId, user.id),
      orderBy: desc(words.createdAt),
    })
    return { words: await toCards(db, rows), settings }
  },
)

/** Two dozen chips fill the row on a phone without needing a second ask. */
const LIMIT = 24

/**
 * Words to offer next, drawn from the vocabulary pool.
 *
 * Sampled rather than generated: a model asked for "24 words at C1" answers
 * with the list it always answers with, which is what made every visit to the
 * add-words screen look like the last one. A shuffle over a few thousand
 * candidates is different by construction, and writing down what was shown
 * keeps it different across visits too. See `pickRecommendations`.
 */
export async function recommendationsFor(
  userId: string,
): Promise<RecommendedWord[]> {
  const db = getDb()
  const [settings, owned, offered] = await Promise.all([
    readSettings(userId),
    db.query.words.findMany({
      where: eq(words.userId, userId),
      columns: { normalized: true },
    }),
    db.query.wordOffers.findMany({
      where: eq(wordOffers.userId, userId),
      columns: { normalized: true },
      // Oldest first: the order they come back in if the level runs dry.
      orderBy: asc(wordOffers.offeredAt),
    }),
  ])

  const picks = pickRecommendations({
    level: settings.cefrLevel,
    owned: owned.map((row) => row.normalized),
    offered: offered.map((row) => row.normalized),
    limit: LIMIT,
  })

  const offeredAt = new Date().toISOString()
  const rows = picks.map((item) => ({
    userId,
    normalized: normalizeHeadword(item.headword),
    offeredAt,
  }))
  try {
    // D1 allows 100 bound variables per statement and an offer binds 3.
    for (let i = 0; i < rows.length; i += 30) {
      await db
        .insert(wordOffers)
        .values(rows.slice(i, i + 30))
        // A recycled word has just been offered again: date it now so it goes
        // back to the end of the queue.
        .onConflictDoUpdate({
          target: [wordOffers.userId, wordOffers.normalized],
          set: { offeredAt },
        })
    }
  } catch (error) {
    // Worth showing the words anyway; the cost is that this set can come back.
    console.error('could not record offers', error)
  }

  return picks
}

export const recommendWords = createServerFn({ method: 'POST' }).handler(
  async (): Promise<RecommendedWord[]> => {
    const user = await requireUser()
    return recommendationsFor(user.id)
  },
)

export const getWord = createServerFn({ method: 'GET' })
  .validator((data: { wordId: string }) => {
    if (!data.wordId) throw new Error('Missing word')
    return data
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()
    const row = await db.query.words.findFirst({
      where: and(eq(words.id, data.wordId), eq(words.userId, user.id)),
    })
    if (!row) return null
    return toCard(row, await loadEntry(db, row.normalized))
  })

/**
 * Look a word up after the response has gone.
 *
 * Failure is survivable: the entry stays reserved, the learner sees the word
 * without its senses, and both the nightly pass and the next visit to the word
 * try again.
 */
async function enrichWord(normalized: string) {
  await ensureEntry(getDb(), normalized)
}

export async function saveWordForUser(
  userId: string,
  data: { headword: string; source: 'manual' | 'recommendation' },
): Promise<{ word: WordCard; created: boolean }> {
  const db = getDb()
  const normalized = data.headword

  const existing = await db.query.words.findFirst({
    where: and(eq(words.userId, userId), eq(words.normalized, normalized)),
  })
  if (existing) {
    return {
      word: toCard(existing, await loadEntry(db, normalized)),
      created: false,
    }
  }

  const now = new Date().toISOString()
  const row: typeof words.$inferSelect = {
    id: crypto.randomUUID(),
    userId,
    headword: data.headword,
    normalized,
    source: data.source,
    sourceUrl: null,
    familiarity: 0,
    reviewCount: 0,
    seenCount: 0,
    lapses: 0,
    lastReviewedAt: null,
    dueAt: null,
    createdAt: now,
  }

  // A word anyone has saved before is already defined, and the learner sees it
  // complete on the first render rather than watching it fill in.
  const entry = await stubEntry(db, normalized, data.headword)
  await db.insert(words).values(row)

  if (needsSenses(entry)) {
    /*
     * A dictionary fetch is seconds, not milliseconds. Running it after the
     * response keeps adding a word instant, which matters when filling a ten
     * word lesson one tap at a time. The card the model writes comes with the
     * nightly pass, which takes saved words before pool words.
     */
    waitUntil(
      enrichWord(normalized).catch((error: unknown) => {
        console.error('Could not define', normalized, error)
      }),
    )
  }

  return { word: toCard(row, entry), created: true }
}

/**
 * Insert a whole starter set in one write. Onboarding hands the learner ten
 * words at once, and ten round trips would be felt on the button they just
 * tapped.
 */
export async function saveWordsForUser(
  userId: string,
  headwords: string[],
  source: 'manual' | 'recommendation',
): Promise<number> {
  const db = getDb()
  const owned = await db.query.words.findMany({
    where: eq(words.userId, userId),
    columns: { normalized: true },
  })
  const seen = new Set(owned.map((row) => row.normalized))

  const now = new Date().toISOString()
  const rows: (typeof words.$inferSelect)[] = []
  for (const headword of headwords) {
    if (seen.has(headword)) continue
    seen.add(headword)
    rows.push({
      id: crypto.randomUUID(),
      userId,
      headword,
      normalized: headword,
      source,
      sourceUrl: null,
      familiarity: 0,
      reviewCount: 0,
      seenCount: 0,
      lapses: 0,
      lastReviewedAt: null,
      dueAt: null,
      createdAt: now,
    })
  }
  if (rows.length === 0) return 0

  const entries = await Promise.all(
    rows.map((row) => stubEntry(db, row.normalized, row.headword)),
  )

  // D1 allows 100 bound variables per statement and a word row binds 13.
  for (let i = 0; i < rows.length; i += 7) {
    await db.insert(words).values(rows.slice(i, i + 7))
  }

  // Starter sets are the same handful of catalog words for everyone, so after
  // the first learner passes through this is usually nothing to do.
  const undefinedYet = entries.filter(needsSenses)
  if (undefinedYet.length > 0) {
    waitUntil(
      Promise.allSettled(
        undefinedYet.map((entry) =>
          enrichWord(entry.normalized).catch((error: unknown) => {
            console.error('Could not define', entry.normalized, error)
          }),
        ),
      ),
    )
  }

  return rows.length
}

export const addWord = createServerFn({ method: 'POST' })
  .validator((data: { headword: string; source?: string }) => {
    const headword = normalizeHeadword(data.headword)
    if (headword.length < 1 || headword.length > 80) {
      throw new Error('Enter a word or short phrase')
    }
    const source =
      data.source === 'recommendation'
        ? ('recommendation' as const)
        : ('manual' as const)
    return { headword, source }
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    return saveWordForUser(user.id, data)
  })

export const refreshWord = createServerFn({ method: 'POST' })
  .validator((data: { wordId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()
    const row = await db.query.words.findFirst({
      where: and(eq(words.id, data.wordId), eq(words.userId, user.id)),
    })
    if (!row) throw new Error('Word not found')

    const entry = await ensureEntry(db, row.normalized, row.headword)
    if (!isDefined(entry) || entrySenses(entry).length === 0) {
      throw new Error('Still no definition for this word')
    }
    return toCard(row, entry)
  })

export const deleteWord = createServerFn({ method: 'POST' })
  .validator((data: { wordId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()
    const row = await db.query.words.findFirst({
      where: and(eq(words.id, data.wordId), eq(words.userId, user.id)),
    })
    if (!row) throw new Error('Word not found')
    await db.delete(words).where(eq(words.id, row.id))
    return { ok: true }
  })
