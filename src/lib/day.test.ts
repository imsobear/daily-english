import { describe, expect, it } from 'vitest'

import { localDateIn } from './day'

describe('localDateIn', () => {
  it('reports the local day for an evening that is already tomorrow in UTC', () => {
    // 20:33 on the 20th in California is 03:33 on the 21st in UTC. Reading the
    // UTC date here is what discounted a lesson the moment it was finished.
    const finished = new Date('2026-08-21T03:33:58.331Z')
    expect(finished.toISOString().slice(0, 10)).toBe('2026-08-21')
    expect(localDateIn('America/Los_Angeles', finished)).toBe('2026-08-20')
  })

  it('handles zones ahead of UTC', () => {
    const morning = new Date('2026-08-20T23:10:00.000Z')
    expect(localDateIn('Asia/Shanghai', morning)).toBe('2026-08-21')
  })

  it('zero-pads single digit months and days', () => {
    expect(localDateIn('UTC', new Date('2026-01-05T12:00:00.000Z'))).toBe(
      '2026-01-05',
    )
  })

  it('rejects an unknown zone so callers can fall back', () => {
    expect(() => localDateIn('Not/AZone')).toThrow(RangeError)
  })
})
