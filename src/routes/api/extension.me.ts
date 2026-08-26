import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/extension/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { extensionAccount } = await import('#/server/extension')
        return Response.json(
          await extensionAccount(request.headers.get('authorization')),
        )
      },
    },
  },
})
