import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { getDb } from '#/db'
import { userSettings } from '#/db/schema'
import { requireUser } from '#/lib/session'
import {
  CEFR_LEVELS,
  defaultSettings,
  type CefrLevel,
  type Settings,
} from '#/lib/settings'

export type { CefrLevel, Settings }

function parseTopics(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // ignore malformed JSON
  }
  return []
}

function toSettings(row: typeof userSettings.$inferSelect): Settings {
  const level = CEFR_LEVELS.includes(row.cefrLevel as CefrLevel)
    ? (row.cefrLevel as CefrLevel)
    : 'B1'

  return {
    cefrLevel: level,
    topics: parseTopics(row.topics),
    wordsPerLesson: row.wordsPerLesson,
  }
}

export async function readSettings(userId: string): Promise<Settings> {
  const db = getDb()
  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  })
  return row ? toSettings(row) : defaultSettings
}

export const getSettings = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireUser()
    return readSettings(user.id)
  },
)

export const saveSettings = createServerFn({ method: 'POST' })
  .validator((data: Settings) => {
    if (!CEFR_LEVELS.includes(data.cefrLevel)) {
      throw new Error('Invalid level')
    }
    const wordsPerLesson = Math.min(20, Math.max(4, Math.round(data.wordsPerLesson)))
    const topics = data.topics
      .map((topic) => topic.trim())
      .filter(Boolean)
      .slice(0, 12)
    return { cefrLevel: data.cefrLevel, topics, wordsPerLesson }
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()
    await db
      .update(userSettings)
      .set({
        cefrLevel: data.cefrLevel,
        topics: JSON.stringify(data.topics),
        wordsPerLesson: data.wordsPerLesson,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(userSettings.userId, user.id))
    return data
  })
