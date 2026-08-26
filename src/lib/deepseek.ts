/**
 * DeepSeek official API client.
 *
 * The API is OpenAI-compatible, so this is a thin fetch wrapper rather than a
 * dependency. Model IDs are pinned: the legacy `deepseek-chat` and
 * `deepseek-reasoner` aliases were retired in July 2026.
 */

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
export const DEEPSEEK_MODEL = 'deepseek-v4-flash'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Why a call failed, in terms the caller can act on.
 *
 * `retryable` drives the workflow's backoff: retrying a quota or auth failure
 * just burns wall-clock time and lands on the same error, so those fail fast
 * and surface a real message to the learner instead.
 */
export type AiFailureKind =
  | 'quota'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'bad_output'
  | 'unknown'

export class AiError extends Error {
  readonly kind: AiFailureKind
  readonly retryable: boolean
  readonly status?: number
  private readonly overrideMessage?: string

  constructor(
    kind: AiFailureKind,
    message: string,
    options: {
      retryable: boolean
      status?: number
      cause?: unknown
      /** Replaces the generic copy when the caller knows something sharper. */
      userMessage?: string
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'AiError'
    this.kind = kind
    this.retryable = options.retryable
    this.status = options.status
    this.overrideMessage = options.userMessage
  }

  /** Learner-facing copy. Never leaks provider internals or key material. */
  get userMessage(): string {
    if (this.overrideMessage) return this.overrideMessage
    switch (this.kind) {
      case 'quota':
        return 'The daily AI budget for this app is used up. Lessons will work again tomorrow.'
      case 'auth':
        return 'The AI service is not configured correctly. This is on us, not you.'
      case 'rate_limit':
        return 'The AI service is busy right now. Try again in a minute.'
      case 'timeout':
        return 'The AI service took too long to answer. Try again.'
      case 'bad_output':
        return 'The article came back malformed. Try again.'
      default:
        return 'Something went wrong while writing this lesson. Try again.'
    }
  }
}

export function classifyHttpFailure(status: number, body: string): AiError {
  const text = body.slice(0, 400)
  if (status === 401 || status === 403) {
    return new AiError('auth', `DeepSeek auth failed (${status}): ${text}`, {
      retryable: false,
      status,
    })
  }
  // 402 is DeepSeek's "insufficient balance".
  if (status === 402) {
    return new AiError('quota', `DeepSeek balance exhausted: ${text}`, {
      retryable: false,
      status,
    })
  }
  if (status === 429) {
    return new AiError('rate_limit', `DeepSeek rate limited: ${text}`, {
      retryable: true,
      status,
    })
  }
  if (status >= 500) {
    return new AiError('unknown', `DeepSeek server error (${status}): ${text}`, {
      retryable: true,
      status,
    })
  }
  return new AiError('unknown', `DeepSeek request failed (${status}): ${text}`, {
    retryable: false,
    status,
  })
}

/** Maps a Workers AI binding error onto the same vocabulary. */
export function classifyWorkersAiFailure(error: unknown): AiError {
  const message = error instanceof Error ? error.message : String(error)
  if (/\b4006\b|daily free allocation|neurons/i.test(message)) {
    // Workers AI resets the free allowance at 00:00 UTC, so say so: "tomorrow"
    // is wrong for anyone west of UTC, which is most of a day's usage.
    return new AiError('quota', message, {
      retryable: false,
      cause: error,
      userMessage:
        "Today's free speech allowance is used up. It resets at 00:00 UTC.",
    })
  }
  if (/\b(429|rate limit|too many requests)\b/i.test(message)) {
    return new AiError('rate_limit', message, { retryable: true, cause: error })
  }
  if (/timed? ?out/i.test(message)) {
    return new AiError('timeout', message, { retryable: true, cause: error })
  }
  return new AiError('unknown', message, { retryable: true, cause: error })
}

export type DeepSeekConfig = {
  apiKey: string
  model?: string
  baseUrl?: string
}

export function readDeepSeekConfig(env: {
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_MODEL?: string
  DEEPSEEK_BASE_URL?: string
}): DeepSeekConfig {
  const apiKey = env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new AiError('auth', 'DEEPSEEK_API_KEY is not set', { retryable: false })
  }
  return {
    apiKey,
    model: env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_MODEL,
    baseUrl: env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_BASE_URL,
  }
}

export function isDeepSeekConfigured(env: { DEEPSEEK_API_KEY?: string }) {
  return Boolean(env.DEEPSEEK_API_KEY?.trim())
}

type ChatOptions = {
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  /** Ask DeepSeek to guarantee syntactically valid JSON. */
  json?: boolean
  timeoutMs?: number
  /**
   * Let the model think first. Off by default — see the note on the request
   * body. Nothing here needs it yet; the flag exists so turning it on is a
   * deliberate choice rather than a forgotten default.
   */
  think?: boolean
}

export async function chat(
  config: DeepSeekConfig,
  options: ChatOptions,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  )

  let response: Response
  try {
    response = await fetch(`${config.baseUrl ?? DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model ?? DEEPSEEK_MODEL,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 4000,
        temperature: options.temperature ?? 0.6,
        stream: false,
        // V4 thinks by default, at "high" effort, and those reasoning tokens
        // come out of max_tokens and bill at the output rate. Writing a graded
        // 300-word article does not need deliberation: left on, it regularly
        // spent the entire 4,000-token budget thinking and returned an empty
        // completion, which the workflow then retried — minutes of wall clock
        // for nothing.
        thinking: { type: options.think ? 'enabled' : 'disabled' },
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new AiError('timeout', 'DeepSeek request timed out', {
        retryable: true,
        cause,
      })
    }
    throw new AiError('unknown', 'Could not reach DeepSeek', {
      retryable: true,
      cause,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw classifyHttpFailure(response.status, await response.text())
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string }
      finish_reason?: string
    }>
    usage?: Record<string, number>
  }
  const choice = payload.choices?.[0]
  const content = choice?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    // Empty completions are the single biggest source of slow lessons, and an
    // unadorned message gives nothing to act on. finish_reason separates a
    // token budget spent on reasoning ("length") from the model simply
    // answering with nothing ("stop"), and the counts say which budget.
    const detail = [
      `finish_reason=${choice?.finish_reason ?? 'none'}`,
      `reasoning_chars=${choice?.message?.reasoning_content?.length ?? 0}`,
      `usage=${JSON.stringify(payload.usage ?? {})}`,
    ].join(' ')
    throw new AiError(
      'bad_output',
      `DeepSeek returned an empty completion (${detail})`,
      { retryable: true },
    )
  }
  return content
}

/**
 * Parse a JSON object out of a model reply. JSON mode makes this almost
 * always a plain `JSON.parse`, but a stray code fence still shows up
 * occasionally and is cheap to tolerate.
 */
export function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through to fence/brace extraction
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const text = fenced?.[1] ?? trimmed
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new AiError('bad_output', 'Model did not return a JSON object', {
      retryable: true,
    })
  }
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (cause) {
    throw new AiError('bad_output', 'Model returned malformed JSON', {
      retryable: true,
      cause,
    })
  }
}

export async function chatJson<T>(
  config: DeepSeekConfig,
  options: ChatOptions & { attempts?: number },
): Promise<T> {
  const attempts = options.attempts ?? 2
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return parseJsonObject(
        await chat(config, { ...options, json: true }),
      ) as T
    } catch (error) {
      lastError = error
      if (error instanceof AiError && !error.retryable) throw error
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AiError('unknown', 'DeepSeek call failed', { retryable: false })
}
