import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { getDb, getEnv, waitUntil } from '#/db'
import {
  lessonArticles,
  lessonWords,
  lessons,
  words,
} from '#/db/schema'
import {
  audioKeysOf,
  generateLessonContent,
  markLessonFailed,
  speakArticle,
  type AudioChunk,
  type LessonEnv,
  type LessonStage,
} from '#/lib/generate-lesson'
import { TTS_MODEL } from '#/lib/ai'
import { DEEPSEEK_MODEL } from '#/lib/deepseek'
import { normalizeHeadword } from '#/lib/dictionary'
import {
  entryExamples,
  entrySenses,
  loadEntries,
  type Entry,
} from '#/lib/entries'
import { buildQuiz, seededRandom, type QuizQuestion } from '#/lib/quiz'
import {
  CEFR_LEVELS,
  defaultSettings,
  pickTheme,
  type CefrLevel,
} from '#/lib/settings'
import { pickArticleWords, type ArticleSuggestion } from '#/lib/suggestions'
import { paragraphStarts, splitSentences, wordAppearsIn } from '#/lib/text'
import { starterWords } from '#/lib/vocabulary'
import { learnerDate, learnerToday } from '#/server/day'
import { requireUser } from '#/lib/session'
import { readSettings } from '#/server/settings'

/** Answer plus decoys. Mirrors the quiz builder's own choice count. */
const QUIZ_CHOICES = 4

export type LessonSummary = {
  id: string
  status: string
  createdAt: string
  completedAt: string | null
  wordCount: number
  doneSteps: number
  title: string | null
  failureReason: string | null
  /** Creation day in the learner's own calendar, as YYYY-MM-DD. */
  localDate: string
}

export type LessonAudioClip = {
  url: string
  from: number
  to: number
}

export type LessonArticle = {
  id: string
  title: string
  body: string
  sentences: string[]
  /** Indices of sentences that start a paragraph. */
  paragraphStarts: number[]
  clips: LessonAudioClip[]
  explanations: Array<{ phrase: string; meaning: string }>
  steps: {
    blindListen: boolean
    listenRead: boolean
    fullListen: boolean
    explain: boolean
  }
}

/** Where generation has got to, for the screen shown while it runs. */
export type LessonProgress = {
  stage: LessonStage
  /** Which audio part is being recorded, and how many there are. */
  part: number | null
  parts: number | null
}

export type LessonDetail = {
  id: string
  status: string
  createdAt: string
  /** Only while generating, and only once the workflow has reported in. */
  progress: LessonProgress | null
  /**
   * What this lesson is being made with. Named on the waiting screen, and
   * read from the environment rather than the client so a model swapped by
   * configuration is still reported honestly.
   */
  models: { article: string; speech: string }
  cefrLevel: string
  topics: string[]
  wordCount: number
  failureReason: string | null
  /** Set when the article is usable but its audio is missing or partial. */
  audioNote: string | null
  words: Array<{ position: number; headword: string; definition: string | null }>
  /** Multiple-choice questions for the recall step, one per target word. */
  quiz: QuizQuestion[]
  article: LessonArticle | null
  /**
   * New words to offer once the lesson is over. Only filled on the call that
   * finishes it, since nothing earlier has a place to show them.
   */
  suggestions: ArticleSuggestion[]
}

function parseTopics(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function parseExplanations(raw: string) {
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value
      .map((item) => {
        const rec = item as { phrase?: string; meaning?: string }
        return {
          phrase: String(rec.phrase ?? ''),
          meaning: String(rec.meaning ?? ''),
        }
      })
      .filter((item) => item.phrase && item.meaning)
  } catch {
    return []
  }
}

function parseStringArray(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(value) ? value.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseChunks(raw: string | null): AudioChunk[] {
  try {
    const value = JSON.parse(raw ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is AudioChunk =>
        Boolean(item) &&
        typeof (item as AudioChunk).key === 'string' &&
        Number.isFinite((item as AudioChunk).from),
    )
  } catch {
    return []
  }
}

function toArticle(row: typeof lessonArticles.$inferSelect): LessonArticle {
  const chunks = parseChunks(row.audioChunks)
  // Articles written before chunked audio have a single whole-article clip.
  const clips: LessonAudioClip[] =
    chunks.length > 0
      ? chunks.map((chunk, index) => ({
          url: `/api/audio/${row.id}/${index}`,
          from: chunk.from,
          to: chunk.to,
        }))
      : row.audioKey
        ? [{ url: `/api/audio/${row.id}/0`, from: 0, to: Number.MAX_SAFE_INTEGER }]
        : []

  const stored = parseStringArray(row.sentences)
  const sentences = stored.length > 0 ? stored : splitSentences(row.body)

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    sentences,
    paragraphStarts: paragraphStarts(row.body, sentences),
    clips,
    explanations: parseExplanations(row.explanations),
    steps: {
      blindListen: Boolean(row.stepBlindListenAt),
      listenRead: Boolean(row.stepListenReadAt),
      fullListen: Boolean(row.stepFullListenAt),
      explain: Boolean(row.stepExplainAt),
    },
  }
}

/**
 * The sense the article should teach.
 *
 * Definitions are stored most-common-first, so the head of the list is the
 * meaning the learner actually saw when they saved the word.
 */
function primarySense(entry: Entry | undefined) {
  return entrySenses(entry).find((sense) => sense.definition) ?? null
}

function asLessonEnv(value: unknown): LessonEnv {
  return value as LessonEnv
}

const STAGES: LessonStage[] = ['writing', 'speaking', 'saving']

function isStage(value: string | null): value is LessonStage {
  return Boolean(value) && STAGES.includes(value as LessonStage)
}

function lessonModels() {
  const env = getEnv() as { DEEPSEEK_MODEL?: string }
  return {
    article: env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_MODEL,
    speech: TTS_MODEL,
  }
}

async function kickoffGeneration(lessonId: string) {
  const env = getEnv() as Cloudflare.Env & {
    LESSON_WORKFLOW?: {
      create: (opts: { params: { lessonId: string } }) => Promise<unknown>
    }
  }

  try {
    if (env.LESSON_WORKFLOW) {
      await env.LESSON_WORKFLOW.create({ params: { lessonId } })
      return
    }
  } catch (error) {
    console.error('Workflow start failed, falling back', error)
  }

  waitUntil(
    generateLessonContent(asLessonEnv(env), lessonId).catch(async (error) => {
      console.error('Lesson generation failed', error)
      await markLessonFailed(asLessonEnv(env), lessonId, error)
    }),
  )
}

/**
 * Writing an article plus its audio takes well under a minute, even with the
 * workflow's retries.
 */
const GENERATION_DEADLINE_MS = 6 * 60 * 1000

type GenerationRow = {
  id: string
  status: string
  createdAt: string
  generatingSince: string | null
  failureKind?: string | null
  failureReason?: string | null
}

function generationExpired(lesson: GenerationRow) {
  if (lesson.status !== 'generating') return false
  const since = Date.parse(lesson.generatingSince ?? lesson.createdAt)
  return (
    Number.isFinite(since) && Date.now() - since > GENERATION_DEADLINE_MS
  )
}

/**
 * A lesson only leaves `generating` when the workflow marks it, so a workflow
 * that dies mid-run would leave the row spinning forever — and with one
 * unfinished lesson allowed at a time, that would block the rest of the day.
 * Anything past the deadline is failed on read, which surfaces the retry
 * button the learner needs.
 */
export async function expireStuckGeneration<T extends GenerationRow>(
  rows: T[],
): Promise<T[]> {
  const stuck = rows.filter(generationExpired)
  if (stuck.length === 0) return rows

  const failure = {
    status: 'failed',
    failureKind: 'timeout',
    failureReason: 'Writing this lesson stalled. Try again.',
  } as const

  const db = getDb()
  await Promise.all(
    stuck.map((lesson) =>
      db
        .update(lessons)
        .set(failure)
        .where(and(eq(lessons.id, lesson.id), eq(lessons.status, 'generating'))),
    ),
  )

  const failed = new Set(stuck.map((lesson) => lesson.id))
  return rows.map((row) => (failed.has(row.id) ? { ...row, ...failure } : row))
}

async function clearArticles(lessonId: string) {
  const db = getDb()
  const env = getEnv()
  const existing = await db.query.lessonArticles.findMany({
    where: eq(lessonArticles.lessonId, lessonId),
  })
  for (const row of existing) {
    for (const key of audioKeysOf(row.audioKey, row.audioChunks)) {
      try {
        await env.AUDIO.delete(key)
      } catch {
        // ignore missing objects
      }
    }
  }
  if (existing.length > 0) {
    await db.delete(lessonArticles).where(eq(lessonArticles.lessonId, lessonId))
  }
}

/**
 * Words from the article that the learner has not saved yet.
 *
 * The article's own explanations are the candidate pool, so this costs one
 * query rather than another model call.
 */
async function suggestFromArticle(
  userId: string,
  article: LessonArticle | null,
  targets: string[],
): Promise<ArticleSuggestion[]> {
  if (!article) return []
  const owned = await getDb().query.words.findMany({
    where: eq(words.userId, userId),
    columns: { normalized: true },
  })
  return pickArticleWords({
    explanations: article.explanations,
    targets,
    owned: owned.map((row) => row.normalized),
  })
}

/**
 * Wrong answers for a lesson too short to supply its own.
 *
 * Drawn from the pool at the lesson's level so a two-word lesson still asks a
 * real question. Seeded by the lesson id, because a quiz that reshuffles
 * between reloads is a quiz the learner cannot trust.
 */
function spareChoices(lessonId: string, level: string, targetCount: number) {
  if (targetCount >= QUIZ_CHOICES) return []
  const cefr = (CEFR_LEVELS as readonly string[]).includes(level)
    ? (level as CefrLevel)
    : defaultSettings.cefrLevel
  return starterWords({
    level: cefr,
    count: QUIZ_CHOICES * 2,
    random: seededRandom(`${lessonId}|spares`),
  })
}

async function loadDetail(
  userId: string,
  lessonId: string,
  options?: { suggest?: boolean },
): Promise<LessonDetail | null> {
  const db = getDb()
  const row = await db.query.lessons.findFirst({
    where: and(eq(lessons.id, lessonId), eq(lessons.userId, userId)),
  })
  if (!row) return null
  const [lesson] = await expireStuckGeneration([row])

  const [targets, articles] = await Promise.all([
    db.query.lessonWords.findMany({
      where: eq(lessonWords.lessonId, lessonId),
    }),
    db.query.lessonArticles.findMany({
      where: eq(lessonArticles.lessonId, lessonId),
    }),
  ])

  const ordered = [...targets].sort((a, b) => a.position - b.position)
  const article =
    articles.sort((a, b) => a.position - b.position).map(toArticle)[0] ?? null

  // One extra read for the recall step's example sentences.
  const entries = await loadEntries(
    db,
    ordered.map((row) => normalizeHeadword(row.headword)),
  )

  return {
    id: lesson.id,
    status: lesson.status,
    createdAt: lesson.createdAt,
    progress:
      lesson.status === 'generating' && isStage(lesson.stage)
        ? {
            stage: lesson.stage,
            part: lesson.stagePart,
            parts: lesson.stageParts,
          }
        : null,
    models: lessonModels(),
    cefrLevel: lesson.cefrLevel,
    topics: parseTopics(lesson.topics),
    wordCount: lesson.wordCount,
    failureReason: lesson.failureReason,
    audioNote:
      lesson.failureKind === 'audio_unavailable' ? lesson.failureReason : null,
    words: ordered.map((row) => ({
      position: row.position,
      headword: row.headword,
      definition: row.definition,
    })),
    quiz: buildQuiz(
      lesson.id,
      ordered.map((row) => ({
        ...row,
        example:
          entryExamples(entries.get(normalizeHeadword(row.headword)))[0] ?? null,
      })),
      spareChoices(lesson.id, lesson.cefrLevel, ordered.length),
    ),
    article,
    suggestions: options?.suggest
      ? await suggestFromArticle(
          userId,
          article,
          ordered.map((row) => row.headword),
        )
      : [],
  }
}

/**
 * Days until a word comes round again, indexed by how well it is known.
 * Deliberately simpler than SM-2: the lesson loop is the real exposure and the
 * recall quiz is only a check on it.
 */
const INTERVALS = [1, 2, 4, 8, 16, 32, 60]

/**
 * Apply a recall answer to a word's schedule.
 *
 * A miss costs more than a hit earns, so a word cannot climb to "known" on
 * lucky guesses through a four-way choice.
 */
async function gradeWord(wordId: string, correct: boolean, now: string) {
  const db = getDb()
  const word = await db.query.words.findFirst({ where: eq(words.id, wordId) })
  if (!word) return

  const familiarity = correct
    ? Math.min(1, word.familiarity + 0.2)
    : Math.max(0, word.familiarity - 0.3)
  const rung = correct
    ? Math.min(INTERVALS.length - 1, Math.round(familiarity * INTERVALS.length))
    : 0

  await db
    .update(words)
    .set({
      familiarity,
      seenCount: word.seenCount + 1,
      reviewCount: word.reviewCount + 1,
      lapses: correct ? word.lapses : word.lapses + 1,
      lastReviewedAt: now,
      dueAt: Math.floor(Date.now() / 1000) + INTERVALS[rung] * 86400,
    })
    .where(eq(words.id, word.id))
}

async function bumpWord(wordId: string, amount: number, now: string) {
  const db = getDb()
  const word = await db.query.words.findFirst({
    where: eq(words.id, wordId),
  })
  if (!word) return
  const familiarity = Math.min(1, word.familiarity + amount)
  const days = familiarity < 0.3 ? 1 : familiarity < 0.6 ? 3 : 7
  await db
    .update(words)
    .set({
      familiarity,
      seenCount: word.seenCount + 1,
      lastReviewedAt: now,
      dueAt: Math.floor(Date.now() / 1000) + days * 86400,
    })
    .where(eq(words.id, word.id))
}

export const getLesson = createServerFn({ method: 'GET' })
  .validator((data: { lessonId: string }) => {
    if (!data.lessonId) throw new Error('Missing lesson')
    return data
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    return loadDetail(user.id, data.lessonId)
  })

/**
 * The unfinished lesson a new request should land on, if there is one.
 *
 * Only today's counts. A second article costs another generation and splits
 * attention across two things the learner has not read yet, so a repeat tap
 * resumes what is already waiting — which also makes a double tap harmless.
 * An article abandoned on an earlier day is a different matter: refusing today
 * a lesson because of it leaves the learner with one way out, finishing
 * something they already walked away from. It keeps its place in history and
 * stays openable; it just stops standing in the way.
 *
 * The calendar arrives as an argument rather than being read here: this module
 * is imported by the home route, and a plain export that reaches for the
 * timezone cookie would pull request-only code into the browser bundle.
 */
export async function todaysUnfinishedLesson(
  userId: string,
  /** An instant in the learner's calendar; no argument means right now. */
  dayOf: (instant?: Date) => string,
) {
  const db = getDb()
  const unfinished = await db.query.lessons.findMany({
    where: and(
      eq(lessons.userId, userId),
      inArray(lessons.status, ['generating', 'ready', 'in_progress']),
    ),
    orderBy: desc(lessons.createdAt),
  })
  const today = dayOf()
  return (await expireStuckGeneration(unfinished)).find(
    (lesson) =>
      lesson.status !== 'failed' && dayOf(new Date(lesson.createdAt)) === today,
  )
}

export const createLesson = createServerFn({ method: 'POST' })
  .validator((data: { replace?: boolean }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()

    const waiting = await todaysUnfinishedLesson(user.id, learnerDate)
    // Mid-generation there is a workflow still writing to those rows, so the
    // learner waits for it either way — asking for a different article now
    // would only orphan the run. Past that point the rejected article is left
    // exactly as it is, unfinished and still openable from history: turning it
    // down is not the same as never wanting to read it. Its words count as
    // recently used below, so the replacement is built from different ones.
    if (waiting && (!data.replace || waiting.status === 'generating')) {
      return { lessonId: waiting.id }
    }

    const settings = await readSettings(user.id)
    const collection = await db.query.words.findMany({
      where: eq(words.userId, user.id),
    })

    // However many words there are, including none. A learner who has not
    // saved anything yet still gets an article at their level, and picks up
    // vocabulary from the suggestions at the end of it.
    const recentLessons = await db.query.lessons.findMany({
      where: and(
        eq(lessons.userId, user.id),
        inArray(lessons.status, [
          'ready',
          'in_progress',
          'completed',
          'generating',
        ]),
      ),
      orderBy: desc(lessons.createdAt),
      limit: 3,
    })
    const recentIds = recentLessons.map((row) => row.id)
    const recentTargets =
      recentIds.length === 0
        ? []
        : await db
            .select({ wordId: lessonWords.wordId })
            .from(lessonWords)
            .where(inArray(lessonWords.lessonId, recentIds))
    const recentWordIds = new Set(
      recentTargets
        .map((row) => row.wordId)
        .filter((id): id is string => Boolean(id)),
    )

    const nowSec = Math.floor(Date.now() / 1000)
    const ranked = [...collection].sort((a, b) => {
      const aDue = a.dueAt == null || a.dueAt <= nowSec ? 0 : 1
      const bDue = b.dueAt == null || b.dueAt <= nowSec ? 0 : 1
      return aDue - bDue || a.familiarity - b.familiarity
    })
    const fresh = ranked.filter((word) => !recentWordIds.has(word.id))
    const recycled = ranked.filter((word) => recentWordIds.has(word.id))
    const picked = [...fresh, ...recycled].slice(0, settings.wordsPerLesson)
    const entries = await loadEntries(
      db,
      picked.map((word) => word.normalized),
    )

    const lessonId = crypto.randomUUID()
    const createdAt = new Date().toISOString()

    // With no words and no chosen topics there is nothing to make one day's
    // article differ from the next, so pick a theme the recent ones did not
    // use. Stored on the lesson, so a retry rewrites the same commission.
    const topics =
      settings.topics.length > 0
        ? settings.topics
        : picked.length === 0
          ? [pickTheme(recentLessons.flatMap((row) => parseTopics(row.topics)))]
          : []

    await db.insert(lessons).values({
      id: lessonId,
      userId: user.id,
      status: 'generating',
      cefrLevel: settings.cefrLevel,
      topics: JSON.stringify(topics),
      wordCount: picked.length,
      articleCount: 1,
      createdAt,
      generatingSince: createdAt,
    })

    // An empty list is a legitimate lesson, and D1 rejects an insert with no
    // rows in it.
    if (picked.length > 0) {
      await db.insert(lessonWords).values(
        picked.map((word, index) => ({
          lessonId,
          position: index + 1,
          wordId: word.id,
          headword: word.headword,
          // Plain gloss only. The part of speech reaches the writer through the
          // word entry, so embedding it here would just leak into the UI.
          definition:
            primarySense(entries.get(word.normalized))?.definition ?? null,
        })),
      )
    }

    await kickoffGeneration(lessonId)
    return { lessonId }
  })

export const retryLesson = createServerFn({ method: 'POST' })
  .validator((data: { lessonId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()
    const lesson = await db.query.lessons.findFirst({
      where: and(eq(lessons.id, data.lessonId), eq(lessons.userId, user.id)),
    })
    if (!lesson) throw new Error('Lesson not found')
    if (lesson.status === 'generating') return { lessonId: lesson.id }

    await clearArticles(lesson.id)
    await db
      .update(lessons)
      .set({
        status: 'generating',
        generatingSince: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        completedLocalDate: null,
        failureKind: null,
        failureReason: null,
        stage: null,
        stagePart: null,
        stageParts: null,
      })
      .where(eq(lessons.id, lesson.id))

    await kickoffGeneration(lesson.id)
    return { lessonId: lesson.id }
  })

/**
 * Re-synthesise audio for an article that already has text.
 *
 * If speech fails mid-lesson the article is saved reading-only. Without this
 * the lesson stays silent forever, because the only recovery was a full retry
 * that rewrites the article too.
 */
export const retryLessonAudio = createServerFn({ method: 'POST' })
  .validator((data: { lessonId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()
    const lesson = await db.query.lessons.findFirst({
      where: and(eq(lessons.id, data.lessonId), eq(lessons.userId, user.id)),
    })
    if (!lesson) throw new Error('Lesson not found')

    const article = await db.query.lessonArticles.findFirst({
      where: eq(lessonArticles.lessonId, lesson.id),
    })
    if (!article) throw new Error('This lesson has no article yet')

    const env = asLessonEnv(getEnv())
    for (const key of audioKeysOf(article.audioKey, article.audioChunks)) {
      try {
        await env.AUDIO.delete(key)
      } catch {
        // A stale object costs nothing; the new keys overwrite by name anyway.
      }
    }

    const stored = parseStringArray(article.sentences)
    const sentences = stored.length > 0 ? stored : splitSentences(article.body)
    const spoken = await speakArticle(env, {
      userId: user.id,
      lessonId: lesson.id,
      draft: {
        title: article.title,
        body: article.body,
        usedWords: [],
        explanations: [],
      },
      sentences,
    })

    await db
      .update(lessonArticles)
      .set({
        audioKey: spoken.chunks[0]?.key ?? null,
        audioChunks: JSON.stringify(spoken.chunks),
      })
      .where(eq(lessonArticles.id, article.id))

    await db
      .update(lessons)
      .set({
        failureKind: spoken.note ? 'audio_unavailable' : null,
        failureReason: spoken.note,
      })
      .where(eq(lessons.id, lesson.id))

    return { note: spoken.note }
  })

/**
 * A lesson's step timestamps in the order they are worked through: hear it in
 * parts, read it, listen again to the whole article, then recall the words.
 */
export function stampsOf(article: typeof lessonArticles.$inferSelect) {
  return [
    article.stepBlindListenAt,
    article.stepListenReadAt,
    article.stepFullListenAt,
    article.stepExplainAt,
  ]
}

/** The recall step, which is the last one and the only one that grades. */
const RECALL_STEP = 3

export const completeStep = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      articleId: string
      step: number
      localDate?: string
      /** Recall answers, keyed by word. Ignored for the other steps. */
      answers?: Array<{ wordId: string; correct: boolean }>
    }) => {
      if (!data.articleId) throw new Error('Missing article')
      if (data.step < 0 || data.step > RECALL_STEP) throw new Error('Invalid step')
      if (data.localDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.localDate)) {
        throw new Error('Invalid date')
      }
      return {
        ...data,
        answers: (data.answers ?? [])
          .filter((answer) => typeof answer?.wordId === 'string')
          .map((answer) => ({
            wordId: answer.wordId,
            correct: Boolean(answer.correct),
          })),
      }
    },
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const db = getDb()
    const article = await db.query.lessonArticles.findFirst({
      where: eq(lessonArticles.id, data.articleId),
    })
    if (!article) throw new Error('Article not found')

    const lesson = await db.query.lessons.findFirst({
      where: and(eq(lessons.id, article.lessonId), eq(lessons.userId, user.id)),
    })
    if (!lesson) throw new Error('Lesson not found')

    const now = new Date().toISOString()
    const patch =
      data.step === 0
        ? { stepBlindListenAt: article.stepBlindListenAt ?? now }
        : data.step === 1
          ? { stepListenReadAt: article.stepListenReadAt ?? now }
          : data.step === 2
            ? { stepFullListenAt: article.stepFullListenAt ?? now }
            : { stepExplainAt: article.stepExplainAt ?? now }

    if (stampsOf(article).slice(0, data.step).some((stamp) => !stamp)) {
      throw new Error('Finish the previous step first')
    }

    const explainJustFinished =
      data.step === RECALL_STEP && !article.stepExplainAt

    await db
      .update(lessonArticles)
      .set(patch)
      .where(eq(lessonArticles.id, article.id))

    if (explainJustFinished) {
      const targets = await db.query.lessonWords.findMany({
        where: eq(lessonWords.lessonId, lesson.id),
      })
      // Driven by the lesson's own words rather than the submitted ids, so a
      // forged payload cannot reach into another learner's collection.
      const answered = new Map(
        data.answers.map((answer) => [answer.wordId, answer.correct]),
      )
      const haystack = `${article.title}\n${article.body}`
      for (const target of targets) {
        if (!target.wordId) continue
        const correct = answered.get(target.wordId)
        if (correct != null) {
          await gradeWord(target.wordId, correct, now)
        } else if (wordAppearsIn(target.headword, haystack)) {
          // No question for this word, so credit plain exposure instead.
          await bumpWord(target.wordId, 0.08, now)
        }
      }
    }

    const siblings = await db.query.lessonArticles.findMany({
      where: eq(lessonArticles.lessonId, lesson.id),
    })
    const primary = [...siblings].sort((a, b) => a.position - b.position)[0]
    const updatedPrimary =
      primary?.id === article.id ? { ...primary, ...patch } : primary
    const allDone = Boolean(
      updatedPrimary && stampsOf(updatedPrimary).every(Boolean),
    )
    if (allDone) {
      await db
        .update(lessons)
        .set({
          status: 'completed',
          completedAt: now,
          completedLocalDate: data.localDate ?? learnerToday(),
        })
        .where(eq(lessons.id, lesson.id))
    } else if (lesson.status === 'ready') {
      await db
        .update(lessons)
        .set({ status: 'in_progress', startedAt: lesson.startedAt ?? now })
        .where(eq(lessons.id, lesson.id))
    }

    return loadDetail(user.id, lesson.id, { suggest: allDone })
  })

