import type { Sense } from '#/lib/word-card'

export type DictionaryHit = {
  headword: string
  ipa: string | null
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

function usableSenses(entry: DictionaryApiEntry) {
  const senses: Sense[] = []

  for (const meaning of entry.meanings ?? []) {
    for (const item of meaning.definitions ?? []) {
      if (!item.definition || DEAD_SENSE.test(item.definition)) continue
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
export async function lookupDictionary(
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

  const senses = usableSenses(entry)
  if (senses.length === 0) return null

  return {
    headword: entry.word ?? headword,
    ipa: americanIpa(entry),
    // Three, like the model card, so the stopgap does not turn into a wall of
    // Wiktionary the moment a word has a long history.
    senses: senses.slice(0, 3),
  }
}
