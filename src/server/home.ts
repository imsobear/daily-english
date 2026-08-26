import { createServerFn } from '@tanstack/react-start'
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm'

import { getDb } from '#/db'
import { lessonArticles, lessons, words } from '#/db/schema'
import { shiftDate } from '#/lib/day'
import { clipUrls, tracksFrom } from '#/lib/playlist'
import { requireUser } from '#/lib/session'
import { learnerDate, learnerToday } from '#/server/day'
import { readSettings } from '#/server/settings'
import {
  expireStuckGeneration,
  stampsOf,
  type LessonSummary,
} from '#/server/lessons'

function doneSteps(row: typeof lessonArticles.$inferSelect) {
  return stampsOf(row).filter(Boolean).length
}

/**
 * Count consecutive days ending today (or yesterday, if today is not done yet
 * — the streak is only broken once a whole day has been skipped).
 *
 * Dates are the learner's own calendar dates, recorded client-side when the
 * lesson was finished, so an evening session in UTC-7 counts for that evening.
 */
export function computeStreak(dates: Iterable<string>, today: string) {
  const done = new Set(dates)
  let cursor = done.has(today) ? today : shiftDate(today, -1)
  if (!done.has(cursor)) return { current: 0, todayDone: false }

  let current = 0
  while (done.has(cursor)) {
    current += 1
    cursor = shiftDate(cursor, -1)
  }
  return { current, todayDone: done.has(today) }
}

export const getHomeSnapshot = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    const db = getDb()
    const settings = await readSettings(user.id)

    const countRow = await db
      .select({ value: count() })
      .from(words)
      .where(eq(words.userId, user.id))

    const lessonRows = await expireStuckGeneration(
      await db.query.lessons.findMany({
        where: eq(lessons.userId, user.id),
        orderBy: desc(lessons.createdAt),
        limit: 40,
      }),
    )

    const lessonIds = lessonRows.map((row) => row.id)
    const articleRows =
      lessonIds.length === 0
        ? []
        : await db
            .select()
            .from(lessonArticles)
            .where(inArray(lessonArticles.lessonId, lessonIds))

    const firstByLesson = new Map<string, typeof lessonArticles.$inferSelect>()
    for (const article of articleRows) {
      const current = firstByLesson.get(article.lessonId)
      if (!current || article.position < current.position) {
        firstByLesson.set(article.lessonId, article)
      }
    }

    const lessonList: LessonSummary[] = lessonRows.map((lesson) => {
      const article = firstByLesson.get(lesson.id)
      return {
        id: lesson.id,
        status: lesson.status,
        createdAt: lesson.createdAt,
        completedAt: lesson.completedAt,
        wordCount: lesson.wordCount,
        doneSteps: article ? doneSteps(article) : 0,
        title: article?.title ?? null,
        failureReason: lesson.failureReason,
        // Resolved here so "Today" means the same thing whether this list is
        // rendered on the Worker or in the browser.
        localDate: learnerDate(new Date(lesson.createdAt)),
      }
    })

    const today = learnerToday()

    /*
     * Today's unfinished lesson only. An article left over from an earlier day
     * belongs in history, not on the card that offers today's work — and since
     * the progress ring reads from here, counting it would show yesterday's
     * two-thirds as this morning's progress.
     */
    const active =
      lessonList.find(
        (lesson) =>
          lesson.localDate === today &&
          (lesson.status === 'in_progress' ||
            lesson.status === 'ready' ||
            lesson.status === 'generating'),
      ) ?? null

    // Streak needs the full completion history, not just the recent page.
    const completedDates = await db
      .select({ date: lessons.completedLocalDate })
      .from(lessons)
      .where(
        and(
          eq(lessons.userId, user.id),
          isNotNull(lessons.completedLocalDate),
        ),
      )
    const streak = computeStreak(
      completedDates.map((row) => row.date as string),
      today,
    )

    const playlist = tracksFrom(
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

    return {
      today,
      wordCount: countRow[0]?.value ?? 0,
      streak: streak.current,
      todayDone: streak.todayDone,
      settings,
      activeLesson: active,
      history: lessonList,
      playlist,
    }
  },
)
