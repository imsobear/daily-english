import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb, getEnv } from '#/db'
import { users } from '#/db/schema'
import {
  ensureEntry,
  entryCollocations,
  entrySenses,
  loadEntries,
  loadEntry,
  needsCard,
  saveDictionary,
  stubEntry,
} from '#/lib/entries'
import { describeEntry } from '#/lib/prewarm'
import type { Sense } from '#/lib/word-card'
import { saveWordForUser } from '#/server/words'

const sense: Sense[] = [
  { pos: 'verb', definition: 'to find something', zh: null, examples: [] },
]

const CARD = {
  senses: [
    {
      pos: 'verb',
      definition: 'to come across something',
      example: 'She discovered a leak.',
      zh: '发现',
    },
  ],
  collocations: ['discover that'],
  family: [],
}

function word() {
  return `w${crypto.randomUUID().slice(0, 8)}`
}

/** An env pointed at a model that is not really there. */
function withModel(answer: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(answer), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
  return {
    ...getEnv(),
    WORKERS_AI_MOCK_URL: 'https://model.test/word-card',
  } as unknown as Parameters<typeof describeEntry>[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the shared entry', () => {
  it('does not replace model senses with dictionary ones', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: '/one/', senses: sense })
    const env = withModel({ response: JSON.stringify(CARD) })
    await describeEntry(env, db, headword)

    await saveDictionary(db, headword, {
      headword,
      ipa: '/two/',
      senses: [
        { pos: 'noun', definition: 'an archaic sense', zh: null, examples: [] },
      ],
    })

    const entry = (await loadEntries(db, [headword])).get(headword)
    expect(entrySenses(entry)[0].definition).toBe('to come across something')
    expect(entry?.ipa).toBe('/one/')
  })

  it('upgrades dictionary senses when the model answers later', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: null, senses: sense })
    expect(needsCard(await loadEntry(db, headword))).toBe(true)

    const env = withModel({ response: JSON.stringify(CARD) })
    await describeEntry(env, db, headword)

    const entry = await loadEntry(db, headword)
    expect(entrySenses(entry)[0].zh).toBe('发现')
    expect(entryCollocations(entry)).toEqual(['discover that'])
    expect(needsCard(entry)).toBe(false)
  })

  it('leaves a nonsense answer with the senses it had', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: null, senses: sense })

    expect(
      await describeEntry(withModel({ response: 'sorry, no' }), db, headword),
    ).toBe(false)
    expect(entrySenses(await loadEntry(db, headword))).toEqual(sense)
  })

  it('leaves a defined word alone rather than looking it up again', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: null, senses: sense })

    // Nothing is reachable, so getting the senses back proves no lookup ran.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    const entry = await ensureEntry(db, headword)
    expect(entrySenses(entry)).toEqual(sense)
  })

  it('keeps a stub from wiping a word someone already defined', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: null, senses: sense })

    const entry = await stubEntry(db, headword, headword)
    expect(entrySenses(entry)).toEqual(sense)
  })

  it('reads back more words than D1 will bind in one statement', async () => {
    const db = getDb()
    const headwords = Array.from({ length: 120 }, () => word())
    for (const headword of headwords) await stubEntry(db, headword, headword)

    const entries = await loadEntries(db, headwords)

    expect(entries.size).toBe(120)
  })
})

describe('saving a word someone else already has', () => {
  beforeEach(async () => {
    await getDb()
      .insert(users)
      .values({ id: 'sharer', createdAt: new Date().toISOString() })
      .onConflictDoNothing()
  })

  it('is defined the moment it is added', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, {
      headword,
      ipa: '/ʃeər/',
      senses: sense,
    })

    const { word: card } = await saveWordForUser('sharer', {
      headword,
      source: 'manual',
    })

    expect(card.senses).toEqual(sense)
    expect(card.ipa).toBe('/ʃeər/')
    expect(card.dictionaryMiss).toBe(false)
  })
})
