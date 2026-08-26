import type { DeepSeekConfig } from '#/lib/deepseek'

export type DictionarySense = {
  partOfSpeech: string
  definition: string
}

export type SenseSource = 'model' | 'legacy'

export type DictionaryHit = {
  headword: string
  ipa: string | null
  definitions: DictionarySense[]
  examples: string[]
  /** Whether `definitions` are frequency-ordered. Absent for raw API lookups. */
  senseSource?: SenseSource
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
  const definitions: DictionarySense[] = []
  const examples: string[] = []

  for (const meaning of entry.meanings ?? []) {
    for (const item of meaning.definitions ?? []) {
      if (item.definition && !DEAD_SENSE.test(item.definition)) {
        definitions.push({
          partOfSpeech: meaning.partOfSpeech ?? 'unknown',
          definition: item.definition,
        })
      }
      if (item.example) examples.push(item.example)
    }
  }

  return { definitions, examples }
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
 * Free dictionary lookup. Used for IPA, which the language model cannot supply
 * reliably. Its recorded audio is deliberately ignored: the media host 502s,
 * and the clips mixed Australian, British and American speakers.
 */
export async function lookupDictionary(
  headword: string,
): Promise<DictionaryHit | null> {
  const encoded = encodeURIComponent(headword)
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encoded}`,
    { signal: AbortSignal.timeout(6000) },
  )

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Dictionary lookup failed (${response.status})`)
  }

  const payload = (await response.json()) as DictionaryApiEntry[]
  const entry = payload[0]
  if (!entry) return null

  const { definitions, examples } = usableSenses(entry)
  const ipa = americanIpa(entry)

  return {
    headword: entry.word ?? headword,
    ipa,
    definitions: definitions.slice(0, 8),
    examples: examples.slice(0, 5),
  }
}

/**
 * Build the entry a learner sees, and that later seeds article generation.
 *
 * The two sources play to their strengths: the free dictionary contributes
 * IPA, while the model contributes definitions ordered by how common each
 * sense actually is today. Falling back to raw dictionary
 * senses is a last resort because their ordering is what produced glosses
 * like "despite: disdain, contemptuous feelings, hatred".
 */
export async function buildEntry(
  headword: string,
  config: DeepSeekConfig | null,
): Promise<DictionaryHit | null> {
  const [dictionary, model] = await Promise.all([
    lookupDictionary(headword).catch((error) => {
      console.error('Dictionary lookup failed', error)
      return null
    }),
    config
      ? import('#/lib/ai').then((mod) => mod.defineWord(config, headword))
      : Promise.resolve(null),
  ])

  if (!dictionary && !model) return null

  const fromModel = Boolean(model?.definitions?.length)
  const definitions = fromModel
    ? model!.definitions
    : (dictionary?.definitions ?? [])
  if (definitions.length === 0) return null

  const examples =
    model?.examples?.length ? model.examples : (dictionary?.examples ?? [])

  return {
    headword: dictionary?.headword ?? headword,
    ipa: dictionary?.ipa ?? model?.ipa ?? null,
    definitions,
    examples,
    senseSource: fromModel ? 'model' : 'legacy',
  }
}
