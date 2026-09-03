import { describe, expect, it } from 'vitest'

import { baseForm } from '#/lib/inflections'
import { partsOf } from '#/lib/lexicon'

/** Read against the real lexicon: the point of it is which words it knows. */
const base = (word: string) => baseForm(word, partsOf)

describe('baseForm', () => {
  it('reads a participle as the verb underneath it', () => {
    expect(base('building')).toBe('build')
    expect(base('dancing')).toBe('dance')
    expect(base('running')).toBe('run')
    expect(base('experienced')).toBe('experience')
  })

  it('reads a comparative as the adjective underneath it', () => {
    expect(base('cleaner')).toBe('clean')
    expect(base('later')).toBe('late')
    expect(base('stranger')).toBe('strange')
  })

  it('gives up on the shortest adjectives rather than misread "offer"', () => {
    // "bigger" is a comparative and this cannot see it, because seeing it
    // means trusting three-letter adjectives, and that is where "off" lives.
    // No word the pool teaches is built on one, so the trade costs nothing.
    expect(base('bigger')).toBeNull()
  })

  it('leaves a word alone when the shorter string is not a word', () => {
    // The failure this is here for: "squash" is not a form of anything, and
    // reading it as one cost the card its verb.
    expect(base('squash')).toBeNull()
    expect(base('spring')).toBeNull()
    expect(base('string')).toBeNull()
    expect(base('ceiling')).toBeNull()
  })

  it('knows an agent noun is a word and not a comparative', () => {
    // All of these end in -er over a real word, and none of them is a form of
    // it: a manager is not a more-managed anything.
    expect(base('manager')).toBeNull()
    expect(base('writer')).toBeNull()
    expect(base('runner')).toBeNull()
    expect(base('computer')).toBeNull()
  })

  it('is not fooled by an ending that only looks like one', () => {
    expect(base('letter')).toBeNull()
    expect(base('batter')).toBeNull()
    expect(base('digest')).toBeNull()
    expect(base('earnest')).toBeNull()
    // "off" is an adjective in "the milk is off", which made this a comparative.
    expect(base('offer')).toBeNull()
  })

  it('reads a plural as its singular', () => {
    expect(base('powers')).toBe('power')
    expect(base('studies')).toBe('study')
  })
})
