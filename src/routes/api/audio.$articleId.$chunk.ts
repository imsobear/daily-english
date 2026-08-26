import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/audio/$articleId/$chunk')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { serveArticleAudio } = await import('#/server/audio')
        const index = Number.parseInt(params.chunk, 10)
        return serveArticleAudio(
          params.articleId,
          Number.isFinite(index) ? index : 0,
          request,
        )
      },
    },
  },
})
