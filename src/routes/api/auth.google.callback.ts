import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/google/callback')({
  server: {
    handlers: {
      GET: async () => {
        const { finishGoogleOAuth } = await import('#/lib/oauth')
        return finishGoogleOAuth()
      },
    },
  },
})
