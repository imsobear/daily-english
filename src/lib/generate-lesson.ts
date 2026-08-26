import { drizzle } from 'drizzle-orm/d1'
import { and, eq, inArray, ne } from 'drizzle-orm'

import { lessonArticles, lessonWords, lessons, words } from '#/db/schema'
import * as schema from '#/db/schema'
import {
  estimateTtsCostUsd,
  generateArticle,
  readOpenAiApiKey,
  readTtsMockUrl,
  synthesizeSpeech,
  type ArticleDraft,
} from '#/lib/ai'
import {
  AiError,
  isDeepSeekConfigured,
  readDeepSeekConfig,
} from '#/lib/deepseek'
import {
  ensureEntry,
  entryExamples,
  entrySenses,
  loadEntries,
  needsBetterSenses,
} from '#/lib/entries'
import { chunkSentences, splitSentences } from '#/lib/text'

export type LessonEnv = {
  DB: D1Database
  AUDIO: R2Bucket
  /** Workers AI, for the word cards. Only the pre-warm pass calls it. */
  CLOUDFLARE_ACCOUNT_ID?: string
  WORKERS_AI_API_TOKEN?: string
  WORKERS_AI_MOCK_URL?: string
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_MODEL?: string
  DEEPSEEK_BASE_URL?: string
  TTS_MOCK_URL?: string
  OPENAI_API_KEY?: string
}

/**
 * Ceiling on characters sent to TTS for a single article.
 *
 * A 300-word piece is ~1,800 characters. This leaves headroom while stopping a
 * runaway writer from turning into a long, billable listen.
 */
const TTS_CHAR_BUDGET = 4000

/** One R2 clip covering sentences `from`..`to` inclusive. */
export type AudioChunk = {
  key: string
  from: number
  to: number
}

function dbOf(env: LessonEnv) {
  return drizzle(env.DB, { schema })
}

export function describeFailure(error: unknown): {
  kind: string
  reason: string
  retryable: boolean
} {
  if (error instanceof AiError) {
    return {
      kind: error.kind,
      reason: error.userMessage,
      retryable: error.retryable,
    }
  }
  return {
    kind: 'unknown',
    reason: 'Something went wrong while writing this lesson.',
    retryable: true,
  }
}

/**
 * Record why a lesson could not be produced.
 *
 * Skips rows already marked failed so a precise cause recorded deep in the
 * pipeline is not overwritten by a vaguer one from an outer handler — error
 * identity does not survive the workflow boundary, so the specific message has
 * to be persisted at the point it is still known.
 */
export async function markLessonFailed(
  env: LessonEnv,
  lessonId: string,
  error?: unknown,
) {
  const db = dbOf(env)
  const failure = describeFailure(error)
  await db
    .update(lessons)
    .set({
      status: 'failed',
      failureKind: failure.kind,
      failureReason: failure.reason,
      stage: null,
      stagePart: null,
      stageParts: null,
    })
    .where(and(eq(lessons.id, lessonId), ne(lessons.status, 'failed')))
}

/** The steps of generation, in the order the learner waits through them. */
export type LessonStage = 'writing' | 'speaking' | 'saving'

/**
 * Say what the generator is doing.
 *
 * Best effort on purpose: the lesson is the work, and a failed progress write
 * must not take it down. Skips rows that have left `generating`, so a stage
 * cannot be written back over a finished lesson.
 */
export async function reportStage(
  env: LessonEnv,
  lessonId: string,
  stage: LessonStage,
  parts?: { part: number; total: number },
) {
  try {
    await dbOf(env)
      .update(lessons)
      .set({
        stage,
        stagePart: parts?.part ?? null,
        stageParts: parts?.total ?? null,
      })
      .where(and(eq(lessons.id, lessonId), eq(lessons.status, 'generating')))
  } catch (error) {
    console.error('Could not record generation stage', error)
  }
}

export async function loadLessonJob(env: LessonEnv, lessonId: string) {
  const db = dbOf(env)
  const lesson = await db.query.lessons.findFirst({
    where: eq(lessons.id, lessonId),
  })
  if (!lesson) return null
  const targets = await db.query.lessonWords.findMany({
    where: eq(lessonWords.lessonId, lessonId),
  })

  // lesson_words only snapshots the headword and gloss. The part of speech and
  // a real example sentence live on the dictionary entry, and the writer needs
  // both: without them the model happily uses "manage" as a noun.
  const wordIds = targets
    .map((row) => row.wordId)
    .filter((id): id is string => Boolean(id))
  const saved = wordIds.length
    ? await db.query.words.findMany({ where: inArray(words.id, wordIds) })
    : []
  const normalizedById = new Map(saved.map((row) => [row.id, row.normalized]))
  const entries = await healLegacySenses(
    env,
    db,
    saved.map((row) => row.normalized),
  )

  const seeds = targets
    .sort((a, b) => a.position - b.position)
    .map((row) => {
      const normalized = row.wordId ? normalizedById.get(row.wordId) : undefined
      const entry = normalized ? entries.get(normalized) : undefined
      const senses = entrySenses(entry)
      const primary = senses.find((sense) => sense.definition) ?? null
      return {
        headword: row.headword,
        // Prefer the live entry: it may have just been healed, in which case
        // the gloss snapshotted at lesson creation is the archaic one.
        definition: primary?.definition ?? row.definition,
        partOfSpeech: primary?.partOfSpeech ?? null,
        example: entryExamples(entry)[0] ?? null,
      }
    })
  return {
    lessonId: lesson.id,
    userId: lesson.userId,
    level: lesson.cefrLevel,
    topics: (() => {
      try {
        const value = JSON.parse(lesson.topics) as unknown
        return Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : []
      } catch {
        return [] as string[]
      }
    })(),
    words: seeds,
  }
}

/**
 * Re-define words still carrying dictionaryapi.dev senses.
 *
 * Those entries are ordered historically, so the first sense of "despite" is
 * the archaic noun "disdain" and of "manage" is "the act of managing". The
 * writer followed them faithfully and produced "the manage of the shop". This
 * runs inside generation rather than at lesson creation so the definition
 * calls hide behind the progress screen. Healing writes to the shared entry,
 * so a word is repaired once for every learner who has it.
 */
async function healLegacySenses(
  env: LessonEnv,
  db: ReturnType<typeof dbOf>,
  normalized: string[],
) {
  const entries = await loadEntries(db, normalized)
  const stale = normalized.filter((word) => needsBetterSenses(entries.get(word)))
  if (stale.length === 0 || !isDeepSeekConfigured(env)) return entries

  const config = readDeepSeekConfig(env)
  await Promise.all(
    stale.map(async (word) => {
      try {
        const healed = await ensureEntry(db, word, config)
        if (healed) entries.set(word, healed)
      } catch (error) {
        // A stale gloss still beats failing the whole lesson.
        console.error('Could not refresh senses for', word, error)
      }
    }),
  )

  return entries
}

export async function writeArticle(env: LessonEnv, lessonId: string) {
  const job = await loadLessonJob(env, lessonId)
  if (!job) throw new Error('Lesson not found')

  await reportStage(env, lessonId, 'writing')

  const draft = await generateArticle({
    config: readDeepSeekConfig(env),
    level: job.level,
    topics: job.topics,
    words: job.words,
  })

  return { job, draft }
}

/**
 * Record the article as a series of clips aligned to sentence boundaries.
 *
 * Chunking keeps each TTS request small and, more usefully, lets the player
 * replay a single sentence for shadowing (跟读) instead of forcing the learner
 * to scrub through several minutes of audio. Splitting does not change the
 * bill, which follows how long the audio runs.
 */
export type SpokenArticle = {
  chunks: AudioChunk[]
  /** Set when audio is missing or incomplete, so the UI can say why. */
  note: string | null
}

export async function speakArticle(
  env: LessonEnv,
  input: {
    userId: string
    lessonId: string
    draft: ArticleDraft
    sentences: string[]
  },
): Promise<SpokenArticle> {
  const groups = chunkSentences(input.sentences)
  const chunks: AudioChunk[] = []
  let cursor = 0
  let spent = 0
  let failure: AiError | null = null
  let truncated = false

  for (const [index, group] of groups.entries()) {
    const from = cursor
    const to = cursor + group.length - 1
    cursor = to + 1

    await reportStage(env, input.lessonId, 'speaking', {
      part: index + 1,
      total: groups.length,
    })

    const text = group.join(' ')
    const key = `${input.userId}/${input.lessonId}/${index}.mp3`

    // Speech bills by duration, and duration tracks character count. Stop at
    // the budget and keep what was synthesised rather than trusting the
    // article generator to have stayed in range.
    if (spent + text.length > TTS_CHAR_BUDGET) {
      truncated = true
      break
    }
    spent += text.length

    try {
      const { audio, contentType } = await synthesizeSpeech({
        text,
        mockUrl: readTtsMockUrl(env),
        apiKey: readOpenAiApiKey(env),
      })
      await env.AUDIO.put(key, audio, { httpMetadata: { contentType } })
      chunks.push({ key, from, to })
    } catch (error) {
      console.error(`TTS failed for chunk ${index}`, error)
      failure = error instanceof AiError ? error : null
      // A written article is still worth reading. Rather than discarding the
      // whole lesson when speech is unavailable, stop synthesising and hand
      // back what exists — the player degrades to a reading-only lesson.
      if (failure?.kind === 'quota' || failure?.kind === 'auth') break
    }
  }

  const note =
    chunks.length === 0
      ? (failure?.userMessage ??
        'Audio could not be generated for this article.')
      : chunks.length < groups.length
        ? truncated
          ? 'This article was long, so only the first part has audio.'
          : 'Some of the audio is missing, so playback stops early.'
        : null

  if (chunks.length > 0) {
    console.info(
      JSON.stringify({
        ttsArticle: true,
        chars: spent,
        chunks: chunks.length,
        estimatedUsd: Number(estimateTtsCostUsd(spent).toFixed(5)),
      }),
    )
  }

  return { chunks, note }
}

export async function persistArticle(
  env: LessonEnv,
  lessonId: string,
  draft: ArticleDraft,
  sentences: string[],
  spoken: SpokenArticle,
) {
  const chunks = spoken.chunks
  const db = dbOf(env)
  await reportStage(env, lessonId, 'saving')
  const existing = await db.query.lessonArticles.findMany({
    where: eq(lessonArticles.lessonId, lessonId),
  })
  for (const row of existing) {
    for (const key of audioKeysOf(row.audioKey, row.audioChunks)) {
      try {
        await env.AUDIO.delete(key)
      } catch {
        // keep going; the D1 row still needs replacing
      }
    }
  }
  if (existing.length > 0) {
    await db.delete(lessonArticles).where(eq(lessonArticles.lessonId, lessonId))
  }

  await db.insert(lessonArticles).values({
    id: crypto.randomUUID(),
    lessonId,
    position: 1,
    title: draft.title,
    body: draft.body,
    audioKey: chunks[0]?.key ?? null,
    explanations: JSON.stringify(draft.explanations),
    sentences: JSON.stringify(sentences),
    audioChunks: JSON.stringify(chunks),
  })

  await db
    .update(lessons)
    .set({
      status: 'ready',
      articleCount: 1,
      stage: null,
      stagePart: null,
      stageParts: null,
      // A missing-audio note rides on the same columns but leaves the lesson
      // usable; only `status` decides whether it counts as a failure.
      failureKind: spoken.note ? 'audio_unavailable' : null,
      failureReason: spoken.note,
    })
    .where(eq(lessons.id, lessonId))
}

/** Every R2 key an article owns, across both the legacy and chunked layouts. */
export function audioKeysOf(
  audioKey: string | null,
  audioChunks: string | null,
): string[] {
  const keys = new Set<string>()
  if (audioKey) keys.add(audioKey)
  try {
    const parsed = JSON.parse(audioChunks ?? '[]') as AudioChunk[]
    if (Array.isArray(parsed)) {
      for (const chunk of parsed) {
        if (chunk?.key) keys.add(chunk.key)
      }
    }
  } catch {
    // ignore malformed rows
  }
  return [...keys]
}

export async function generateLessonContent(env: LessonEnv, lessonId: string) {
  const { job, draft } = await writeArticle(env, lessonId)
  const sentences = splitSentences(draft.body)
  const spoken = await speakArticle(env, {
    userId: job.userId,
    lessonId,
    draft,
    sentences,
  })
  await persistArticle(env, lessonId, draft, sentences, spoken)
}
