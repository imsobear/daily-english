import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '#/db'
import { userSettings, users, wordOffers, words } from '#/db/schema'
import { saveEntry } from '#/lib/entries'
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

function page(source: 'mine' | 'mix' | 'new', mineCursor = 0) {
  return browsePageFor({ userId: user, source, level: 'B1', mineCursor })
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

  it('puts the shakiest words first', async () => {
    await saveWordsForUser(user, ['alpha', 'beta'], 'manual')
    await getDb()
      .update(words)
      .set({ familiarity: 0.9 })
      .where(eq(words.normalized, 'alpha'))

    const { cards } = await page('mine')

    expect(cards.map((card) => card.headword)).toEqual(['beta', 'alpha'])
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
    await saveEntry(getDb(), {
      headword,
      ipa: '/test/',
      definitions: [
        { partOfSpeech: 'noun', definition: 'a thing' },
        { partOfSpeech: 'verb', definition: 'to do it' },
      ],
      examples: ['first example', 'second example'],
      senseSource: 'model',
    })
    await saveWordsForUser(user, [headword], 'manual')

    const { cards } = await page('mine')

    expect(cards).toHaveLength(1)
    expect(cards[0].definitions).toEqual([
      { partOfSpeech: 'noun', definition: 'a thing' },
      { partOfSpeech: 'verb', definition: 'to do it' },
    ])
    expect(cards[0].examples).toEqual(['first example', 'second example'])
  })

  it('reports the end when there is nothing to show', async () => {
    const { cards, end } = await page('mine')

    expect(cards).toHaveLength(0)
    expect(end).toBe(true)
  })
})
