import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'

import { getDb, waitUntil } from '#/db'
import { userSettings, wordOffers, words } from '#/db/schema'
import { TTS_VOICE } from '#/lib/ai'
import {
  asBrowseSource,
  makeSeed,
  mineShare,
  seeded,
  weave,
  type BrowseSource,
} from '#/lib/browse'
import { normalizeHeadword } from '#/lib/dictionary'
import {
  ensureEntry,
  entryCollocations,
  entryFamily,
  entrySenses,
  isDefined,
  loadEntries,
  needsSenses,
  type Entry,
} from '#/lib/entries'
import { requireUser } from '#/lib/session'
import { CEFR_LEVELS, type CefrLevel } from '#/lib/settings'
import { pickRecommendations, poolEntry } from '#/lib/vocabulary'
import type { Sense, WordRelative } from '#/lib/word-card'
import { readSettings } from '#/server/settings'

export type BrowseCard = {
  normalized: string
  headword: string
  ipa: string | null
  audioUrl: string
  level: CefrLevel | null
  senses: Sense[]
  collocations: string[]
  family: WordRelative[]
  /** Set when this is already one of the learner's words. */
  wordId: string | null
  familiarity: number | null
  /** How the learner added it; null for words they have not saved. */
  source: string | null
  /** Nobody has defined this word yet; the lookup is running behind us. */
  pending: boolean
}

export type BrowsePage = {
  cards: BrowseCard[]
  /** Where the next page should resume in the learner's own list. */
  mineCursor: number
  /** The order this visit is using. Hand it back to keep the same one. */
  seed: number
  /** Neither source has anything more to give. */
  end: boolean
}

export type BrowseStart = BrowsePage & {
  source: BrowseSource
  level: CefrLevel
  /**
   * Saved words in total, at any level. An empty "Mine" feed means something
   * different for a learner with none than for one whose words are all at a
   * level they have since moved off.
   */
  savedTotal: number
  /**
   * The level to suggest moving up to, once enough words here are known.
   * Null the rest of the time, which is nearly always.
   */
  levelHint: CefrLevel | null
}

/** A phone shows one card at a time; a dozen is several flicks of scrolling. */
const PAGE = 12

/**
 * Known words at the current level before the feed suggests moving up.
 *
 * Thirty is a couple of hundred cards' worth of scrolling with an honest
 * finger, which is enough to mean something. The count only looks at the
 * current level, so raising it clears the suggestion by itself.
 */
const LEVEL_HINT_AT = 30

/**
 * Words looked up per page, when the nightly pass has not reached them.
 *
 * A dictionary fetch each, which is the ceiling on what an idle scroll can
 * spend on a stranger's server. The card the model writes is never fetched
 * here — the pass does that, and until it has, the dictionary senses are what
 * the feed shows.
 */
const ENRICH_PER_PAGE = 6

function audioUrl(normalized: string) {
  return `/api/word-audio/${encodeURIComponent(normalized)}?v=${TTS_VOICE}`
}

function cardOf(input: {
  normalized: string
  headword: string
  entry: Entry | undefined
  level: CefrLevel | null
  wordId?: string | null
  familiarity?: number | null
  source?: string | null
}): BrowseCard {
  const senses = entrySenses(input.entry)
  return {
    normalized: input.normalized,
    headword: input.entry?.headword ?? input.headword,
    ipa: input.entry?.ipa ?? null,
    audioUrl: audioUrl(input.normalized),
    level: input.level,
    senses,
    collocations: entryCollocations(input.entry),
    family: entryFamily(input.entry),
    wordId: input.wordId ?? null,
    familiarity: input.familiarity ?? null,
    source: input.source ?? null,
    pending: senses.length === 0,
  }
}

/**
 * Whether one of the learner's own words belongs in a feed at this level.
 *
 * A word the pool has never carried — typed in, or tapped out of an article —
 * has no level to disagree with, and it is the most personal thing in the
 * list, so it stays.
 */
function atLevel(normalized: string, level: CefrLevel) {
  const pool = poolEntry(normalized)
  return !pool || pool.level === level
}

/**
 * Shuffle a visit's worth of saved words, shakiest likeliest to come first.
 *
 * A fixed list read in a fixed order is the same scroll every time, and an
 * idle browse is worth nothing if the learner can predict card three. Adding
 * a random number to the familiarity keeps some of the old intent — a word
 * they are losing still beats one they have nearly learned most of the time —
 * while leaving the twenty words they have never studied in a different order
 * on every arrival, since they all sit at zero and the draw decides alone.
 */
function shuffled<T extends { familiarity: number | null }>(
  rows: T[],
  random: () => number,
) {
  return rows
    .map((row) => ({ row, key: (row.familiarity ?? 0) + random() }))
    .sort((a, b) => a.key - b.key)
    .map((item) => item.row)
}

/**
 * The learner's own words at this level, in this visit's order and wrapping at
 * the end.
 *
 * A feed with no end has to come back round eventually — an idle scroll
 * through forty saved words should keep working at card two hundred. The level
 * filter happens here rather than in SQL because only the pool file knows what
 * level a word is; the `words` table just has headwords.
 */
async function mineCards(
  userId: string,
  level: CefrLevel,
  cursor: number,
  wanted: number,
  random: () => number,
) {
  const db = getDb()
  if (wanted <= 0) return { cards: [] as BrowseCard[], cursor, exhausted: true }

  const rows = await db.query.words.findMany({
    where: eq(words.userId, userId),
    // Fixed, so that the shuffle below is the only thing deciding the order
    // and the same seed reads the same list on the next page.
    orderBy: [asc(words.createdAt), asc(words.id)],
    columns: {
      id: true,
      headword: true,
      normalized: true,
      familiarity: true,
      source: true,
    },
  })
  const eligible = shuffled(
    rows.filter((row) => atLevel(row.normalized, level)),
    random,
  )
  if (eligible.length === 0) {
    return { cards: [] as BrowseCard[], cursor: 0, exhausted: true }
  }

  // Never the same word twice on one screenful, however short the list is.
  const take = Math.min(wanted, eligible.length)
  const start = cursor % eligible.length
  const picked = Array.from(
    { length: take },
    (_, i) => eligible[(start + i) % eligible.length],
  )

  const entries = await loadEntries(
    db,
    picked.map((row) => row.normalized),
  )
  const cards = picked.map((row) => {
    const pool = poolEntry(row.normalized)
    return cardOf({
      normalized: row.normalized,
      headword: row.headword,
      entry: entries.get(row.normalized),
      level: pool?.level ?? null,
      wordId: row.id,
      familiarity: row.familiarity,
      source: row.source,
    })
  })
  return {
    cards,
    cursor: (start + take) % eligible.length,
    exhausted: false,
  }
}

/**
 * Words from the pool this learner has not saved, dismissed or just seen.
 *
 * Recording the showing is what stops the next page repeating this one, and
 * it is the same ledger the add-words screen reads, so a word scrolled past
 * here does not turn up as a suggestion an hour later.
 */
async function freshCards(userId: string, level: CefrLevel, wanted: number) {
  const db = getDb()
  if (wanted <= 0) return { cards: [] as BrowseCard[], exhausted: true }

  const [owned, offers] = await Promise.all([
    db.query.words.findMany({
      where: eq(words.userId, userId),
      columns: { normalized: true },
    }),
    db.query.wordOffers.findMany({
      where: eq(wordOffers.userId, userId),
      columns: { normalized: true, verdict: true },
      orderBy: asc(wordOffers.offeredAt),
    }),
  ])

  const known = offers.filter((row) => row.verdict === 'known')
  /*
   * Three times the page, so the ones that already have a definition can be
   * preferred. Every card here is a word this learner has never been shown,
   * which before the pre-warm pass has run means every card would otherwise
   * be a word nobody has defined yet — a feed of blanks.
   */
  const picks = pickRecommendations({
    level,
    // Known words join the owned set rather than the offered one: offered
    // words come back when the level runs dry, and "I know this" should mean
    // never again.
    owned: [
      ...owned.map((row) => row.normalized),
      ...known.map((row) => row.normalized),
    ],
    offered: offers
      .filter((row) => row.verdict !== 'known')
      .map((row) => row.normalized),
    // Every card is labelled with its level, so every card is at the level
    // the learner set. The add-words screen still casts the wider net.
    exact: true,
    limit: wanted * 3,
  })
  if (picks.length === 0) return { cards: [] as BrowseCard[], exhausted: true }

  const entries = await loadEntries(
    db,
    picks.map((pick) => normalizeHeadword(pick.headword)),
  )
  const ready = (pick: (typeof picks)[number]) =>
    isDefined(entries.get(normalizeHeadword(pick.headword)))

  const chosen = [...picks.filter(ready), ...picks.filter((p) => !ready(p))].slice(
    0,
    wanted,
  )
  const shown = new Set(chosen)

  const normalized = chosen.map((pick) => normalizeHeadword(pick.headword))
  const cards = chosen.map((pick, i) =>
    cardOf({
      normalized: normalized[i],
      headword: pick.headword,
      entry: entries.get(normalized[i]),
      level: pick.level,
    }),
  )

  await recordShown(userId, normalized)

  /*
   * Whatever has no senses at all is looked up after the response: the ones on
   * this page, so they read properly if the learner scrolls back, then the
   * candidates we passed over, so the next page has more to choose from. A
   * page of twelve is not worth holding behind a dozen dictionary fetches.
   */
  const missing = [...chosen, ...picks.filter((pick) => !shown.has(pick))]
    .filter((pick) => needsSenses(entries.get(normalizeHeadword(pick.headword))))
    .map((pick) => normalizeHeadword(pick.headword))
    .slice(0, ENRICH_PER_PAGE)
  if (missing.length > 0) {
    waitUntil(
      Promise.allSettled(
        missing.map((word) =>
          ensureEntry(db, word).catch((error: unknown) => {
            console.error('Could not define', word, error)
          }),
        ),
      ),
    )
  }

  return { cards, exhausted: false }
}

async function recordShown(userId: string, normalized: string[]) {
  if (normalized.length === 0) return
  const db = getDb()
  const offeredAt = new Date().toISOString()
  try {
    // D1 allows 100 bound variables per statement and an offer binds 4.
    for (let i = 0; i < normalized.length; i += 20) {
      await db
        .insert(wordOffers)
        .values(
          normalized.slice(i, i + 20).map((word) => ({
            userId,
            normalized: word,
            offeredAt,
            verdict: 'shown',
          })),
        )
        // Only the date moves: a verdict already recorded is the learner's,
        // and showing the word again does not overrule it.
        .onConflictDoUpdate({
          target: [wordOffers.userId, wordOffers.normalized],
          set: { offeredAt },
        })
    }
  } catch (error) {
    console.error('could not record browse offers', error)
  }
}

/**
 * One page of the feed.
 *
 * Separate from the server function so it can be exercised with a user id
 * rather than a session: what is worth testing here is the composition, not
 * the cookie.
 */
export async function browsePageFor(input: {
  userId: string
  source: BrowseSource
  level: CefrLevel
  mineCursor: number
  /** The visit's order. Zero, or nothing, starts a new one. */
  seed?: number
}): Promise<BrowsePage> {
  /*
   * Only the learner's own words need the seed. The pool side draws afresh
   * every time and records what it showed, so it is already different on every
   * page and every visit without being told to be.
   */
  const seed = input.seed && input.seed > 0 ? input.seed : makeSeed()
  const random = seeded(seed)

  if (input.source === 'mine') {
    const mine = await mineCards(
      input.userId,
      input.level,
      input.mineCursor,
      PAGE,
      random,
    )
    return {
      cards: mine.cards,
      mineCursor: mine.cursor,
      seed,
      end: mine.exhausted,
    }
  }

  if (input.source === 'new') {
    const fresh = await freshCards(input.userId, input.level, PAGE)
    return {
      cards: fresh.cards,
      mineCursor: input.mineCursor,
      seed,
      end: fresh.exhausted,
    }
  }

  /*
   * Mixing asks the learner's list first, because how much of it there is
   * decides the rest of the page: someone with three saved words should still
   * get a full page, and so should someone whose level has run dry. Each side
   * covers for the other rather than leaving a short page behind.
   */
  const mine = await mineCards(
    input.userId,
    input.level,
    input.mineCursor,
    mineShare(PAGE),
    random,
  )
  const fresh = await freshCards(
    input.userId,
    input.level,
    PAGE - mine.cards.length,
  )

  const short = PAGE - mine.cards.length - fresh.cards.length
  const extra =
    short > 0 && !mine.exhausted
      ? // The same seed, so this reads on from where the first call stopped
        // rather than reshuffling into words it has just handed over.
        await mineCards(
          input.userId,
          input.level,
          mine.cursor,
          short,
          seeded(seed),
        )
      : { cards: [] as BrowseCard[], cursor: mine.cursor, exhausted: true }

  return {
    cards: weave(fresh.cards, [...mine.cards, ...extra.cards]),
    mineCursor: extra.cursor,
    seed,
    end: mine.exhausted && fresh.exhausted,
  }
}

export const getBrowseStart = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BrowseStart> => {
    const user = await requireUser()
    const db = getDb()
    const [settings, row] = await Promise.all([
      readSettings(user.id),
      db.query.userSettings.findFirst({
        where: eq(userSettings.userId, user.id),
        columns: { browseSource: true },
      }),
    ])
    const source = asBrowseSource(row?.browseSource)

    const page = await browsePageFor({
      userId: user.id,
      source,
      level: settings.cefrLevel,
      mineCursor: 0,
    })

    const saved = await db.query.words.findMany({
      where: eq(words.userId, user.id),
      columns: { id: true },
    })

    return {
      ...page,
      source,
      level: settings.cefrLevel,
      savedTotal: saved.length,
      levelHint: await levelHint(user.id, settings.cefrLevel),
    }
  },
)

/**
 * Whether this level has stopped teaching them anything.
 *
 * Counted from the words they said they already knew, at their current level
 * only: the point of the count is "this level is too easy for you now", and
 * words dismissed back when they were a B1 say nothing about B2.
 */
async function levelHint(userId: string, level: CefrLevel) {
  const next = CEFR_LEVELS[CEFR_LEVELS.indexOf(level) + 1]
  if (!next) return null

  const db = getDb()
  const known = await db.query.wordOffers.findMany({
    where: eq(wordOffers.userId, userId),
    columns: { normalized: true, verdict: true },
  })
  const here = known.filter(
    (row) => row.verdict === 'known' && poolEntry(row.normalized)?.level === level,
  )
  return here.length >= LEVEL_HINT_AT ? next : null
}

export const getBrowseMore = createServerFn({ method: 'POST' })
  .validator((data: { source: string; mineCursor: number; seed?: number }) => ({
    source: asBrowseSource(data.source),
    mineCursor: Math.max(0, Math.floor(data.mineCursor) || 0),
    // Zero asks for a new order, which is what switching source wants.
    seed: Math.max(0, Math.floor(data.seed ?? 0) || 0),
  }))
  .handler(async ({ data }): Promise<BrowsePage> => {
    const user = await requireUser()
    const settings = await readSettings(user.id)
    return browsePageFor({
      userId: user.id,
      source: data.source,
      level: settings.cefrLevel,
      mineCursor: data.mineCursor,
      seed: data.seed,
    })
  })

export const setBrowseSource = createServerFn({ method: 'POST' })
  .validator((data: { source: string }) => ({
    source: asBrowseSource(data.source),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await getDb()
      .update(userSettings)
      .set({ browseSource: data.source, updatedAt: new Date().toISOString() })
      .where(eq(userSettings.userId, user.id))
    return data
  })

/**
 * Retire a word the learner already knows.
 *
 * Deliberately not a review: nothing here touches familiarity or scheduling,
 * because a tap on a card they were idly scrolling past is not evidence of
 * anything except that they did not need this one.
 */
export const markWordKnown = createServerFn({ method: 'POST' })
  .validator((data: { headword: string }) => ({
    headword: normalizeHeadword(data.headword),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (!data.headword) throw new Error('Missing word')

    const now = new Date().toISOString()
    await getDb()
      .insert(wordOffers)
      .values({
        userId: user.id,
        normalized: data.headword,
        offeredAt: now,
        verdict: 'known',
      })
      .onConflictDoUpdate({
        target: [wordOffers.userId, wordOffers.normalized],
        set: { verdict: 'known', offeredAt: now },
      })
    return { ok: true }
  })
