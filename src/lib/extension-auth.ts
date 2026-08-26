import { normalizeHeadword } from '#/lib/dictionary'

/**
 * The token out of an `Authorization: Bearer` header, unverified.
 *
 * The extension sends the session cookie it read from the app's own domain,
 * so what comes back here is a signed session token; whether the signature
 * holds is for the session module to say.
 */
export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
  return match ? match[1] : null
}

export type ParsedHeadword =
  | { ok: true; headword: string }
  | { ok: false; error: string }

export function parseAddWordBody(data: unknown): ParsedHeadword {
  const raw =
    data && typeof data === 'object' && 'headword' in data
      ? (data as { headword: unknown }).headword
      : undefined
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Enter a word or short phrase' }
  }
  const headword = normalizeHeadword(raw)
  if (headword.length < 1 || headword.length > 80) {
    return { ok: false, error: 'Enter a word or short phrase' }
  }
  return { ok: true, headword }
}
