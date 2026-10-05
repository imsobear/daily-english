import { describe, expect, test } from 'vitest'

import { legacyRedirect } from './legacy-host'

describe('legacyRedirect', () => {
  test('sends the old host to the new one, path and query intact', () => {
    const response = legacyRedirect(
      new Request('https://english.readish.app/lessons/abc?tab=quiz'),
    )
    expect(response?.status).toBe(308)
    expect(response?.headers.get('Location')).toBe(
      'https://english.goodone.si/lessons/abc?tab=quiz',
    )
  })

  test('leaves the new host and local runs alone', () => {
    expect(legacyRedirect(new Request('https://english.goodone.si/'))).toBeNull()
    expect(legacyRedirect(new Request('http://localhost:3000/'))).toBeNull()
  })

  test('keeps what an old extension calls on the old host', () => {
    for (const path of [
      '/api/extension/me',
      '/api/extension/words',
      '/api/auth/google',
      '/api/auth/google/callback?code=x',
    ]) {
      expect(
        legacyRedirect(new Request(`https://english.readish.app${path}`)),
      ).toBeNull()
    }
  })
})
