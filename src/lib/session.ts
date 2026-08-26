import { redirect } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import {
  deleteCookie,
  getCookie,
  getRequest,
  setCookie,
} from '@tanstack/react-start/server'

import { getDb, getEnv } from '#/db'
import { userSettings, users } from '#/db/schema'
import { defaultSettings } from '#/lib/settings'

export const SESSION_COOKIE = 'uid'
const COOKIE = SESSION_COOKIE
const YEAR = 60 * 60 * 24 * 365

export type SessionUser = {
  id: string
  createdAt: string
}

/**
 * The signing key for session tokens.
 *
 * Rotating `SESSION_SECRET` signs every outstanding session out, which is the
 * only revocation this app has. Missing in production is fatal on purpose: a
 * silent fallback would mean tokens anyone could mint for themselves.
 */
let cached: { secret: string; key: Promise<CryptoKey> } | null = null

function signingKey() {
  const env = getEnv() as Cloudflare.Env & { SESSION_SECRET?: string }
  const secret =
    env.SESSION_SECRET?.trim() ||
    (import.meta.env.DEV ? 'local-development-secret' : '')
  if (!secret) throw new Error('SESSION_SECRET is not configured')

  if (cached?.secret !== secret) {
    cached = {
      secret,
      key: crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      ),
    }
  }
  return cached.key
}

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * A session token: the user id and an expiry, signed.
 *
 * The value used to be the bare user id, which made the cookie a password that
 * never expired and could not be withdrawn — and the extension sends the same
 * value as a bearer token, so it travelled further than a cookie normally
 * does. Signing means a stolen id is not enough and a rotated secret ends
 * every session at once.
 */
export async function issueToken(
  userId: string,
  now = Date.now(),
): Promise<string> {
  const expires = Math.floor(now / 1000) + YEAR
  const payload = `${userId}.${expires}`
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(),
    new TextEncoder().encode(payload),
  )
  return `${payload}.${base64url(signature)}`
}

/** The user id a token vouches for, or null if it is forged or expired. */
export async function readToken(
  token: string | null | undefined,
  now = Date.now(),
): Promise<string | null> {
  if (!token) return null
  const cut = token.lastIndexOf('.')
  if (cut < 0) return null

  const payload = token.slice(0, cut)
  const [userId, expires] = payload.split('.')
  if (!userId || !expires) return null
  if (!Number.isFinite(Number(expires))) return null
  if (Number(expires) * 1000 <= now) return null

  let signature: Uint8Array<ArrayBuffer>
  try {
    signature = fromBase64url(token.slice(cut + 1))
  } catch {
    return null
  }

  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(),
    signature,
    new TextEncoder().encode(payload),
  )
  return valid ? userId : null
}

function stampCookie(token: string) {
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: YEAR,
    secure: getRequest().url.startsWith('https://'),
  })
}

export async function sessionCookieHeader(userId: string) {
  const parts = [
    `${COOKIE}=${await issueToken(userId)}`,
    'Path=/',
    `Max-Age=${YEAR}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (getRequest().url.startsWith('https://')) parts.push('Secure')
  return parts.join('; ')
}

/** The signed-in user's id, without touching the database. */
export async function currentUserId(): Promise<string | null> {
  return readToken(getCookie(COOKIE))
}

/**
 * Who is asking, or null if nobody is.
 *
 * Never creates anything. Silently minting a user on any request is how 202
 * accounts came to exist for six people: every crawler that reached a server
 * function was handed one.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const id = await currentUserId()
  if (!id) return null
  const row = await getDb().query.users.findFirst({ where: eq(users.id, id) })
  return row ? { id: row.id, createdAt: row.createdAt } : null
}

/**
 * The user, or a trip to the sign-in page.
 *
 * Server functions call this rather than checking themselves, so a route that
 * forgets its guard is still not a way in. Throwing a redirect works from a
 * loader and from a client-side call alike.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser()
  if (!user) throw redirect({ to: '/login' })
  return user
}

/** Create the account behind a verified identity, and the settings it needs. */
async function createUser(identity: {
  googleId: string
  email: string | null
}): Promise<SessionUser> {
  const db = getDb()
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  await db.insert(users).values({
    id,
    createdAt,
    googleId: identity.googleId,
    email: identity.email,
  })
  await db.insert(userSettings).values({
    userId: id,
    cefrLevel: defaultSettings.cefrLevel,
    topics: '[]',
    wordsPerLesson: defaultSettings.wordsPerLesson,
    updatedAt: createdAt,
  })

  return { id, createdAt }
}

export async function signInWithGoogle(
  identity: { googleId: string; email: string | null },
  options: { writeCookie?: boolean } = {},
): Promise<SessionUser> {
  const db = getDb()
  const existing = await db.query.users.findFirst({
    where: eq(users.googleId, identity.googleId),
  })

  const user = existing
    ? { id: existing.id, createdAt: existing.createdAt }
    : await createUser(identity)

  if (existing && identity.email && identity.email !== existing.email) {
    await db
      .update(users)
      .set({ email: identity.email })
      .where(eq(users.id, existing.id))
  }
  if (options.writeCookie !== false) stampCookie(await issueToken(user.id))
  return user
}

export async function readAccount(userId: string) {
  const db = getDb()
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })
  return {
    email: row?.email ?? null,
    signedIn: Boolean(row?.googleId),
  }
}

export function signOutSession() {
  deleteCookie(COOKIE, { path: '/' })
}
