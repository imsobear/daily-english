import { describe, expect, it } from 'vitest'

import { addTally, EMPTY_TALLY, PREWARM_BATCH, prewarmPlan } from '#/lib/prewarm'
import { poolLevel } from '#/lib/vocabulary'

describe('prewarmPlan', () => {
  it('covers every word of a level exactly once', () => {
    const batches = prewarmPlan(['C2'])
    const words = batches.flatMap((batch) => batch.words)

    expect(words).toEqual(poolLevel('C2').map((word) => word.headword))
    expect(new Set(words).size).toBe(words.length)
  })

  it('splits into steps no larger than a batch', () => {
    const batches = prewarmPlan(['B1', 'B2'])

    expect(batches.every((batch) => batch.words.length <= PREWARM_BATCH)).toBe(
      true,
    )
    // Step names are built from level and offset, so those have to be unique.
    const names = batches.map((batch) => `${batch.level}-${batch.offset}`)
    expect(new Set(names).size).toBe(names.length)
  })

  it('walks the whole pool by default', () => {
    const all = prewarmPlan().flatMap((batch) => batch.words)

    expect(all.length).toBeGreaterThan(4000)
  })
})

describe('addTally', () => {
  it('sums the parts of a run', () => {
    const one = { seen: 20, defined: 4, spoken: 20, failed: 1 }
    expect(addTally(EMPTY_TALLY, one)).toEqual(one)
    expect(addTally(one, one)).toEqual({
      seen: 40,
      defined: 8,
      spoken: 40,
      failed: 2,
    })
  })
})
