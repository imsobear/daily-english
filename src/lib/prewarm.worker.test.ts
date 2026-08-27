import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb, getEnv } from '#/db'
import { dictionaryEntries, users, words } from '#/db/schema'
import { TTS_VOICE } from '#/lib/ai'
import { entrySenses, loadEntry } from '#/lib/entries'
import type { LessonEnv } from '#/lib/generate-lesson'
import { demandedWords, prewarmBatch } from '#/lib/prewarm'

const CARD = {
  senses: [
    { pos: 'noun', definition: 'a thing', example: 'A thing.', zh: '东西' },
  ],
  collocations: ['a thing'],
  family: [],
}

const DICTIONARY = [
  { pos: 'noun', definition: 'a thing', zh: null, examples: [] },
]

async function seed(
  word: string,
  options: { carded: boolean; ipa?: string | null },
) {
  await getDb()
    .insert(dictionaryEntries)
    .values({
      normalized: word,
      headword: word,
      ipa: options.ipa === undefined ? '/θɪŋ/' : options.ipa,
      senses: JSON.stringify(options.carded ? CARD.senses : DICTIONARY),
      collocations: '[]',
      family: '[]',
      source: options.carded ? 'model' : 'dictionary',
      audioKey: `word-audio/${TTS_VOICE}/${word}.mp3`,
      updatedAt: new Date().toISOString(),
    })
}

/** An env pointed at a model that is not really there. */
function withModel(answer: unknown) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify(answer), {
        headers: { 'Content-Type': 'application/json' },
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
    await seed(word, { carded: true })

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
    await seed(word, { carded: false })

    const { env } = withModel({ response: JSON.stringify(CARD) })
    const tally = await prewarmBatch(env, [word])

    expect(tally.described).toBe(1)
    const entry = await loadEntry(getDb(), word)
    expect(entry?.source).toBe('model')
    expect(entrySenses(entry)[0].zh).toBe('东西')
    expect(entrySenses(entry)[0].examples).toEqual(['A thing.'])
  })

  it('counts a model that answers with nonsense as a failure, not a card', async () => {
    const word = `warm${crypto.randomUUID().slice(0, 8)}`
    await seed(word, { carded: false })

    const { env } = withModel({ response: 'sorry, no' })
    const tally = await prewarmBatch(env, [word])

    expect(tally.described).toBe(0)
    const entry = await loadEntry(getDb(), word)
    expect(entry?.source).toBe('dictionary')
  })

  it('goes back for a pronunciation the dictionary never gave', async () => {
    const word = `warm${crypto.randomUUID().slice(0, 8)}`
    await seed(word, { carded: true, ipa: null })

    const { env, calls } = withModel(null)
    await prewarmBatch(env, [word])

    // The card is written and nothing re-describes it, so this lookup is the
    // only chance the word has left of ever being transcribed.
    expect(calls).toEqual([
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
    ])
  })

  it('stops describing once the run has spent its budget', async () => {
    const words = Array.from(
      { length: 3 },
      () => `warm${crypto.randomUUID().slice(0, 8)}`,
    )
    for (const word of words) await seed(word, { carded: false })

    const { env, calls } = withModel({ response: JSON.stringify(CARD) })
    const tally = await prewarmBatch(env, words, { describeLimit: 2 })

    // The words left over keep their dictionary senses and are the first ones
    // tomorrow's run reaches.
    expect(tally.described).toBe(2)
    expect(calls).toHaveLength(2)
  })
})

describe('demandedWords', () => {
  it('offers the saved words the model still owes a card, oldest first', async () => {
    const db = getDb()
    const owner = `saver${crypto.randomUUID().slice(0, 8)}`
    await db
      .insert(users)
      .values({ id: owner, createdAt: new Date().toISOString() })

    const older = `warm${crypto.randomUUID().slice(0, 8)}`
    const newer = `warm${crypto.randomUUID().slice(0, 8)}`
    const carded = `warm${crypto.randomUUID().slice(0, 8)}`
    await seed(older, { carded: false })
    await seed(newer, { carded: false })
    await seed(carded, { carded: true })
    for (const [index, word] of [older, newer, carded].entries()) {
      await db.insert(words).values({
        id: crypto.randomUUID(),
        userId: owner,
        headword: word,
        normalized: word,
        source: 'manual',
        createdAt: new Date(2020, 0, 1 + index).toISOString(),
      })
    }

    // Other suites leave saved words behind, so this asserts on order within
    // the words it made rather than on the whole list.
    const demanded = (await demandedWords(db)).filter((word) =>
      [older, newer, carded].includes(word),
    )
    expect(demanded).toEqual([older, newer])
  })
})
