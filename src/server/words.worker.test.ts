import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '#/db'
import { lessons, users, wordOffers, words } from '#/db/schema'
import {
  expireStuckGeneration,
  todaysUnfinishedLesson,
} from '#/server/lessons'
import { isOnboarded } from '#/server/onboarding'
import { recommendationsFor, saveWordsForUser } from '#/server/words'

/** The D1 instance is shared across the file, so every test gets its own owner. */
let user: string

beforeEach(async () => {
  user = crypto.randomUUID()
  await getDb()
    .insert(users)
    .values({ id: user, createdAt: new Date().toISOString() })
})

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

async function countWords() {
  const rows = await getDb().query.words.findMany({
    where: eq(words.userId, user),
  })
  return rows.length
}

describe('saveWordsForUser', () => {
  it('saves a whole starter set at once', async () => {
    // Twelve words bind 216 variables, well past D1's 100 per statement.
    const headwords = Array.from({ length: 12 }, (_, i) => `word${i}`)

    const added = await saveWordsForUser(user, headwords, 'recommendation')

    expect(added).toBe(12)
    expect(await countWords()).toBe(12)
  })

  it('skips words the learner already has', async () => {
    await saveWordsForUser(user, ['alpha', 'beta'], 'recommendation')

    const added = await saveWordsForUser(user, ['beta', 'gamma'], 'manual')

    expect(added).toBe(1)
    expect(await countWords()).toBe(3)
  })
})

describe('recommendationsFor', () => {
  async function offered() {
    const rows = await getDb().query.wordOffers.findMany({
      where: eq(wordOffers.userId, user),
    })
    return rows.map((row) => row.normalized)
  }

  it('writes down what it showed', async () => {
    const picks = await recommendationsFor(user)

    expect(picks).toHaveLength(24)
    expect((await offered()).sort()).toEqual(
      picks.map((word) => word.headword).sort(),
    )
  })

  it('shows a different set the next time, without being told what was shown', async () => {
    const first = await recommendationsFor(user)

    const second = await recommendationsFor(user)

    const headwords = new Set(first.map((word) => word.headword))
    expect(second.filter((word) => headwords.has(word.headword))).toEqual([])
    expect(await offered()).toHaveLength(48)
  })

  it('never offers a word the learner has saved', async () => {
    const saved = (await recommendationsFor(user)).map((word) => word.headword)
    await saveWordsForUser(user, saved, 'recommendation')

    // Deep enough to exhaust the fresh candidates and start recycling.
    for (let round = 0; round < 60; round += 1) {
      const picks = await recommendationsFor(user)
      expect(picks.filter((word) => saved.includes(word.headword))).toEqual([])
    }
  })
})

describe('isOnboarded', () => {
  it('is false for a fresh account', async () => {
    expect(await isOnboarded(user)).toBe(false)
  })

  // Nobody with a word list should ever be shown "your first 10 words".
  it('is true for an unstamped account that already has words', async () => {
    await saveWordsForUser(user, ['alpha'], 'manual')
    expect(await isOnboarded(user)).toBe(true)
  })

  it('is true once stamped, even with an empty list', async () => {
    await getDb()
      .update(users)
      .set({ onboardedAt: new Date().toISOString() })
      .where(eq(users.id, user))

    expect(await isOnboarded(user)).toBe(true)
  })
})

describe('expireStuckGeneration', () => {
  async function seedLesson(generatingSince: string) {
    const id: string = crypto.randomUUID()
    await getDb().insert(lessons).values({
      id,
      userId: user,
      status: 'generating',
      cefrLevel: 'B1',
      topics: '[]',
      wordCount: 10,
      articleCount: 1,
      createdAt: generatingSince,
      generatingSince,
    })
    return {
      id,
      status: 'generating',
      createdAt: generatingSince,
      generatingSince: generatingSince as string | null,
      failureKind: null as string | null,
    }
  }

  async function statusOf(id: string) {
    const row = await getDb().query.lessons.findFirst({
      where: eq(lessons.id, id),
    })
    return row?.status
  }

  it('fails a lesson that has been writing for too long', async () => {
    const stale = await seedLesson(minutesAgo(30))

    const [row] = await expireStuckGeneration([stale])

    expect(row.status).toBe('failed')
    expect(row.failureKind).toBe('timeout')
    expect(await statusOf(stale.id)).toBe('failed')
  })

  it('leaves a lesson that is still within the deadline', async () => {
    const fresh = await seedLesson(minutesAgo(1))

    const [row] = await expireStuckGeneration([fresh])

    expect(row.status).toBe('generating')
    expect(await statusOf(fresh.id)).toBe('generating')
  })

  it('falls back to when the row was created', async () => {
    const legacy = {
      ...(await seedLesson(minutesAgo(30))),
      generatingSince: null,
    }

    const [row] = await expireStuckGeneration([legacy])

    expect(row.status).toBe('failed')
  })
})

describe('todaysUnfinishedLesson', () => {
  async function seedLesson(status: string, createdAt: string) {
    const id: string = crypto.randomUUID()
    await getDb().insert(lessons).values({
      id,
      userId: user,
      status,
      cefrLevel: 'B1',
      topics: '[]',
      wordCount: 10,
      articleCount: 1,
      createdAt,
    })
    return id
  }

  /** Stands in for the learner's timezone, which needs a request in scope. */
  const utcDay = (instant = new Date()) => instant.toISOString().slice(0, 10)

  it('resumes the lesson already waiting today', async () => {
    const id = await seedLesson('in_progress', new Date().toISOString())

    expect((await todaysUnfinishedLesson(user, utcDay))?.id).toBe(id)
  })

  it('lets an article abandoned on an earlier day go', async () => {
    await seedLesson('in_progress', daysAgo(1))

    expect(await todaysUnfinishedLesson(user, utcDay)).toBeUndefined()
  })

  it('prefers the newest when a rejected article is still around', async () => {
    await seedLesson('ready', minutesAgo(10))
    const replacement = await seedLesson('ready', minutesAgo(1))

    expect((await todaysUnfinishedLesson(user, utcDay))?.id).toBe(replacement)
  })

  it('does not count a lesson the learner finished today', async () => {
    await seedLesson('completed', new Date().toISOString())

    expect(await todaysUnfinishedLesson(user, utcDay)).toBeUndefined()
  })
})
