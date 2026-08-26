import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '#/lib/deepseek'
import {
  estimateTtsCostUsd,
  readOpenAiApiKey,
  readTtsMockUrl,
  synthesizeSpeech,
} from '#/lib/ai'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readTtsMockUrl', () => {
  it('is off unless explicitly set, so deploys reach the real model', () => {
    expect(readTtsMockUrl({})).toBeNull()
    expect(readTtsMockUrl({ TTS_MOCK_URL: '   ' })).toBeNull()
  })

  it('reads the mock endpoint when local development sets one', () => {
    expect(readTtsMockUrl({ TTS_MOCK_URL: ' http://127.0.0.1:8799/tts ' })).toBe(
      'http://127.0.0.1:8799/tts',
    )
  })
})

describe('readOpenAiApiKey', () => {
  it('is off unless explicitly set', () => {
    expect(readOpenAiApiKey({})).toBeNull()
    expect(readOpenAiApiKey({ OPENAI_API_KEY: '   ' })).toBeNull()
  })

  it('reads the key when production or local .dev.vars sets one', () => {
    expect(readOpenAiApiKey({ OPENAI_API_KEY: ' sk-test ' })).toBe('sk-test')
  })
})

describe('estimateTtsCostUsd', () => {
  it('prices a 300-word article in a few cents, not dollars', () => {
    // ~300 words, ~6 characters each including spaces.
    const cost = estimateTtsCostUsd(1800)
    expect(cost).toBeGreaterThan(0.01)
    expect(cost).toBeLessThan(0.1)
  })
})

describe('synthesizeSpeech', () => {
  it('spends nothing when a mock is configured', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'audio/wav' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const spoken = await synthesizeSpeech({
      text: 'Hello.',
      mockUrl: 'http://127.0.0.1:8799/tts',
      apiKey: 'sk-should-not-be-used',
    })

    expect(spoken.contentType).toBe('audio/wav')
    expect(spoken.audio.byteLength).toBe(3)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8799/tts',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('explains how to start the mock when it is not running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused')
      }),
    )

    await expect(
      synthesizeSpeech({
        text: 'Hello.',
        mockUrl: 'http://127.0.0.1:8799/tts',
      }),
    ).rejects.toThrow(/mock/i)
  })

  it('calls gpt-4o-mini-tts as a natural American reader', async () => {
    let capturedBody = ''
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return new Response(new Uint8Array([9]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const spoken = await synthesizeSpeech({
      text: 'Hello.',
      mockUrl: null,
      apiKey: 'sk-test',
    })

    expect(spoken.contentType).toBe('audio/mpeg')
    expect(spoken.audio.byteLength).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
      }),
    )

    const body = JSON.parse(capturedBody) as {
      model: string
      voice: string
      input: string
      instructions: string
      speed: number
      response_format: string
    }
    expect(body.model).toBe('gpt-4o-mini-tts')
    expect(body.voice).toBe('marin')
    expect(body.input).toBe('Hello.')
    expect(body.response_format).toBe('mp3')
    expect(body.speed).toBe(1)
    expect(body.instructions.toLowerCase()).toMatch(/american/)
    expect(body.instructions.toLowerCase()).toMatch(/natural|fluent/)
  })

  it('fails closed when no mock and no OpenAI key are configured', async () => {
    await expect(
      synthesizeSpeech({ text: 'Hello.', mockUrl: null, apiKey: null }),
    ).rejects.toMatchObject({ kind: 'auth', retryable: false })
  })

  it('maps an OpenAI 401 onto auth so the lesson still opens as reading-only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
            status: 401,
          }),
      ),
    )

    const error = await synthesizeSpeech({
      text: 'Hello.',
      apiKey: 'sk-bad',
    }).catch((cause) => cause)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ kind: 'auth', retryable: false })
  })

  it('maps insufficient quota onto quota so the workflow does not retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { type: 'insufficient_quota', message: 'quota' },
            }),
            { status: 429 },
          ),
      ),
    )

    const error = await synthesizeSpeech({
      text: 'Hello.',
      apiKey: 'sk-test',
    }).catch((cause) => cause)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ kind: 'quota', retryable: false })
  })
})
