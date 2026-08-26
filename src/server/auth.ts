import { createServerFn } from '@tanstack/react-start'

import { oauthConfigured } from '#/lib/oauth'
import {
  currentUser,
  readAccount,
  requireUser,
  signOutSession,
} from '#/lib/session'
import { isOnboarded } from '#/server/onboarding'

export type AccountSnapshot = {
  userId: string
  email: string | null
  signedIn: boolean
}

/** What the route guard needs, and nothing more: two booleans. */
export type SessionSnapshot = {
  signedIn: boolean
  onboarded: boolean
}

export const getAccount = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AccountSnapshot> => {
    const user = await requireUser()
    const account = await readAccount(user.id)
    return { ...account, userId: user.id }
  },
)

/** What the sign-in page needs to know before it renders. */
export const getSignInOptions = createServerFn({ method: 'GET' }).handler(
  async () => ({
    signedIn: Boolean(await currentUser()),
    canSignIn: oauthConfigured(),
  }),
)

export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionSnapshot> => {
    const user = await currentUser()
    if (!user) return { signedIn: false, onboarded: false }
    return { signedIn: true, onboarded: await isOnboarded(user.id) }
  },
)

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  signOutSession()
  return { ok: true as const }
})
