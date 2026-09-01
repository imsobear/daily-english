import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb, getEnv } from '#/db'
import { dictionaryEntries, users } from '#/db/schema'
import {
  ensureEntry,
  entryCollocations,
  entryDictionarySenses,
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

function word() {
  return `w${crypto.randomUUID().slice(0, 8)}`
}

/** What the model would send back for one of the made-up words above. */
function card(headword: string) {
  return {
    senses: [
      {
        pos: 'verb',
        definition: 'to come across something',
        zh: '发现',
        examples: [`She ${headword}ed a leak.`],
      },
    ],
    collocations: [`${headword} that`],
    family: [],
  }
}

/** An env pointed at a model that is not really there. */
function withModel(answer: unknown) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: { content?: string }[]
      }
      // The dictionary is fetched through the same stub and sends no body.
      const prompt = body.messages?.[0]?.content
      if (prompt) calls.push(prompt)
      return new Response(JSON.stringify(answer), {
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  const env = {
    ...getEnv(),
    WORKERS_AI_MOCK_URL: 'https://model.test/word-card',
  } as unknown as Parameters<typeof describeEntry>[0]
  return { env, prompts: calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the shared entry', () => {
  it('does not replace model senses with dictionary ones', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: '/one/', senses: sense })
    const { env } = withModel({ response: JSON.stringify(card(headword)) })
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

    const { env } = withModel({ response: JSON.stringify(card(headword)) })
    await describeEntry(env, db, headword)

    const entry = await loadEntry(db, headword)
    expect(entrySenses(entry)[0].zh).toBe('发现')
    expect(entryCollocations(entry)).toEqual([`${headword} that`])
    expect(needsCard(entry)).toBe(false)
  })

  it('keeps what the dictionary said, and writes it to the model', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: null, senses: sense })

    const stored = await loadEntry(db, headword)
    expect(entryDictionarySenses(stored)).toEqual(sense)
    expect(stored?.source).toBe('dictionary')

    const { env, prompts } = withModel({
      response: JSON.stringify(card(headword)),
    })
    await describeEntry(env, db, headword, stored)

    expect(prompts[0]).toContain('verb — to find something')
    // Overwritten in `senses`, still there underneath for the next rewrite.
    expect(entryDictionarySenses(await loadEntry(db, headword))).toEqual(sense)
  })

  it('fetches the dictionary again for a word carded before we kept it', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: null, senses: sense })
    await db
      .update(dictionaryEntries)
      .set({ dictionarySenses: '[]' })
      .where(eq(dictionaryEntries.normalized, headword))

    // The stub answers the dictionary with the same nonsense it answers
    // everything, so this is the case worth being sure about: a rewrite that
    // cannot recover the dictionary text still happens, ungrounded.
    const { env, prompts } = withModel({
      response: JSON.stringify(card(headword)),
    })
    expect(await describeEntry(env, db, headword, await loadEntry(db, headword)))
      .toBe(true)
    expect(prompts[0]).toContain('nothing for this word')
  })

  it('waits for the dictionary rather than rewrite a card without it', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: null, senses: sense })
    const { env } = withModel({ response: JSON.stringify(card(headword)) })
    await describeEntry(env, db, headword, await loadEntry(db, headword))

    // The dictionary drops every request that misses its cache for hours at a
    // time. A rewrite during one of those would lose the grounding and stamp
    // the word as done, so it is left for a night that goes better.
    await db
      .update(dictionaryEntries)
      .set({ dictionarySenses: '[]' })
      .where(eq(dictionaryEntries.normalized, headword))
    const model = vi.fn(async (_url: string) => new Response('{}'))
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('dictionaryapi')) throw new Error('timed out')
      return model(String(url))
    })

    const carded = await loadEntry(db, headword)
    expect(await describeEntry(env, db, headword, carded)).toBe(false)
    expect(model).not.toHaveBeenCalled()
  })

  it('leaves a nonsense answer with the senses it had', async () => {
    const db = getDb()
    const headword = word()
    await saveDictionary(db, headword, { headword, ipa: null, senses: sense })

    const { env } = withModel({ response: 'sorry, no' })
    expect(await describeEntry(env, db, headword)).toBe(false)
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
