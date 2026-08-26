import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { getDb } from '#/db'
import { userSettings, users, words } from '#/db/schema'
import { normalizeHeadword } from '#/lib/dictionary'
import { requireUser } from '#/lib/session'
import { CEFR_LEVELS, type CefrLevel } from '#/lib/settings'
import { starterWords } from '#/lib/vocabulary'
import { readSettings } from '#/server/settings'
import { saveWordsForUser } from '#/server/words'

export type OnboardingState = {
  cefrLevel: CefrLevel
  /**
   * A starter set for every level, not just the one guessed for this learner.
   * Picking a level is a tap, and the words under it should change with it
   * rather than after a round trip; the vocabulary pool itself is far too
   * large to hand to the browser for the sake of one screen.
   */
  starters: Record<CefrLevel, string[]>
}

/**
 * Onboarding is done when it has been done, or when there is evidence of it.
 *
 * The stamp is the real answer, but a learner with a word list has plainly
 * been set up whatever the column says, and sending them to a screen that
 * offers to pick their first words reads as "your account was wiped". Accounts
 * older than the column exist, and a restore or a bad migration could make
 * more; the implication only runs one way, so leaning on it costs nothing.
 */
export async function isOnboarded(userId: string) {
  const db = getDb()
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { onboardedAt: true },
  })
  if (row?.onboardedAt) return true

  const owned = await db.query.words.findFirst({
    where: eq(words.userId, userId),
    columns: { id: true },
  })
  return Boolean(owned)
}

export const getOnboardingState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OnboardingState & { done: boolean }> => {
    const user = await requireUser()
    const [settings, done] = await Promise.all([
      readSettings(user.id),
      isOnboarded(user.id),
    ])
    return {
      done,
      cefrLevel: settings.cefrLevel,
      starters: Object.fromEntries(
        CEFR_LEVELS.map((level) => [
          level,
          starterWords({ level, count: settings.wordsPerLesson }),
        ]),
      ) as Record<CefrLevel, string[]>,
    }
  },
)

/** Another draw at the same level, for the learner who dislikes this one. */
export const swapStarters = createServerFn({ method: 'POST' })
  .validator((data: { cefrLevel: CefrLevel }) => {
    if (!CEFR_LEVELS.includes(data.cefrLevel)) throw new Error('Invalid level')
    return data
  })
  .handler(async ({ data }): Promise<string[]> => {
    const user = await requireUser()
    const settings = await readSettings(user.id)
    return starterWords({
      level: data.cefrLevel,
      count: settings.wordsPerLesson,
    })
  })

export const completeOnboarding = createServerFn({ method: 'POST' })
  .validator((data: { cefrLevel: CefrLevel; headwords: string[] }) => {
    if (!CEFR_LEVELS.includes(data.cefrLevel)) throw new Error('Invalid level')
    const headwords = [
      ...new Set(data.headwords.map(normalizeHeadword).filter(Boolean)),
    ].slice(0, 30)
    if (headwords.length === 0) throw new Error('Pick your starter words')
    return { cefrLevel: data.cefrLevel, headwords }
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()
    const now = new Date().toISOString()

    await db
      .update(userSettings)
      .set({ cefrLevel: data.cefrLevel, updatedAt: now })
      .where(eq(userSettings.userId, user.id))

    const added = await saveWordsForUser(user.id, data.headwords, 'recommendation')

    await db
      .update(users)
      .set({ onboardedAt: now })
      .where(eq(users.id, user.id))

    return { added }
  })

/** Lets a learner leave the flow without being sent straight back into it. */
export const skipOnboarding = createServerFn({ method: 'POST' }).handler(
  async () => {
    const user = await requireUser()
    await getDb()
      .update(users)
      .set({ onboardedAt: new Date().toISOString() })
      .where(eq(users.id, user.id))
    return { ok: true }
  },
)
