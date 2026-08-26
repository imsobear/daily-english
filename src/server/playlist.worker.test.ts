import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '#/db'
import { lessonArticles, lessons, users } from '#/db/schema'
import { playlistFor } from '#/server/playlist'

let user: string

beforeEach(async () => {
  user = crypto.randomUUID()
  await getDb()
    .insert(users)
    .values({ id: user, createdAt: new Date().toISOString() })
})

async function seedLesson(input: {
  title: string
  createdAt: string
  audio?: boolean
  chunks?: number
}) {
  const lessonId = crypto.randomUUID()
  const articleId = crypto.randomUUID()
  await getDb().insert(lessons).values({
    id: lessonId,
    userId: user,
    status: 'completed',
    cefrLevel: 'B1',
    topics: '[]',
    wordCount: 4,
    articleCount: 1,
    createdAt: input.createdAt,
  })
  await getDb().insert(lessonArticles).values({
    id: articleId,
    lessonId,
    position: 0,
    title: input.title,
    body: 'Hello.',
    audioKey: input.audio && !input.chunks ? 'legacy.mp3' : null,
    audioChunks:
      input.chunks && input.chunks > 0
        ? JSON.stringify(
            Array.from({ length: input.chunks }, (_, index) => ({
              key: `c${index}`,
              from: index,
              to: index,
            })),
          )
        : '[]',
  })
  return { lessonId, articleId }
}

describe('playlistFor', () => {
  it('returns spoken articles newest first and skips silent ones', async () => {
    const older = await seedLesson({
      title: 'Older',
      createdAt: '2026-01-01T10:00:00.000Z',
      chunks: 2,
    })
    await seedLesson({
      title: 'Mute',
      createdAt: '2026-01-02T10:00:00.000Z',
    })
    const newer = await seedLesson({
      title: 'Newer',
      createdAt: '2026-01-03T10:00:00.000Z',
      audio: true,
    })

    const tracks = await playlistFor(user)

    expect(tracks.map((track) => track.lessonId)).toEqual([
      newer.lessonId,
      older.lessonId,
    ])
    expect(tracks[0].clips).toEqual([`/api/audio/${newer.articleId}/0`])
    expect(tracks[1].clips).toEqual([
      `/api/audio/${older.articleId}/0`,
      `/api/audio/${older.articleId}/1`,
    ])
  })
})
