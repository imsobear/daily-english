import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { getDb } from '#/db'
import { userSettings, users } from '#/db/schema'
import { issueToken, readToken, signInWithGoogle } from '#/lib/session'

/** Signing needs the Worker env, so these run inside workerd like the rest. */
describe('session tokens', () => {
  const user = '2d1c0b9a-8f76-4e5d-b3c2-1a0f9e8d7c6b'

  it('reads back the user it was issued for', async () => {
    expect(await readToken(await issueToken(user))).toBe(user)
  })

  it('refuses a token nobody signed', async () => {
    const expires = Math.floor(Date.now() / 1000) + 60
    expect(await readToken(`${user}.${expires}.not-a-signature`)).toBeNull()
  })

  it('refuses a token whose payload was edited after signing', async () => {
    const token = await issueToken(user)
    const [, expires, signature] = token.split('.')
    const other = '00000000-0000-4000-8000-000000000000'
    expect(await readToken(`${other}.${expires}.${signature}`)).toBeNull()
  })

  it('refuses an expired token', async () => {
    const token = await issueToken(user)
    const year = 366 * 86_400_000
    expect(await readToken(token, Date.now() + year)).toBeNull()
  })

  it('refuses nothing at all', async () => {
    expect(await readToken(null)).toBeNull()
    expect(await readToken('')).toBeNull()
    expect(await readToken('garbage')).toBeNull()
  })
})

describe('signInWithGoogle', () => {
  async function rows(googleId: string) {
    return getDb().query.users.findMany({ where: eq(users.googleId, googleId) })
  }

  it('creates the account and its settings on first sign-in', async () => {
    const googleId = `google-${crypto.randomUUID()}`

    const account = await signInWithGoogle(
      { googleId, email: 'learner@example.com' },
      { writeCookie: false },
    )

    const settings = await getDb().query.userSettings.findFirst({
      where: eq(userSettings.userId, account.id),
    })
    expect(await rows(googleId)).toHaveLength(1)
    expect(settings?.cefrLevel).toBe('B1')
  })

  it('returns the same account the second time', async () => {
    const googleId = `google-${crypto.randomUUID()}`
    const first = await signInWithGoogle(
      { googleId, email: 'learner@example.com' },
      { writeCookie: false },
    )

    const second = await signInWithGoogle(
      { googleId, email: 'learner@example.com' },
      { writeCookie: false },
    )

    expect(second.id).toBe(first.id)
    expect(await rows(googleId)).toHaveLength(1)
  })

  it('follows an address change at Google', async () => {
    const googleId = `google-${crypto.randomUUID()}`
    const account = await signInWithGoogle(
      { googleId, email: 'old@example.com' },
      { writeCookie: false },
    )

    await signInWithGoogle(
      { googleId, email: 'new@example.com' },
      { writeCookie: false },
    )

    const row = await getDb().query.users.findFirst({
      where: eq(users.id, account.id),
    })
    expect(row?.email).toBe('new@example.com')
  })
})
