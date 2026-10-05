/** Where the app lives now. */
export const SITE_HOST = 'english.goodone.si'

/** Where it used to live, kept attached to the Worker only to send people on. */
export const LEGACY_HOST = 'english.readish.app'

/**
 * Paths the old host still answers itself.
 *
 * An installed copy of the Chrome extension talks to the old host directly:
 * it reads its session cookie from there and sends it as a bearer token. A
 * redirect would not help it, because a browser drops the Authorization header
 * when a redirect crosses origins, and a sign-in that finished on the new host
 * would leave its cookie where the old extension cannot see it. So until that
 * copy is updated, its API and its sign-in stay put.
 */
const KEPT_ON_LEGACY_HOST = ['/api/extension/', '/api/auth/google']

/**
 * The permanent redirect a request to the old host gets, or null when the
 * request should be served as it is.
 *
 * 308 rather than 301 so a POST is repeated as a POST.
 */
export function legacyRedirect(request: Request): Response | null {
  const url = new URL(request.url)
  if (url.hostname !== LEGACY_HOST) return null
  if (KEPT_ON_LEGACY_HOST.some((path) => url.pathname.startsWith(path))) {
    return null
  }

  url.hostname = SITE_HOST
  return new Response(null, {
    status: 308,
    headers: { Location: url.toString() },
  })
}
