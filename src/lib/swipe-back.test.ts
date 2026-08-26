import { beforeEach, describe, expect, it } from 'vitest'

import { armSwipeBack, claimSwipeBack } from '#/lib/swipe-back'

const START = 1_000_000

describe('claimSwipeBack', () => {
  beforeEach(() => {
    // Whatever an earlier case left armed.
    claimSwipeBack(START)
  })

  it('claims the pop the swipe caused', () => {
    armSwipeBack(START)
    expect(claimSwipeBack(START + 200)).toBe(true)
  })

  it('claims it only once, so the next back still animates', () => {
    armSwipeBack(START)
    claimSwipeBack(START + 200)
    expect(claimSwipeBack(START + 400)).toBe(false)
  })

  it('lets go of a swipe that never became a pop', () => {
    armSwipeBack(START)
    expect(claimSwipeBack(START + 5_000)).toBe(false)
  })

  it('says no when there was no swipe at all', () => {
    expect(claimSwipeBack(START)).toBe(false)
  })
})
