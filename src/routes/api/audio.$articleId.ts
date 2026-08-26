import { createFileRoute } from '@tanstack/react-router'

/** Legacy path for articles generated before audio was split into clips. */
export const Route = createFileRoute('/api/audio/$articleId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { serveArticleAudio } = await import('#/server/audio')
        return serveArticleAudio(params.articleId, 0, request)
      },
    },
  },
})
