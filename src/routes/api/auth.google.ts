import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/google')({
  server: {
    handlers: {
      GET: async () => {
        const { startGoogleOAuth } = await import('#/lib/oauth')
        return startGoogleOAuth()
      },
    },
  },
})
