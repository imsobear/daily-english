import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/extension/words')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { extensionAddWord } = await import('#/server/extension')
        let body: unknown = null
        try {
          body = await request.json()
        } catch {
          return Response.json(
            { error: 'Enter a word or short phrase' },
            { status: 400 },
          )
        }
        return extensionAddWord(request.headers.get('authorization'), body)
      },
    },
  },
})
