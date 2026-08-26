import { describe, expect, it } from 'vitest'

import { asBrowseSource, makeSeed, mineShare, seeded, weave } from '#/lib/browse'

describe('weave', () => {
  it('puts one of the learner\'s words in every fourth slot', () => {
    const fresh = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const mine = ['X', 'Y', 'Z']

    expect(weave(fresh, mine)).toEqual([
      'a',
      'b',
      'c',
      'X',
      'd',
      'e',
      'f',
      'Y',
      'g',
      'h',
      'i',
      'Z',
    ])
  })

  it('keeps going when the learner has nothing saved', () => {
    expect(weave(['a', 'b', 'c', 'd', 'e'], [])).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
  })

  it('falls back to saved words once the pool runs dry', () => {
    // An exhausted level should not shorten the page.
    expect(weave(['a'], ['X', 'Y', 'Z'])).toEqual(['a', 'X', 'Y', 'Z'])
  })

  it('loses nothing from either side', () => {
    const woven = weave(['a', 'b', 'c'], ['X', 'Y'])
    expect(woven).toHaveLength(5)
    expect([...woven].sort()).toEqual(['X', 'Y', 'a', 'b', 'c'])
  })
})

describe('mineShare', () => {
  it('reserves a quarter of the page', () => {
    expect(mineShare(12)).toBe(3)
    expect(mineShare(4)).toBe(1)
    expect(mineShare(3)).toBe(0)
  })
})

describe('seeded', () => {
  it('gives the same sequence to the same seed', () => {
    const first = Array.from({ length: 5 }, seeded(42))
    const again = Array.from({ length: 5 }, seeded(42))

    expect(first).toEqual(again)
  })

  it('gives a different one to a different seed', () => {
    expect(Array.from({ length: 5 }, seeded(42))).not.toEqual(
      Array.from({ length: 5 }, seeded(43)),
    )
  })

  it('stays between zero and one', () => {
    const random = seeded(7)
    for (let i = 0; i < 500; i += 1) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('makeSeed', () => {
  it('never returns zero, which means "start a new visit"', () => {
    expect(makeSeed(() => 0)).toBeGreaterThan(0)
    expect(makeSeed(() => 0.999999)).toBeGreaterThan(0)
  })
})

describe('asBrowseSource', () => {
  it('falls back to the mix for anything unrecognised', () => {
    expect(asBrowseSource('mine')).toBe('mine')
    expect(asBrowseSource('new')).toBe('new')
    expect(asBrowseSource('everything')).toBe('mix')
    expect(asBrowseSource(undefined)).toBe('mix')
  })
})
