import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb, getEnv } from '#/db'
import { dictionaryEntries, users, words } from '#/db/schema'
import { TTS_VOICE } from '#/lib/ai'
import { entrySenses, loadEntry } from '#/lib/entries'
import type { LessonEnv } from '#/lib/generate-lesson'
import { demandedWords, prewarmBatch } from '#/lib/prewarm'
import { CARD_VERSION } from '#/lib/word-card'

/** What the model would send back for one of the made-up words below. */
function card(word: string) {
  return {
    senses: [
      {
        pos: 'noun',
        definition: 'a thing',
        zh: '东西',
        examples: [`A ${word} appeared.`],
      },
    ],
    collocations: [`a ${word}`],
    family: [],
  }
}

const DICTIONARY = [
  { pos: 'noun', definition: 'a thing', zh: null, examples: [] },
]

async function seed(
  word: string,
  options: { carded: boolean; ipa?: string | null; version?: number },
) {
  await getDb()
    .insert(dictionaryEntries)
    .values({
      normalized: word,
      headword: word,
      ipa: options.ipa === undefined ? '/θɪŋ/' : options.ipa,
      senses: JSON.stringify(options.carded ? card(word).senses : DICTIONARY),
      dictionarySenses: JSON.stringify(DICTIONARY),
      collocations: '[]',
      family: '[]',
      source: options.carded ? 'model' : 'dictionary',
      cardVersion: options.carded ? (options.version ?? CARD_VERSION) : 0,
      audioKey: `word-audio/${TTS_VOICE}/${word}.mp3`,
      updatedAt: new Date().toISOString(),
    })
}

/**
 * An env pointed at a model that is not really there.
 *
 * The answer may be a function of the prompt, which a batch of several words
 * needs: a card whose example is about another word is thrown out by the
 * checks and asked for a second time, and the call count is what these tests
 * are reading.
 */
function withModel(answer: unknown | ((prompt: string) => unknown)) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url))
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: { content?: string }[]
      }
      const reply =
        typeof answer === 'function'
          ? answer(body.messages?.[0]?.content ?? '')
          : answer
      return new Response(JSON.stringify(reply), {
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

    const { env } = withModel({ response: JSON.stringify(card(word)) })
    const tally = await prewarmBatch(env, [word])

    expect(tally.described).toBe(1)
    const entry = await loadEntry(getDb(), word)
    expect(entry?.source).toBe('model')
    expect(entry?.cardVersion).toBe(CARD_VERSION)
    expect(entrySenses(entry)[0].zh).toBe('东西')
    expect(entrySenses(entry)[0].examples).toEqual([`A ${word} appeared.`])
  })

  it('writes it again when the recipe has moved on since', async () => {
    const word = `warm${crypto.randomUUID().slice(0, 8)}`
    await seed(word, { carded: true, version: CARD_VERSION - 1 })

    const { env } = withModel({ response: JSON.stringify(card(word)) })
    const tally = await prewarmBatch(env, [word])

    // Nothing else in the app rewrites a card, so a word carded by an older
    // prompt has only this to rescue it.
    expect(tally.described).toBe(1)
    expect((await loadEntry(getDb(), word))?.cardVersion).toBe(CARD_VERSION)
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

    const { env, calls } = withModel((prompt: string) => ({
      response: JSON.stringify(
        card(/card for "([^"]+)"/.exec(prompt)?.[1] ?? ''),
      ),
    }))
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
