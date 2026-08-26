import { createFileRoute } from '@tanstack/react-router'

/**
 * Sign in as a test learner, without Google.
 *
 * Guests are gone, so a local run and a browser test would otherwise need a
 * real Google account and a consent screen. The guard is `import.meta.env.DEV`
 * rather than a runtime flag on purpose: Vite replaces the constant at build
 * time, so in the deployed Worker the handler below is dead code and the door
 * does not exist rather than merely being shut.
 */
export const Route = createFileRoute('/api/auth/dev')({
  server: {
    handlers: {
      GET: async () => {
        if (!import.meta.env.DEV) {
          return new Response('Not found', { status: 404 })
        }
        const { sessionCookieHeader, signInWithGoogle } = await import(
          '#/lib/session'
        )
        // A fixed identity, so restarting the dev server lands on the same
        // account and the words added last time are still there.
        const user = await signInWithGoogle(
          { googleId: 'dev-local', email: 'dev@localhost' },
          { writeCookie: false },
        )
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/',
            'Set-Cookie': await sessionCookieHeader(user.id),
          },
        })
      },
    },
  },
})
