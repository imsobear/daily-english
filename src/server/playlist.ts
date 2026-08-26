import { desc, eq, inArray } from 'drizzle-orm'

import { getDb } from '#/db'
import { lessonArticles, lessons } from '#/db/schema'
import { clipUrls, tracksFrom, type PlaylistTrack } from '#/lib/playlist'

/** Same window the Today list shows, so Play means "this list". */
const WINDOW = 40

/**
 * Spoken articles from the learner's recent lessons, newest first.
 *
 * One track per lesson, using the first article — the same one History names.
 * Lessons still writing, or written without speech, never enter the queue.
 */
export async function playlistFor(userId: string): Promise<PlaylistTrack[]> {
  const db = getDb()
  const lessonRows = await db.query.lessons.findMany({
    where: eq(lessons.userId, userId),
    orderBy: desc(lessons.createdAt),
    limit: WINDOW,
  })
  if (lessonRows.length === 0) return []

  const articleRows = await db
    .select()
    .from(lessonArticles)
    .where(
      inArray(
        lessonArticles.lessonId,
        lessonRows.map((row) => row.id),
      ),
    )

  const firstByLesson = new Map<string, typeof lessonArticles.$inferSelect>()
  for (const article of articleRows) {
    const current = firstByLesson.get(article.lessonId)
    if (!current || article.position < current.position) {
      firstByLesson.set(article.lessonId, article)
    }
  }

  return tracksFrom(
    lessonRows.map((lesson) => {
      const article = firstByLesson.get(lesson.id)
      return {
        lessonId: lesson.id,
        title: article?.title ?? null,
        clips: article
          ? clipUrls({
              id: article.id,
              audioKey: article.audioKey,
              audioChunks: article.audioChunks,
            })
          : [],
      }
    }),
  )
}
