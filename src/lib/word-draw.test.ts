import { describe, expect, it } from 'vitest'

import { seeded } from '#/lib/browse'
import { drawWords, type Drawable } from '#/lib/word-draw'

const NOW = Date.parse('2026-09-09T00:00:00.000Z')
const DAY = 86_400_000

/** A saved word, described by how long ago it was saved. */
function saved(id: string, daysAgo: number, extra: Partial<Drawable> = {}) {
  return {
    id,
    dueAt: null,
    familiarity: 0,
    createdAt: new Date(NOW - daysAgo * DAY).toISOString(),
    ...extra,
  }
}

/** A collection of `n` words all saved the same number of days ago. */
function batch(prefix: string, n: number, daysAgo: number) {
  return Array.from({ length: n }, (_, i) => saved(`${prefix}${i}`, daysAgo))
}

function draw(
  collection: Drawable[],
  options: {
    taught?: string[]
    recent?: string[]
    count?: number
    seed?: number
  } = {},
) {
  return drawWords({
    collection,
    taught: new Set(options.taught ?? []),
    recent: new Set(options.recent ?? []),
    count: options.count ?? 10,
    now: NOW,
    random: seeded(options.seed ?? 1),
  })
}

describe('drawWords', () => {
  it('reaches a word saved today, however long the backlog is', () => {
    const collection = [...batch('old', 300, 40), saved('today', 0)]

    const picks = draw(collection).map((word) => word.id)

    expect(picks).toContain('today')
    expect(picks).toHaveLength(10)
  })

  it('gives a new save better odds than one from last week', () => {
    const collection = [...batch('week', 20, 7), ...batch('today', 20, 0)]

    let today = 0
    for (let seed = 1; seed <= 40; seed++) {
      today += draw(collection, { seed }).filter((word) =>
        word.id.startsWith('today'),
      ).length
    }
    const week = 40 * 10 - today

    expect(today).toBeGreaterThan(week)
  })

  it('does not reward a word for aging out of the fresh window', () => {
    const collection = [...batch('inside', 30, 6), ...batch('outside', 30, 8)]

    let inside = 0
    for (let seed = 1; seed <= 40; seed++) {
      inside += draw(collection, { seed }).filter((word) =>
        word.id.startsWith('inside'),
      ).length
    }

    // Losing the reserved slot must not be a promotion. It was, while the two
    // groups drew from separate pools and the larger pool held the older words.
    expect(inside).toBeGreaterThan(40 * 10 - inside)
  })

  it('treats words saved in one sitting alike', () => {
    const collection = batch('burst', 20, 0)

    const counts = new Map<string, number>()
    for (let seed = 1; seed <= 120; seed++) {
      for (const word of draw(collection, { seed })) {
        counts.set(word.id, (counts.get(word.id) ?? 0) + 1)
      }
    }

    // More saved at once than the reserved slots want, so something has to give
    // way — but on when they were saved, and they were all saved together.
    const seen = collection.map((word) => counts.get(word.id) ?? 0)
    expect(Math.min(...seen)).toBeGreaterThan(0.6 * Math.max(...seen))
  })

  it('spends most of a lesson on words no lesson has taught', () => {
    const collection = [...batch('new', 50, 20), ...batch('done', 50, 20)]
    const taught = collection.slice(50).map((word) => word.id)

    const picks = draw(collection, { taught })

    expect(picks.filter((word) => word.id.startsWith('new'))).toHaveLength(10)
  })

  it('does not let the backlog crowd out a word that is due', () => {
    const collection = [
      ...batch('waiting', 200, 40),
      ...batch('due', 10, 40).map((word) => ({
        ...word,
        dueAt: Math.floor(NOW / 1000) - 86_400,
      })),
    ]
    const taught = collection.slice(200).map((word) => word.id)

    const picks = draw(collection, { taught })

    expect(picks.filter((word) => word.id.startsWith('due'))).toHaveLength(3)
  })

  it('leaves a word alone for a while after teaching it', () => {
    const due = (id: string) =>
      saved(id, 40, { dueAt: Math.floor(NOW / 1000) - 86_400 })
    const collection = [due('just-taught'), ...batch('other', 20, 40)]
    const taught = collection.map((word) => word.id)

    let seen = 0
    for (let seed = 1; seed <= 40; seed++) {
      const picks = draw(collection, {
        taught,
        recent: ['just-taught'],
        seed,
      })
      if (picks.some((word) => word.id === 'just-taught')) seen += 1
    }

    // Due and the only word its bucket holds, so a reserved slot would have
    // handed it back every time.
    expect(seen).toBe(0)
  })

  it('varies from one lesson to the next', () => {
    const collection = batch('word', 60, 20)

    const first = draw(collection, { seed: 1 }).map((word) => word.id)
    const second = draw(collection, { seed: 2 }).map((word) => word.id)

    expect(first).not.toEqual(second)
  })

  it('works through a collection instead of circling the same words', () => {
    const collection = batch('word', 60, 20)

    const seen = new Set<string>()
    for (let seed = 1; seed <= 6; seed++) {
      for (const word of draw(collection, { seed })) seen.add(word.id)
    }

    // Six lessons is 60 slots against 60 words. An even sweep is not the point
    // and randomness will not give one, but half the collection is a long way
    // from the ten words a queue would keep handing back.
    expect(seen.size).toBeGreaterThan(30)
  })

  it('teaches a word again rather than ship a short lesson', () => {
    const collection = batch('word', 4, 20)
    const taught = collection.map((word) => word.id)

    const picks = draw(collection, { taught, recent: taught })

    expect(picks).toHaveLength(4)
  })

  it('hands back nothing when there is nothing saved', () => {
    expect(draw([])).toEqual([])
    expect(draw(batch('word', 5, 1), { count: 0 })).toEqual([])
  })

  it('picks each word once', () => {
    const collection = batch('word', 12, 3)

    const picks = draw(collection)

    expect(new Set(picks.map((word) => word.id)).size).toBe(picks.length)
  })

  it('still places a word whose saved date is unreadable', () => {
    const collection = [saved('broken', 0, { createdAt: 'not a date' })]

    expect(draw(collection).map((word) => word.id)).toEqual(['broken'])
  })
})
