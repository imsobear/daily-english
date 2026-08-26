import {
  AiError,
  chatJson,
  readDeepSeekConfig,
  type DeepSeekConfig,
} from '#/lib/deepseek'
import type { DictionaryHit, DictionarySense } from '#/lib/dictionary'
import { countWords, stripPosTags } from '#/lib/text'

export type ArticleDraft = {
  title: string
  body: string
  usedWords: string[]
  explanations: Array<{ phrase: string; meaning: string }>
}

export type WordSeed = {
  headword: string
  /** The sense the learner saved, so the article uses the word that way. */
  definition: string | null
  partOfSpeech?: string | null
  /** A known-correct sentence. Imitating one beats being told what to avoid. */
  example?: string | null
}

/**
 * Accepted prose length by level: 150-300 words, or 200-300 from B2 up.
 *
 * Every level shares the same 300-word ceiling. Speech bills by how long the
 * audio runs, so length maps straight onto cost, and 300 words is already a
 * couple of minutes of listening. The levels therefore differ by vocabulary
 * and sentence complexity rather than by sheer length.
 */
const LENGTH_BY_LEVEL: Record<string, { min: number; target: number }> = {
  A1: { min: 150, target: 300 },
  A2: { min: 150, target: 300 },
  B1: { min: 150, target: 300 },
  B2: { min: 200, target: 300 },
  C1: { min: 200, target: 300 },
  C2: { min: 200, target: 300 },
}

function lengthFor(level: string) {
  return LENGTH_BY_LEVEL[level] ?? LENGTH_BY_LEVEL.B1
}

function asDraft(value: unknown): ArticleDraft {
  const row =
    (value as { article?: Partial<ArticleDraft> }).article ??
    (value as Partial<ArticleDraft>)
  if (!row.title || !row.body) {
    throw new AiError('bad_output', 'Article is missing a title or body', {
      retryable: true,
    })
  }
  return {
    title: stripPosTags(String(row.title)).trim(),
    body: stripPosTags(String(row.body)).trim(),
    usedWords: Array.isArray(row.usedWords)
      ? row.usedWords.map((word) => stripPosTags(String(word)).trim())
      : [],
    explanations: Array.isArray(row.explanations)
      ? row.explanations
          .map((entry) => {
            const rec = entry as { phrase?: string; meaning?: string }
            return {
              phrase: stripPosTags(String(rec.phrase ?? '')).trim(),
              meaning: stripPosTags(String(rec.meaning ?? '')).trim(),
            }
          })
          .filter((entry) => entry.phrase && entry.meaning)
      : [],
  }
}

function buildArticlePrompt(input: {
  level: string
  topics: string[]
  words: WordSeed[]
  shortfall?: number
}) {
  const { target, min } = lengthFor(input.level)
  const topicLine =
    input.topics.length > 0 ? input.topics.join(', ') : 'everyday life'
  const wordLines = input.words
    .map((word) => {
      const pos = word.partOfSpeech ? ` [${word.partOfSpeech}]` : ''
      const sense = word.definition ? ` — means: ${word.definition}` : ''
      const example = word.example ? `\n    pattern to follow: ${word.example}` : ''
      return `- ${word.headword}${pos}${sense}${example}`
    })
    .join('\n')
  const targets = input.words.map((word) => word.headword).join(', ')

  const lengthNudge =
    input.shortfall != null
      ? `\nYour previous attempt was only ${input.shortfall} words. This one must be at least ${min} words — expand the ideas with concrete detail, do not pad with filler.`
      : ''

  // A learner can have an empty list, or three words rather than ten. With
  // nothing to weave in, the vocabulary half of the brief is not just
  // pointless but harmful: it invites the writer to invent target words and
  // then teach them.
  const brief =
    input.words.length > 0
      ? `
Target vocabulary — every one of these must appear at least once, used naturally and in the sense given:
${wordLines}

Required words: ${targets}
`
      : ''

  const vocabularyRules =
    input.words.length > 0
      ? `- Never list the target words or announce that they are being taught.
- Each target word is tagged with its part of speech in [brackets]. The tag is
  a note to you and must never appear in the article: write "the process often
  begins", never "the process [noun] often begins". Use the word as that part
  of speech and follow the grammatical pattern of its example.
  Inflected forms are fine ("realize" -> "realized", "pattern" -> "patterns").
  Never move a word into another word class. A [verb] must never appear as a
  noun: "the manage of the shop" is wrong, "she manages the shop" is right. A
  [preposition] stays a preposition: "he looked at her with despite" is wrong,
  "despite the noise, he kept working" is right. If a word will not fit,
  rewrite the sentence around it rather than bending its grammar.
`
      : `- Tell one concrete story or follow one concrete example. No survey of a
  topic, no "in today's world" opening.
- Use the vocabulary a ${input.level} learner is ready to meet next: a handful
  of words just above the level, each one clear from its sentence.
`

  const explanations =
    input.words.length > 0
      ? '- After the article, explain 8-12 key words or phrases in simple English, weighted toward the target words.'
      : `- After the article, explain 8-12 key words or phrases in simple English. These are what the learner will be offered to save, so choose the ones worth keeping — not the easiest ones.`

  const reread =
    input.words.length > 0
      ? '\n- Before you answer, reread every target word in context and fix any use a careful native speaker would call ungrammatical.'
      : ''

  return [
    {
      role: 'system' as const,
      content:
        'You write CEFR-leveled English reading passages for language learners. You always reply with a single JSON object and nothing else.',
    },
    {
      role: 'user' as const,
      content: `Write one original article for a ${input.level} English learner.

Theme: ${topicLine}.
Length: ${min}-${target} words, aiming for the upper end of that range. Never exceed ${target}. Write 3-5 real paragraphs of connected prose.${lengthNudge}
${brief}
Rules:
- Natural, engaging prose.
${vocabularyRules}- Keep grammar and sentence length appropriate for ${input.level}.
- American spelling throughout ("realize", "color", "traveled"), to match the voice that reads it aloud.
- Separate paragraphs with a blank line.
- Finish the final sentence. Never stop mid-clause.
${explanations}${reread}

Return exactly this JSON shape:
{"title":"","body":"","usedWords":["..."],"explanations":[{"phrase":"","meaning":""}]}`,
    },
  ]
}

/**
 * Generate an article and enforce the length contract.
 *
 * The model reliably undershoots the requested word count on the first pass,
 * so a short result is regenerated once with the actual shortfall quoted back
 * to it. Text generation is cheap relative to audio, so the retry is worth it.
 */
export async function generateArticle(input: {
  config: DeepSeekConfig
  level: string
  topics: string[]
  words: WordSeed[]
}): Promise<ArticleDraft> {
  const { min } = lengthFor(input.level)

  let best: ArticleDraft | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const draft = asDraft(
      await chatJson(input.config, {
        messages: buildArticlePrompt({
          level: input.level,
          topics: input.topics,
          words: input.words,
          shortfall: best ? countWords(best.body) : undefined,
        }),
        maxTokens: 4000,
        temperature: 0.7,
      }),
    )

    if (!best || countWords(draft.body) > countWords(best.body)) {
      best = draft
    }
    if (countWords(best.body) >= min) break
  }

  if (!best) {
    throw new AiError('bad_output', 'Article generation produced nothing', {
      retryable: true,
    })
  }
  return best
}

export async function defineWord(
  config: DeepSeekConfig,
  headword: string,
): Promise<DictionaryHit | null> {
  try {
    const value = await chatJson<{
      ipa?: string | null
      definitions?: Array<{ partOfSpeech?: string; definition?: string }>
      examples?: unknown
    }>(config, {
      messages: [
        {
          role: 'system',
          content:
            'You are a learner dictionary. Reply with a single JSON object and nothing else. Use simple English a B1 learner can read.',
        },
        {
          role: 'user',
          content: `Define the English headword "${headword}" for a language learner.

Return: {"ipa":"/.../ or null","definitions":[{"partOfSpeech":"noun","definition":"..."}],"examples":["..."]}

Rules:
- Order definitions by how common they are in modern everyday English. The most common sense must come first.
- Skip archaic, obsolete and highly technical senses entirely.
- 2-4 definitions, each one short sentence.
- 1-2 natural example sentences.
- IPA in General American if you are confident, otherwise null.`,
        },
      ],
      maxTokens: 700,
      temperature: 0.2,
    })

    const definitions: DictionarySense[] = Array.isArray(value.definitions)
      ? value.definitions
          .map((item) => ({
            partOfSpeech: String(item.partOfSpeech ?? 'unknown'),
            definition: String(item.definition ?? '').trim(),
          }))
          .filter((item) => item.definition.length > 0)
          .slice(0, 6)
      : []
    if (definitions.length === 0) return null

    const examples = Array.isArray(value.examples)
      ? value.examples.map(String).filter(Boolean).slice(0, 4)
      : []
    const ipa = value.ipa ? String(value.ipa) : null

    return {
      headword,
      ipa: ipa && ipa !== 'null' ? ipa : null,
      definitions,
      examples,
    }
  } catch {
    return null
  }
}

/**
 * The voice that reads lessons and headwords.
 *
 * OpenAI recommends `marin` or `cedar` for gpt-4o-mini-tts. `marin` is a
 * clear American female voice, close to the previous `asteria` so existing
 * learners are not jumped to a male speaker.
 */
export const TTS_MODEL = 'gpt-4o-mini-tts'
export const TTS_VOICE = 'marin'
export const TTS_SPEED = 1
export const TTS_INSTRUCTIONS =
  'Speak in natural, fluent General American English, as a native speaker reading a short article aloud. Conversational pacing and easy rhythm. Warm and clear, not robotic, not overly careful, and not theatrical.'

const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech'
/** Official gpt-4o-mini-tts list price, used only for the log line. */
const USD_PER_AUDIO_MINUTE = 0.015
const USD_PER_INPUT_MILLION_TOKENS = 0.6
const CONVERSATIONAL_WPM = 150
const CHARS_PER_WORD = 6
const CHARS_PER_TOKEN = 4

export type SpokenAudio = {
  audio: ArrayBuffer
  /** Follows the bytes: the local mock does not always produce MP3. */
  contentType: string
}

/**
 * Where to get speech from instead of OpenAI, when developing locally.
 *
 * Production speech is a paid API call. Setting TTS_MOCK_URL in `.dev.vars`
 * routes it to `pnpm mock:ai` instead. The variable is never set on the
 * deployed Worker, so production always reaches the real model.
 */
export function readTtsMockUrl(env: { TTS_MOCK_URL?: string }): string | null {
  return env.TTS_MOCK_URL?.trim() || null
}

export function readOpenAiApiKey(env: { OPENAI_API_KEY?: string }): string | null {
  return env.OPENAI_API_KEY?.trim() || null
}

/**
 * Rough USD for a clip, so Cloudflare logs show spend without a billing round
 * trip. gpt-4o-mini-tts is ~$0.015 per audio minute plus a negligible input
 * token charge. Duration follows the spoken pace, so this is only a log aid.
 */
export function estimateTtsCostUsd(charCount: number, speed = TTS_SPEED) {
  const words = charCount / CHARS_PER_WORD
  const minutes = words / (CONVERSATIONAL_WPM * speed)
  const inputTokens = charCount / CHARS_PER_TOKEN
  return minutes * USD_PER_AUDIO_MINUTE + (inputTokens * USD_PER_INPUT_MILLION_TOKENS) / 1_000_000
}

async function mockSpeech(url: string, text: string): Promise<SpokenAudio> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker: TTS_VOICE }),
    })
  } catch (cause) {
    throw new AiError('unknown', `TTS mock at ${url} is unreachable`, {
      retryable: false,
      cause,
      userMessage: 'The local audio mock is not running. Start it with `pnpm mock:ai`.',
    })
  }

  if (!response.ok) {
    throw new AiError('bad_output', `TTS mock failed (${response.status})`, {
      retryable: false,
    })
  }

  return {
    audio: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
  }
}

function classifyOpenAiTtsFailure(status: number, body: string): AiError {
  const text = body.slice(0, 400)
  const quota =
    /insufficient_quota/i.test(body) || /exceeded your current quota/i.test(body)
  if (quota) {
    return new AiError('quota', `OpenAI TTS quota exhausted: ${text}`, {
      retryable: false,
      status,
    })
  }
  if (status === 401 || status === 403) {
    return new AiError('auth', `OpenAI TTS auth failed (${status}): ${text}`, {
      retryable: false,
      status,
    })
  }
  if (status === 429) {
    return new AiError('rate_limit', `OpenAI TTS rate limited: ${text}`, {
      retryable: true,
      status,
    })
  }
  if (status >= 500) {
    return new AiError('unknown', `OpenAI TTS server error (${status}): ${text}`, {
      retryable: true,
      status,
    })
  }
  return new AiError('unknown', `OpenAI TTS failed (${status}): ${text}`, {
    retryable: false,
    status,
  })
}

/**
 * Speak one chunk of text with OpenAI gpt-4o-mini-tts.
 *
 * The model takes a style instruction, which is how we get a natural American
 * reader rather than a conversational agent. Billing follows audio duration,
 * so callers still budget characters — they are a decent proxy for minutes.
 */
export async function synthesizeSpeech(input: {
  text: string
  mockUrl?: string | null
  apiKey?: string | null
}): Promise<SpokenAudio> {
  if (input.mockUrl) return mockSpeech(input.mockUrl, input.text)

  const apiKey = input.apiKey?.trim()
  if (!apiKey) {
    throw new AiError('auth', 'OPENAI_API_KEY is not set', { retryable: false })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  let response: Response
  try {
    response = await fetch(OPENAI_SPEECH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: input.text,
        instructions: TTS_INSTRUCTIONS,
        speed: TTS_SPEED,
        response_format: 'mp3',
      }),
    })
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new AiError('timeout', 'OpenAI TTS timed out', {
        retryable: true,
        cause,
      })
    }
    throw new AiError('unknown', 'OpenAI TTS request failed', {
      retryable: true,
      cause,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw classifyOpenAiTtsFailure(response.status, detail)
  }

  const audio = await response.arrayBuffer()
  if (audio.byteLength === 0) {
    throw new AiError('bad_output', 'OpenAI TTS returned no audio', {
      retryable: true,
    })
  }

  console.info(
    JSON.stringify({
      tts: true,
      model: TTS_MODEL,
      voice: TTS_VOICE,
      chars: input.text.length,
      estimatedUsd: Number(estimateTtsCostUsd(input.text.length).toFixed(5)),
    }),
  )

  return {
    audio,
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
  }
}

export { readDeepSeekConfig, AiError }
