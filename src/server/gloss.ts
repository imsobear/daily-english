import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray } from 'drizzle-orm'

import { getDb } from '#/db'
import { words } from '#/db/schema'
import { normalizeHeadword } from '#/lib/dictionary'
import {
  ensureEntry,
  entrySenses,
  isDefined,
  loadEntries,
  type EntriesDb,
} from '#/lib/entries'
import { TTS_VOICE } from '#/lib/ai'
import { requireUser } from '#/lib/session'
import { baseFormCandidates } from '#/lib/text'

export type Gloss = {
  headword: string
  ipa: string | null
  definition: string | null
  partOfSpeech: string | null
  example: string | null
  saved: boolean
  /** Synthesised on first play and keyed by the word, so it is spoken once. */
  audioUrl: string
}

/**
 * Which form of a tapped word to look up.
 *
 * An article says "revealed" where the dictionary says "reveal", and a card
 * about the past tense of a word is not what the learner asked for. The
 * candidate forms are guesses, so one is only taken when something vouches for
 * it: a word this learner has saved, or an entry someone has already had
 * defined. Nothing to vouch for it means the word is looked up as written,
 * which is what keeps "series" from being served as "sery".
 */
async function dictionaryForm(
  db: EntriesDb,
  userId: string,
  tapped: string,
): Promise<string> {
  const candidates = baseFormCandidates(tapped)
  if (candidates.length === 0) return tapped

  const saved = await db.query.words.findMany({
    where: and(
      eq(words.userId, userId),
      inArray(words.normalized, [tapped, ...candidates]),
    ),
    columns: { normalized: true },
  })
  const owned = new Set(saved.map((row) => row.normalized))
  if (owned.has(tapped)) return tapped

  const ownedForm = candidates.find((word) => owned.has(word))
  if (ownedForm) return ownedForm

  const entries = await loadEntries(db, candidates)
  const defined = candidates.find((word) => isDefined(entries.get(word)))
  return defined ?? tapped
}

/**
 * Look up a single word tapped inside an article.
 *
 * The shared entry answers most taps outright — every word in the article was
 * either seeded from someone's list or looked up by whoever tapped it first —
 * so this usually costs one read and no model call at all.
 */
export const glossWord = createServerFn({ method: 'POST' })
  .validator((data: { headword: string }) => {
    const headword = normalizeHeadword(data.headword)
    if (headword.length < 1 || headword.length > 60) {
      throw new Error('Not a word we can look up')
    }
    return { headword }
  })
  .handler(async ({ data }): Promise<Gloss> => {
    const user = await requireUser()
    const db = getDb()

    const headword = await dictionaryForm(db, user.id, data.headword)

    const [entry, owned] = await Promise.all([
      ensureEntry(db, headword),
      db.query.words.findFirst({
        where: and(eq(words.userId, user.id), eq(words.normalized, headword)),
        columns: { id: true },
      }),
    ])

    const senses = entrySenses(entry)
    return {
      headword: entry?.headword ?? headword,
      ipa: entry?.ipa ?? null,
      definition: senses[0]?.definition ?? null,
      partOfSpeech: senses[0]?.pos || null,
      example: senses[0]?.examples[0] ?? null,
      saved: Boolean(owned),
      audioUrl: `/api/word-audio/${encodeURIComponent(headword)}?v=${TTS_VOICE}`,
    }
  })
