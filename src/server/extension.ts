import { eq } from 'drizzle-orm'

import { getDb } from '#/db'
import { users } from '#/db/schema'
import { parseAddWordBody, parseBearerToken } from '#/lib/extension-auth'
import { readToken } from '#/lib/session'
import { saveWordForUser } from '#/server/words'

const SIGN_IN = 'Sign in with Gmail first'

export type ExtensionAccount = {
  email: string | null
  signedIn: boolean
}

/** The account a bearer token proves, once its signature has been checked. */
async function bearerUserId(authorization: string | null) {
  return readToken(parseBearerToken(authorization))
}

async function loadGoogleUser(authorization: string | null) {
  const userId = await bearerUserId(authorization)
  if (!userId) return { status: 401 as const, error: SIGN_IN }

  const row = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
  })
  if (!row) return { status: 401 as const, error: SIGN_IN }
  if (!row.googleId) return { status: 403 as const, error: SIGN_IN }
  return { status: 200 as const, user: row }
}

export async function extensionAccount(
  authorization: string | null,
): Promise<ExtensionAccount> {
  const userId = await bearerUserId(authorization)
  if (!userId) return { email: null, signedIn: false }

  const row = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
  })
  return {
    email: row?.email ?? null,
    signedIn: Boolean(row?.googleId),
  }
}

export async function extensionAddWord(
  authorization: string | null,
  body: unknown,
): Promise<Response> {
  const auth = await loadGoogleUser(authorization)
  if (auth.status !== 200) {
    return Response.json({ error: auth.error }, { status: auth.status })
  }

  const parsed = parseAddWordBody(body)
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const result = await saveWordForUser(auth.user.id, {
      headword: parsed.headword,
      source: 'manual',
    })
    return Response.json({
      created: result.created,
      word: { headword: result.word.headword },
    })
  } catch (error) {
    console.error('Extension add word failed', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not add word' },
      { status: 500 },
    )
  }
}
