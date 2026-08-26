import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb, getEnv } from '#/db'
import { dictionaryEntries } from '#/db/schema'
import { TTS_VOICE } from '#/lib/ai'
import type { LessonEnv } from '#/lib/generate-lesson'
import { prewarmBatch } from '#/lib/prewarm'
import { readWordDetail, type WordDetail } from '#/lib/word-detail'

const CARD: WordDetail = {
  usage: { pattern: 'at thing of something', example: 'A thing of note.' },
  senses: [
    { pos: 'noun', definition: 'a thing', example: 'A thing.', zh: '东西' },
  ],
  collocations: ['a thing'],
  family: [],
}

async function seed(word: string, detail: WordDetail | null) {
  await getDb()
    .insert(dictionaryEntries)
    .values({
      normalized: word,
      headword: word,
      definitions: JSON.stringify([
        { partOfSpeech: 'noun', definition: 'a thing' },
      ]),
      examples: '[]',
      senseSource: 'model',
      detail: detail ? JSON.stringify(detail) : null,
      audioKey: `word-audio/${TTS_VOICE}/${word}.mp3`,
      updatedAt: new Date().toISOString(),
    })
}

/** An env pointed at a model that is not really there. */
function withModel(answer: unknown) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url))
      return new Response(JSON.stringify(answer), {
        headers: { 'Content-Type': 'application/json' },
        status: init ? 200 : 200,
      })
    }),
  )
  const env = {
    ...getEnv(),
    WORKERS_AI_MOCK_URL: 'https://model.test/word-card',
  } as unknown as LessonEnv
  return { env, calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prewarmBatch', () => {
  it('does nothing for a word already defined, spoken and described', async () => {
    const word = `warm${crypto.randomUUID().slice(0, 8)}`
    await seed(word, CARD)

    // No network is reachable for this word's definition, audio or card, so a
    // pass that tried any of them would fail rather than report a clean skip.
    // That is what makes the whole run resumable.
    const { env, calls } = withModel(null)
    const tally = await prewarmBatch(env, [word])

    expect(tally).toEqual({
      seen: 1,
      defined: 0,
      spoken: 0,
      described: 0,
      failed: 0,
    })
    expect(calls).toEqual([])
  })

  it('writes the card for a word that has none', async () => {
    const word = `warm${crypto.randomUUID().slice(0, 8)}`
    await seed(word, null)

    const { env } = withModel({ response: JSON.stringify(CARD) })
    const tally = await prewarmBatch(env, [word])

    expect(tally.described).toBe(1)
    const row = await getDb().query.dictionaryEntries.findFirst({
      where: (entries, { eq }) => eq(entries.normalized, word),
    })
    expect(readWordDetail(row?.detail)?.usage?.pattern).toBe(
      'at thing of something',
    )
  })

  it('counts a model that answers with nonsense as a failure, not a card', async () => {
    const word = `warm${crypto.randomUUID().slice(0, 8)}`
    await seed(word, null)

    const { env } = withModel({ response: 'sorry, no' })
    const tally = await prewarmBatch(env, [word])

    expect(tally.described).toBe(0)
    const row = await getDb().query.dictionaryEntries.findFirst({
      where: (entries, { eq }) => eq(entries.normalized, word),
    })
    expect(row?.detail).toBeNull()
  })
})
