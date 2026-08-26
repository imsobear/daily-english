export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function wordAppearsIn(headword: string, text: string) {
  const trimmed = headword.trim()
  if (!trimmed) return false
  const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'i')
  return pattern.test(text)
}

/**
 * A headword together with the plain inflections an article is likely to use.
 *
 * Deliberately naive — no stemming, no doubled consonants — because it is only
 * ever used to find or mark a word a learner is already looking at, where a
 * miss costs nothing and a wrong match would be confusing.
 */
export function wordPattern(headword: string, flags = 'i') {
  return new RegExp(
    `\\b${escapeRegExp(headword.trim())}(?:s|es|d|ed|ing)?\\b`,
    flags,
  )
}

/** "stopped" -> "stop": a final consonant doubled to keep the vowel short. */
function undouble(stem: string) {
  return /([^aeiou])\1$/.test(stem) ? stem.slice(0, -1) : stem
}

/**
 * Dictionary forms an inflected word might have come from, best guess first.
 *
 * English inflection does not reverse without a lexicon — "used" could be "us"
 * or "use", and "series" is not the plural of "sery" — so this proposes rather
 * than decides. Callers pick the first candidate they can confirm against
 * words known to exist, and otherwise leave the word as it was written.
 */
export function baseFormCandidates(word: string): string[] {
  const out: string[] = []
  const add = (value: string) => {
    // Two-letter stems are almost always a wrong cut ("used" -> "us") and the
    // words they would shadow are ones nobody taps.
    if (value.length >= 3 && value !== word && !out.includes(value)) {
      out.push(value)
    }
  }

  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`)
  if (/(?:ch|sh|ss|x|z)es$/.test(word)) add(word.slice(0, -2))
  if (/[^s]s$/.test(word)) add(word.slice(0, -1))
  if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ed')) {
    const stem = word.slice(0, -2)
    add(undouble(stem))
    add(stem)
    add(`${stem}e`)
  }
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3)
    add(undouble(stem))
    add(stem)
    add(`${stem}e`)
  }

  return out
}

/**
 * The form to look a tapped word up under, given words already known to
 * exist. Anything the list cannot vouch for is left exactly as it was tapped.
 */
export function baseForm(word: string, known: Iterable<string>): string {
  const lower = word.trim().toLowerCase()
  const set = new Set<string>()
  for (const item of known) set.add(item.trim().toLowerCase())
  if (set.has(lower)) return lower
  return baseFormCandidates(lower).find((item) => set.has(item)) ?? lower
}

/** The first sentence that uses a word, for showing it back in context. */
export function findSentenceWith(sentences: string[], headword: string) {
  if (!headword.trim()) return null
  const pattern = wordPattern(headword)
  return sentences.find((sentence) => pattern.test(sentence)) ?? null
}

export function countWords(text: string) {
  const matches = text.trim().match(/\S+/g)
  return matches ? matches.length : 0
}

/**
 * A bracketed part-of-speech label, as the article prompt attaches to each
 * target word.
 */
const POS_TAG =
  /\s*[[(](?:noun|verb|adjective|adverb|preposition|conjunction|pronoun|determiner|article|interjection|exclamation|abbreviation|modal|auxiliary|phrasal verb|phrase|idiom)s?[\])]/gi

/**
 * Remove part-of-speech tags the writer was meant to read but not repeat.
 *
 * The prompt hands the model each target word tagged with its word class, and
 * it occasionally copies the tag into the prose: "the process [noun] often
 * begins". The learner then hears "noun" spoken mid-sentence, since the same
 * text is what gets synthesised. Stripping it is cheaper and steadier than
 * rerolling the article on the chance the next draft behaves.
 */
export function stripPosTags(text: string) {
  return text.replace(POS_TAG, '')
}

/** Common abbreviations that end in a period without ending a sentence. */
const ABBREVIATIONS =
  /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|approx|dept|fig|no|inc|ltd|co)\.$/i

/**
 * Split prose into sentences. Used both to chunk text for TTS and to align
 * audio playback with the on-screen text, so the two must agree exactly —
 * always segment once and pass the result around.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const out: string[] = []
  for (const paragraph of normalized.split(/\n{2,}/)) {
    const source = paragraph.trim()
    if (!source) continue

    let buffer = ''
    // Break after ., !, ? or … when followed by whitespace.
    for (const piece of source.split(/(?<=[.!?…])\s+/)) {
      buffer = buffer ? `${buffer} ${piece}` : piece
      const tooShortToStandAlone = countWords(buffer) < 3
      if (ABBREVIATIONS.test(buffer) || tooShortToStandAlone) continue
      out.push(buffer.trim())
      buffer = ''
    }
    if (buffer.trim()) {
      // Fold a dangling fragment into the previous sentence rather than
      // emitting a one-word "sentence" that would get its own audio clip.
      if (countWords(buffer) < 3 && out.length > 0) {
        out[out.length - 1] = `${out[out.length - 1]} ${buffer.trim()}`
      } else {
        out.push(buffer.trim())
      }
    }
  }

  return out
}

/**
 * Indices of the sentences that begin a paragraph.
 *
 * Sentences are flattened for audio alignment, so this is what lets the reader
 * put the paragraph breaks back without a second, possibly divergent, parse of
 * the body.
 */
export function paragraphStarts(body: string, sentences: string[]): number[] {
  const starts: number[] = []
  let cursor = 0

  for (const [index, sentence] of sentences.entries()) {
    const at = body.indexOf(sentence, cursor)
    if (at < 0) continue
    if (index === 0 || /\n\s*\n/.test(body.slice(cursor, at))) {
      starts.push(index)
    }
    cursor = at + sentence.length
  }

  return starts.length > 0 ? starts : [0]
}

/** Beyond this a single TTS request gets slow and risks the provider's cap. */
const MAX_CLIP_CHARS = 1200

/**
 * Group sentences into a few balanced parts for text-to-speech.
 *
 * The Listen step stops at the end of every part, so the count is a pacing
 * decision, not a technical one: three pauses through an article is a rhythm,
 * five is an interruption. Packing to a fixed character budget instead would
 * hand that decision to however long the writer happened to be, which is how
 * a 300-word article ended up in five pieces.
 *
 * A runaway article still splits further, since the parts have to stay small
 * enough to synthesise.
 */
export function chunkSentences(sentences: string[], parts = 3): string[][] {
  if (sentences.length === 0) return []

  const lengths = sentences.map((sentence) => sentence.length + 1)
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const count = Math.max(
    Math.min(parts, sentences.length),
    Math.ceil(total / MAX_CLIP_CHARS),
  )
  if (count <= 1) return [sentences]

  const share = total / count
  const chunks: string[][] = []
  let current: string[] = []
  let size = 0

  sentences.forEach((sentence, index) => {
    // Close the part once this sentence would carry it further past its share
    // than leaving it out would fall short — but never so eagerly that the
    // parts still to come run out of sentences to hold.
    const full = current.length > 0 && size + lengths[index] / 2 > share
    const partsLeft = count - chunks.length
    const sentencesLeft = sentences.length - index
    if (full && partsLeft > 1 && sentencesLeft >= partsLeft - 1) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(sentence)
    size += lengths[index]
  })
  if (current.length > 0) chunks.push(current)
  return chunks
}
