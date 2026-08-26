import { describe, expect, test } from 'vitest'

import { prepareSelection, toastCopy } from './selection'

describe('prepareSelection', () => {
  test('accepts a word or short phrase', () => {
    expect(prepareSelection('  Look  up  ')).toEqual({
      ok: true,
      headword: 'look up',
    })
  })

  test('rejects empty or overlong selections', () => {
    expect(prepareSelection('')).toEqual({
      ok: false,
      message: 'Enter a word or short phrase',
    })
    expect(prepareSelection('x'.repeat(81)).ok).toBe(false)
  })
})

describe('toastCopy', () => {
  test('reports added, duplicate, sign-in, and network failures', () => {
    expect(toastCopy({ type: 'added', headword: 'despite' })).toBe(
      'Added “despite”.',
    )
    expect(toastCopy({ type: 'duplicate', headword: 'despite' })).toBe(
      '“despite” is already in your list.',
    )
    expect(toastCopy({ type: 'signin' })).toBe('Sign in with Gmail first')
    expect(toastCopy({ type: 'network', headword: 'despite' })).toBe(
      'Could not add “despite”.',
    )
  })
})
