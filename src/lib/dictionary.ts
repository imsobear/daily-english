import type { Sense } from '#/lib/word-card'

export type DictionaryHit = {
  headword: string
  ipa: string | null
  /**
   * Every sense worth keeping, in the order the dictionary gives them. The
   * model writes the card from all of it; the learner is shown the first few
   * while it does.
   */
  senses: Sense[]
}

export type DictionaryApiEntry = {
  word?: string
  phonetic?: string
  phonetics?: Array<{ text?: string; audio?: string }>
  meanings?: Array<{
    partOfSpeech?: string
    definitions?: Array<{ definition?: string; example?: string }>
  }>
}

type WiktionaryBlock = {
  partOfSpeech?: string
  definitions?: Array<{ definition?: string; examples?: string[] }>
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** A sentence out of the markup Wiktionary wraps it in. */
function plainText(html: string) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith('#')) {
        const point = Number(
          code.startsWith('#x') ? `0x${code.slice(2)}` : code.slice(1),
        )
        return Number.isFinite(point) ? String.fromCodePoint(point) : whole
      }
      return ENTITIES[code.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeHeadword(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Wiktionary-derived senses arrive in historical order, so the first entry for
 * "despite" is the archaic noun ("disdain, contemptuous feelings"). Anything
 * flagged as obsolete is dropped outright and the rest keep source order.
 */
const DEAD_SENSE =
  /\b(archaic|obsolete|dated|rare|historical|poetic|no longer in use)\b/i

/**
 * How many definitions to keep from one part of speech of one entry.
 *
 * Wiktionary splits a sense as finely as a lexicographer cares to, and the
 * fifteenth reading of a verb is not what the model is short of. Taking a few
 * from each block instead of a few from the top is what lets a later block be
 * heard at all.
 */
const PER_BLOCK = 3

/**
 * Every sense in the payload, not just the first word that happens to be
 * spelt this way.
 *
 * The API returns one entry per etymology, so "squash" arrives as three: the
 * sport and the verb, then the vegetable, then a muskrat. Reading `payload[0]`
 * and cutting it short took the nouns off the top of the first entry and threw
 * away both the crushing and the gourd — the card came back as a sport, a
 * drink and a cramped space. The junk at the end costs nothing, because the
 * model is told to drop what a learner never meets.
 */
export function sensesFrom(payload: DictionaryApiEntry[]) {
  const senses: Sense[] = []

  for (const entry of payload) {
    for (const meaning of entry.meanings ?? []) {
      let kept = 0
      for (const item of meaning.definitions ?? []) {
        if (kept >= PER_BLOCK) break
        if (!item.definition || DEAD_SENSE.test(item.definition)) continue
        kept += 1
        senses.push({
          pos: meaning.partOfSpeech ?? '',
          definition: item.definition,
          // The dictionary has no Chinese. The model that replaces these senses
          // does, which is the difference between a stopgap and a card.
          zh: null,
          examples: item.example ? [item.example] : [],
        })
      }
    }
  }

  return senses
}

/**
 * Pick the General American transcription.
 *
 * The top-level `phonetic` is Received Pronunciation, so it contradicts the
 * American voice that speaks the word: it renders "discover" as /dɪsˈkʊvə/,
 * dropping the r the learner will actually hear. The variants carry no accent
 * label, but the one paired with US audio is the American reading.
 */
export function americanIpa(entry: DictionaryApiEntry) {
  const variants = entry.phonetics ?? []
  const american = variants.find(
    (item) => item.text && item.audio?.includes('-us.'),
  )
  return american?.text || entry.phonetic || variants.find((i) => i.text)?.text || null
}

/**
 * Free dictionary lookup: an IPA, and senses good enough to show while the
 * model writes better ones. Its recorded audio is deliberately ignored — the
 * media host 502s, and the clips mixed Australian, British and American
 * speakers.
 *
 * A learner is waiting on this, having just tapped a word, so it gets three
 * seconds rather than six. Late is the same as missing here: the card renders
 * from whatever came back, and the model call behind it fixes the rest.
 */
async function lookupFreeDictionary(
  headword: string,
): Promise<DictionaryHit | null> {
  const encoded = encodeURIComponent(headword)
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encoded}`,
    { signal: AbortSignal.timeout(3000) },
  )

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Dictionary lookup failed (${response.status})`)
  }

  const payload = (await response.json()) as DictionaryApiEntry[]
  const entry = payload[0]
  if (!entry) return null

  const senses = sensesFrom(payload)
  if (senses.length === 0) return null

  return {
    headword: entry.word ?? headword,
    ipa: americanIpa(entry),
    senses,
  }
}

/**
 * Wiktionary's own shape, mapped onto the one `sensesFrom` reads.
 *
 * It groups by part of speech and by etymology at once, which is the same
 * division the other API expresses as separate entries, so each group becomes
 * a meaning and the reader below is unchanged. Definitions arrive as HTML: the
 * links and the little grey labels are markup around a sentence, and the
 * sentence is all a card wants.
 */
export function wiktionarySenses(payload: unknown) {
  const blocks = (payload as { en?: WiktionaryBlock[] } | null)?.en
  if (!Array.isArray(blocks)) return []

  return sensesFrom([
    {
      meanings: blocks.map((block) => ({
        partOfSpeech: (block.partOfSpeech ?? '').toLowerCase(),
        definitions: (block.definitions ?? []).map((item) => ({
          definition: plainText(item.definition ?? ''),
          example: item.examples?.[0] ? plainText(item.examples[0]) : undefined,
        })),
      })),
    },
  ])
}

async function lookupWiktionary(headword: string) {
  const encoded = encodeURIComponent(headword)
  const response = await fetch(
    `https://en.wiktionary.org/api/rest_v1/page/definition/${encoded}`,
    {
      signal: AbortSignal.timeout(4000),
      // Wikimedia asks callers to say who they are, and answers slower to the
      // ones that do not.
      headers: { 'user-agent': 'daily-english (https://english.readish.app)' },
    },
  )

  if (response.status === 404) return []
  if (!response.ok) throw new Error(`Wiktionary lookup failed (${response.status})`)
  return wiktionarySenses(await response.json())
}

/**
 * Free dictionary lookup: an IPA, and senses good enough to show while the
 * model writes better ones. Its recorded audio is deliberately ignored — the
 * media host 502s, and the clips mixed Australian, British and American
 * speakers.
 *
 * A learner is waiting on this, having just tapped a word, so it gets three
 * seconds rather than six. Late is the same as missing here: the card renders
 * from whatever came back, and the model call behind it fixes the rest.
 *
 * Which is why Wiktionary is asked at the same time rather than afterwards.
 * `api.dictionaryapi.dev` is a scrape of Wiktionary and has spent days at a
 * stretch answering nothing but a 522 twenty seconds late, and waiting out one
 * host before starting on the next would cost the learner both. It stays the
 * preferred answer while it is up, because it is the only one of the two that
 * carries a pronunciation; a word rescued by the backup has no IPA until
 * `ensureIpa` goes back for it.
 */
export async function lookupDictionary(
  headword: string,
): Promise<DictionaryHit | null> {
  // Started before the primary is awaited, and left to run if it is not
  // needed. A rejection here is an answer, not a crash.
  const backup = lookupWiktionary(headword).catch(() => null)

  let failure: unknown = null
  const hit = await lookupFreeDictionary(headword).catch((error: unknown) => {
    failure = error
    return null
  })
  if (hit) return hit

  const senses = await backup
  // Neither host answered, which is a different thing from a word neither has
  // heard of, and `ensureDictionarySenses` reads the difference off the throw.
  if (!senses) {
    if (failure) throw failure
    return null
  }
  if (senses.length === 0) return null

  return { headword, ipa: null, senses }
}
