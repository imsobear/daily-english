import { describe, expect, it } from 'vitest'

import { asBrowseSource, mineShare, weave } from '#/lib/browse'

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

describe('asBrowseSource', () => {
  it('falls back to the mix for anything unrecognised', () => {
    expect(asBrowseSource('mine')).toBe('mine')
    expect(asBrowseSource('new')).toBe('new')
    expect(asBrowseSource('everything')).toBe('mix')
    expect(asBrowseSource(undefined)).toBe('mix')
  })
})
