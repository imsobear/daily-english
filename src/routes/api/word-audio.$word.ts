import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/word-audio/$word')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { serveWordAudio } = await import('#/server/word-audio')
        return serveWordAudio(params.word, request)
      },
    },
  },
})
