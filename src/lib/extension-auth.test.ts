import { describe, expect, test } from 'vitest'

import { parseAddWordBody, parseBearerToken } from './extension-auth'

describe('parseBearerToken', () => {
  test('reads the token out of a Bearer header', () => {
    const token = '2d1c0b9a-8f76-4e5d-b3c2-1a0f9e8d7c6b.1800000000.c2ln'
    expect(parseBearerToken(`Bearer ${token}`)).toBe(token)
  })

  test('returns null for a missing or differently framed header', () => {
    expect(parseBearerToken(null)).toBeNull()
    expect(parseBearerToken('Basic abc')).toBeNull()
    expect(parseBearerToken('Bearer ')).toBeNull()
  })
})

describe('parseAddWordBody', () => {
  test('normalizes a word or short phrase', () => {
    expect(parseAddWordBody({ headword: '  Despite  That  ' })).toEqual({
      ok: true,
      headword: 'despite that',
    })
  })

  test('rejects empty or overlong input', () => {
    expect(parseAddWordBody({ headword: '   ' }).ok).toBe(false)
    expect(parseAddWordBody({ headword: 'x'.repeat(81) }).ok).toBe(false)
    expect(parseAddWordBody({})).toEqual({
      ok: false,
      error: 'Enter a word or short phrase',
    })
  })
})
