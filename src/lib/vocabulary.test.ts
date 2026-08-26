import { describe, expect, it } from 'vitest'

import { pickRecommendations, starterWords } from '#/lib/vocabulary'
import { CEFR_LEVELS } from '#/lib/settings'

const headwordsOf = (words: { headword: string }[]) =>
  words.map((word) => word.headword)

describe('pickRecommendations', () => {
  it('fills the row at every level', () => {
    for (const level of CEFR_LEVELS) {
      expect(pickRecommendations({ level, owned: [] })).toHaveLength(24)
    }
  })

  it('never repeats a word inside one set', () => {
    const picks = headwordsOf(pickRecommendations({ level: 'B2', owned: [] }))
    expect(new Set(picks).size).toBe(picks.length)
  })

  it('mixes parts of speech rather than handing over a pile of nouns', () => {
    const picks = pickRecommendations({ level: 'C1', owned: [] })
    const nouns = picks.filter((word) => word.pos === 'n')
    expect(nouns.length).toBeLessThan(picks.length / 2)
    expect(new Set(picks.map((word) => word.pos)).size).toBe(4)
  })

  it('draws from the level and the one below it, and no higher', () => {
    const levels = new Set(
      pickRecommendations({ level: 'B2', owned: [] }).map((word) => word.level),
    )
    expect(levels).toEqual(new Set(['B2', 'B1']))
  })

  it('leaves out words the learner already has', () => {
    const owned = headwordsOf(pickRecommendations({ level: 'B1', owned: [] }))

    const picks = headwordsOf(pickRecommendations({ level: 'B1', owned }))

    expect(picks.filter((word) => owned.includes(word))).toEqual([])
  })

  it('leaves out words already offered, which is what makes a new set new', () => {
    const first = headwordsOf(pickRecommendations({ level: 'C1', owned: [] }))

    const second = headwordsOf(
      pickRecommendations({ level: 'C1', owned: [], offered: first }),
    )

    expect(second.filter((word) => first.includes(word))).toEqual([])
  })

  it('keeps producing new words for weeks of refreshing', () => {
    const seen: string[] = []
    for (let set = 0; set < 40; set += 1) {
      const picks = headwordsOf(
        pickRecommendations({ level: 'C1', owned: [], offered: seen }),
      )
      expect(picks.filter((word) => seen.includes(word))).toEqual([])
      seen.push(...picks)
    }
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('offers the oldest words again rather than an empty row', () => {
    // Everything at C2 and C1 has been shown; the row should still be full,
    // and should start with what was shown longest ago.
    const everything: string[] = []
    for (let set = 0; set < 200; set += 1) {
      const picks = headwordsOf(
        pickRecommendations({ level: 'C2', owned: [], offered: everything }),
      )
      const fresh = picks.filter((word) => !everything.includes(word))
      if (fresh.length === 0) break
      everything.push(...fresh)
    }

    const picks = headwordsOf(
      pickRecommendations({ level: 'C2', owned: [], offered: everything }),
    )

    expect(picks).toHaveLength(24)
    expect(everything.slice(0, 24).sort()).toEqual(picks.sort())
  })

  it('does not recycle a word the learner has since saved', () => {
    const offered = headwordsOf(pickRecommendations({ level: 'A2', owned: [] }))

    const picks = headwordsOf(
      pickRecommendations({
        level: 'A2',
        owned: offered.slice(0, 5),
        offered,
        limit: 24,
      }),
    )

    expect(picks.filter((word) => offered.slice(0, 5).includes(word))).toEqual([])
  })

  it('is a fresh draw each time, not a fixed list', () => {
    const first = headwordsOf(pickRecommendations({ level: 'B2', owned: [] }))
    const second = headwordsOf(pickRecommendations({ level: 'B2', owned: [] }))

    const shared = first.filter((word) => second.includes(word))
    expect(shared.length).toBeLessThan(12)
  })

  it('takes its randomness from the caller, so a run can be reproduced', () => {
    const scripted = () => {
      let n = 0
      return () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648)
    }

    expect(
      headwordsOf(pickRecommendations({ level: 'B1', owned: [], random: scripted() })),
    ).toEqual(
      headwordsOf(pickRecommendations({ level: 'B1', owned: [], random: scripted() })),
    )
  })
})

describe('starterWords', () => {
  it('hands a new learner a full lesson at their level', () => {
    const picks = starterWords({ level: 'B1', count: 10 })
    expect(picks).toHaveLength(10)
    expect(new Set(picks).size).toBe(10)
  })
})
