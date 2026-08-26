import { getCookie, getRequest } from '@tanstack/react-start/server'

import { getEnv } from '#/db'
import { signInWithGoogle, sessionCookieHeader } from '#/lib/session'

const OAUTH_COOKIE = 'oauth_pkce'
const OAUTH_TTL = 60 * 10

type OAuthCookie = {
  state: string
  verifier: string
  next?: string
}

type ProviderConfig = {
  clientId: string
  clientSecret: string
}

type OAuthEnv = {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

function oauthEnv(): OAuthEnv {
  return getEnv() as Cloudflare.Env & OAuthEnv
}

export function oauthConfigured() {
  const env = oauthEnv()
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

function googleConfig(): ProviderConfig | null {
  const env = oauthEnv()
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null
  return {
    clientId: env.GOOGLE_CLIENT_ID.trim(),
    clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
  }
}

function originOf(request: Request) {
  return new URL(request.url).origin
}

function redirectUri(request: Request) {
  return `${originOf(request)}/api/auth/google/callback`
}

function cookieHeader(name: string, value: string, maxAge: number) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (getRequest().url.startsWith('https://')) parts.push('Secure')
  return parts.join('; ')
}

function redirectResponse(url: string, cookies: string[] = []) {
  const headers = new Headers({ Location: url })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/**
 * Where to land once the round trip to Google is over. Only same-site paths
 * are honoured, so the parameter cannot be used to bounce someone off-site.
 */
function safeNext(raw: string | null | undefined) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

function authRedirect(
  request: Request,
  options: { next?: string | null; auth?: string; cookies?: string[] } = {},
) {
  // A failure goes back to the sign-in page, which is the only screen that can
  // say what went wrong — anywhere else the guard would bounce a visitor who
  // is, after all, still not signed in. Success goes home, and the guard sends
  // a first-time learner on to onboarding from there.
  const url = new URL(
    options.auth ? '/login' : (safeNext(options.next) ?? '/'),
    originOf(request),
  )
  if (options.auth) {
    url.searchParams.set('auth', options.auth)
    const next = safeNext(options.next)
    if (next) url.searchParams.set('next', next)
  }
  return redirectResponse(url.toString(), options.cookies ?? [])
}

function randomUrl(bytes: number) {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function challengeS256(verifier: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function readOAuthCookie(): OAuthCookie | null {
  const raw = getCookie(OAUTH_COOKIE)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<OAuthCookie>
    if (typeof value.state === 'string' && typeof value.verifier === 'string') {
      return {
        state: value.state,
        verifier: value.verifier,
        next: typeof value.next === 'string' ? value.next : undefined,
      }
    }
  } catch {
    // ignore malformed cookie
  }
  return null
}

export async function startGoogleOAuth(): Promise<Response> {
  const request = getRequest()
  const next = safeNext(new URL(request.url).searchParams.get('next'))
  try {
    const config = googleConfig()
    if (!config) return authRedirect(request, { next, auth: 'unconfigured' })

    const state = randomUrl(16)
    const verifier = randomUrl(32)
    const challenge = await challengeS256(verifier)
    const redirect = redirectUri(request)
    const payload = JSON.stringify({
      state,
      verifier,
      ...(next ? { next } : {}),
    } satisfies OAuthCookie)

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', redirect)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('prompt', 'select_account')

    return redirectResponse(url.toString(), [
      cookieHeader(OAUTH_COOKIE, payload, OAUTH_TTL),
    ])
  } catch (error) {
    console.error('OAuth start failed', error)
    return authRedirect(request, { next, auth: 'failed' })
  }
}

async function exchangeGoogle(
  config: ProviderConfig,
  code: string,
  redirect: string,
  verifier: string,
) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirect,
    code_verifier: verifier,
  })
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    error?: string
  }
  if (!tokenJson.access_token) {
    throw new Error(tokenJson.error ?? 'Google token exchange failed')
  }

  const userRes = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
  )
  if (!userRes.ok) throw new Error('Google profile failed')
  const profile = (await userRes.json()) as {
    sub?: string
    email?: string
  }
  if (!profile.sub) throw new Error('Google profile missing sub')
  return { googleId: profile.sub, email: profile.email ?? null }
}

export async function finishGoogleOAuth(): Promise<Response> {
  const request = getRequest()
  const url = new URL(request.url)
  const stored = readOAuthCookie()
  const clearPkce = [cookieHeader(OAUTH_COOKIE, '', 0)]
  const next = stored?.next ?? null

  if (url.searchParams.get('error') === 'access_denied') {
    return authRedirect(request, { next, auth: 'denied', cookies: clearPkce })
  }
  if (url.searchParams.get('error')) {
    return authRedirect(request, { next, auth: 'failed', cookies: clearPkce })
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state || !stored) {
    return authRedirect(request, { next, auth: 'failed', cookies: clearPkce })
  }
  if (stored.state !== state) {
    return authRedirect(request, { next, auth: 'failed', cookies: clearPkce })
  }

  const config = googleConfig()
  if (!config) {
    return authRedirect(request, {
      next,
      auth: 'unconfigured',
      cookies: clearPkce,
    })
  }

  try {
    const profile = await exchangeGoogle(
      config,
      code,
      redirectUri(request),
      stored.verifier,
    )
    const user = await signInWithGoogle(profile, { writeCookie: false })
    return authRedirect(request, {
      next,
      cookies: [...clearPkce, await sessionCookieHeader(user.id)],
    })
  } catch (error) {
    console.error('OAuth callback failed', error)
    return authRedirect(request, { next, auth: 'failed', cookies: clearPkce })
  }
}
