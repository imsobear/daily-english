import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '#/db'
import { userSettings, users, wordOffers, words } from '#/db/schema'
import { saveDictionary } from '#/lib/entries'
import { poolEntry, poolLevel } from '#/lib/vocabulary'
import { browsePageFor } from '#/server/browse'
import { saveWordsForUser } from '#/server/words'

let user: string

beforeEach(async () => {
  user = crypto.randomUUID()
  const now = new Date().toISOString()
  await getDb().insert(users).values({ id: user, createdAt: now })
  await getDb()
    .insert(userSettings)
    .values({ userId: user, cefrLevel: 'B1', updatedAt: now })
})

function page(source: 'mine' | 'mix' | 'new', mineCursor = 0, seed = 0) {
  return browsePageFor({ userId: user, source, level: 'B1', mineCursor, seed })
}

/** Saved words that all sit at B1, so the level filter keeps every one. */
function atLevel(count: number) {
  return poolLevel('B1')
    .slice(0, count)
    .map((word) => word.headword)
}

describe('browsePageFor', () => {
  it('shows only pool words when asked for new ones', async () => {
    await saveWordsForUser(user, ['alpha', 'beta'], 'manual')

    const { cards } = await page('new')

    expect(cards).toHaveLength(12)
    expect(cards.every((card) => card.wordId === null)).toBe(true)
    expect(cards.map((card) => card.headword)).not.toContain('alpha')
  })

  it('shows only saved words when asked for mine', async () => {
    await saveWordsForUser(user, ['alpha', 'beta', 'gamma'], 'manual')

    const { cards } = await page('mine')

    expect(cards.map((card) => card.headword).sort()).toEqual([
      'alpha',
      'beta',
      'gamma',
    ])
    expect(cards.every((card) => card.wordId !== null)).toBe(true)
  })

  it('mixes a quarter of the page from the learner list', async () => {
    await saveWordsForUser(user, ['alpha', 'beta', 'gamma'], 'manual')

    const { cards } = await page('mix')

    expect(cards).toHaveLength(12)
    expect(cards.filter((card) => card.wordId !== null)).toHaveLength(3)
    // Spaced through rather than bunched at one end.
    expect(cards[3].wordId).not.toBeNull()
    expect(cards[7].wordId).not.toBeNull()
  })

  it('fills the page from the pool when the learner has no words', async () => {
    const { cards } = await page('mix')

    expect(cards).toHaveLength(12)
    expect(cards.every((card) => card.wordId === null)).toBe(true)
  })

  it('never offers a word the learner said they know', async () => {
    const first = await page('new')
    const retired = first.cards[0].normalized
    await getDb()
      .update(wordOffers)
      .set({ verdict: 'known' })
      .where(eq(wordOffers.normalized, retired))

    // Far enough through the level that a recycled word would have surfaced.
    for (let i = 0; i < 8; i += 1) {
      const { cards } = await page('new')
      expect(cards.map((card) => card.normalized)).not.toContain(retired)
    }
  })

  it('writes down what it showed, so the next page is different', async () => {
    const first = await page('new')
    const second = await page('new')

    const seen = new Set(first.cards.map((card) => card.normalized))
    expect(second.cards.some((card) => seen.has(card.normalized))).toBe(false)

    const offers = await getDb().query.wordOffers.findMany({
      where: eq(wordOffers.userId, user),
    })
    expect(offers).toHaveLength(24)
    expect(offers.every((row) => row.verdict === 'shown')).toBe(true)
  })

  it('wraps back to the start of a short list rather than running out', async () => {
    await saveWordsForUser(user, ['alpha', 'beta'], 'manual')

    const first = await page('mine')
    expect(first.cards).toHaveLength(2)

    const second = await page('mine', first.mineCursor)
    expect(second.cards.map((card) => card.headword).sort()).toEqual([
      'alpha',
      'beta',
    ])
  })

  it('still leans on the words they are losing', async () => {
    await saveWordsForUser(user, ['alpha', 'beta'], 'manual')
    await getDb()
      .update(words)
      .set({ familiarity: 0.9 })
      .where(eq(words.normalized, 'alpha'))

    // The order is a draw now rather than a ranking, so the claim is about
    // which way it leans: a gap that wide is only rarely overturned.
    let shakiestFirst = 0
    for (let seed = 1; seed <= 10; seed += 1) {
      const { cards } = await page('mine', 0, seed)
      if (cards[0].headword === 'beta') shakiestFirst += 1
    }

    expect(shakiestFirst).toBeGreaterThanOrEqual(9)
  })

  it('shuffles the list, so two visits are not the same scroll', async () => {
    const saved = atLevel(12)
    await saveWordsForUser(user, saved, 'manual')

    const first = await page('mine', 0, 101)
    const second = await page('mine', 0, 202)

    // The same words, arrived at in a different order.
    expect(first.cards.map((card) => card.headword).sort()).toEqual(
      [...saved].sort(),
    )
    expect(first.cards.map((card) => card.headword)).not.toEqual(
      second.cards.map((card) => card.headword),
    )
  })

  it('carries the order into the next page of the same visit', async () => {
    await saveWordsForUser(user, atLevel(20), 'manual')

    const first = await page('mine', 0, 7)
    const second = await page('mine', first.mineCursor, first.seed)

    // Eight words are still unseen; only past those does the feed come round.
    const seen = new Set(first.cards.map((card) => card.normalized))
    expect(second.cards.slice(0, 8).some((card) => seen.has(card.normalized)))
      .toBe(false)
  })

  it('hands back the seed it used, even when it made one up', async () => {
    await saveWordsForUser(user, atLevel(3), 'manual')

    const { seed } = await page('mine')

    expect(seed).toBeGreaterThan(0)
  })

  it('draws pool words from the learner\'s level only', async () => {
    const { cards } = await page('new')

    expect(cards.map((card) => card.level)).toEqual(Array(12).fill('B1'))
  })

  it('leaves out saved words from another level', async () => {
    const easier = poolLevel('A2')[0].headword
    const here = poolLevel('B1')[0].headword
    await saveWordsForUser(user, [easier, here], 'manual')

    const { cards } = await page('mine')

    expect(cards.map((card) => card.headword)).toEqual([here])
  })

  it('keeps saved words the pool has never heard of', async () => {
    // Typed in or tapped out of an article: no level to disagree with.
    expect(poolEntry('zugzwang')).toBeNull()
    await saveWordsForUser(user, ['zugzwang'], 'manual')

    const { cards } = await page('mine')

    expect(cards.map((card) => card.headword)).toEqual(['zugzwang'])
    expect(cards[0].level).toBeNull()
  })

  it('puts every sense and example on the card', async () => {
    const headword = `w${crypto.randomUUID().slice(0, 8)}`
    const senses = [
      { pos: 'noun', definition: 'a thing', zh: '东西', examples: ['first'] },
      { pos: 'verb', definition: 'to do it', zh: null, examples: ['second'] },
    ]
    await saveDictionary(getDb(), headword, { headword, ipa: '/test/', senses })
    await saveWordsForUser(user, [headword], 'manual')

    const { cards } = await page('mine')

    expect(cards).toHaveLength(1)
    expect(cards[0].senses).toEqual(senses)
  })

  it('reports the end when there is nothing to show', async () => {
    const { cards, end } = await page('mine')

    expect(cards).toHaveLength(0)
    expect(end).toBe(true)
  })
})
