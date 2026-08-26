import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '#/db'
import { users } from '#/db/schema'
import {
  ensureEntry,
  entrySenses,
  loadEntries,
  needsBetterSenses,
  saveEntry,
  stubEntry,
} from '#/lib/entries'
import { saveWordForUser } from '#/server/words'

const sense = [{ partOfSpeech: 'verb', definition: 'to find something' }]

function word() {
  return `w${crypto.randomUUID().slice(0, 8)}`
}

describe('the shared entry', () => {
  it('does not replace model senses with dictionary ones', async () => {
    const db = getDb()
    const headword = word()
    await saveEntry(db, {
      headword,
      ipa: '/one/',
      definitions: sense,
      examples: ['first'],
      senseSource: 'model',
    })

    await saveEntry(db, {
      headword,
      ipa: '/two/',
      definitions: [{ partOfSpeech: 'noun', definition: 'an archaic sense' }],
      examples: ['second'],
      senseSource: 'legacy',
    })

    const entries = await loadEntries(db, [headword])
    expect(entrySenses(entries.get(headword))).toEqual(sense)
  })

  it('upgrades dictionary senses when the model answers later', async () => {
    const db = getDb()
    const headword = word()
    await saveEntry(db, {
      headword,
      ipa: null,
      definitions: [{ partOfSpeech: 'noun', definition: 'an archaic sense' }],
      examples: [],
      senseSource: 'legacy',
    })

    await saveEntry(db, {
      headword,
      ipa: '/new/',
      definitions: sense,
      examples: [],
      senseSource: 'model',
    })

    const entry = (await loadEntries(db, [headword])).get(headword)
    expect(entrySenses(entry)).toEqual(sense)
    expect(needsBetterSenses(entry)).toBe(false)
  })

  it('leaves a defined word alone rather than looking it up again', async () => {
    const db = getDb()
    const headword = word()
    await saveEntry(db, {
      headword,
      ipa: null,
      definitions: sense,
      examples: [],
      senseSource: 'model',
    })

    // A null config would make any real lookup return nothing, so getting the
    // senses back proves nothing was fetched.
    const entry = await ensureEntry(db, headword, null)
    expect(entrySenses(entry)).toEqual(sense)
  })

  it('keeps a stub from wiping a word someone already defined', async () => {
    const db = getDb()
    const headword = word()
    await saveEntry(db, {
      headword,
      ipa: null,
      definitions: sense,
      examples: [],
      senseSource: 'model',
    })

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
    await saveEntry(db, {
      headword,
      ipa: '/ʃeər/',
      definitions: sense,
      examples: ['an example'],
      senseSource: 'model',
    })

    const { word: card } = await saveWordForUser('sharer', {
      headword,
      source: 'manual',
    })

    expect(card.definitions).toEqual(sense)
    expect(card.ipa).toBe('/ʃeər/')
    expect(card.dictionaryMiss).toBe(false)
  })
})
