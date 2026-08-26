import { wordPattern } from '#/lib/text'

export type QuizEntry = {
  wordId: string | null
  headword: string
  definition: string | null
  /**
   * The dictionary's sentence for the word. Shown once an answer is in, in
   * preference to the article's own sentence: the article bent itself around
   * ten words at once, while this one was written to show this word alone.
   */
  example?: string | null
}

export type QuizQuestion = {
  wordId: string | null
  headword: string
  /** The definition to show, with the answer blanked out. */
  prompt: string
  /** The answer plus up to three decoys, in a stable order. */
  choices: string[]
  example: string | null
}

const CHOICE_COUNT = 4
const BLANK = '____'

/** FNV-1a. Any stable hash works; this one is short and has no dependencies. */
function hash32(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function orderBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => hash32(key(a)) - hash32(key(b)))
}

/** A repeatable shuffle source, for draws that must survive a reload. */
export function seededRandom(seed: string): () => number {
  let state = hash32(seed) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Blank out the answer where the definition happens to spell it, which glosses
 * such as "to manage a shop" often do. Also covers the plain -s/-ed/-ing forms,
 * since leaving those visible gives the answer away just as thoroughly.
 */
export function maskHeadword(definition: string, headword: string): string {
  if (!headword.trim()) return definition
  return definition.replace(wordPattern(headword, 'gi'), BLANK)
}

/**
 * Turn a lesson's target words into multiple-choice questions.
 *
 * Decoys come from the same lesson first, so every option is a word the
 * learner has just met and the choice tests meaning rather than familiarity.
 * A short lesson cannot fill four choices that way — two target words would
 * make a coin toss — so `spares` top it up with level-appropriate words from
 * elsewhere. Ordering is hashed from `seed` rather than random so a reload, a
 * re-render or a second visit shows the same quiz instead of silently
 * reshuffling mid-answer.
 */
export function buildQuiz(
  seed: string,
  entries: QuizEntry[],
  spares: string[] = [],
): QuizQuestion[] {
  const pool = [...new Set(entries.map((entry) => entry.headword))]
  const extras = [...new Set(spares)].filter((word) => !pool.includes(word))

  const questions = entries.flatMap((entry) => {
    const definition = entry.definition?.trim()
    if (!definition) return []

    const near = orderBy(
      pool.filter((word) => word !== entry.headword),
      (word) => `${seed}|decoy|${entry.headword}|${word}`,
    )
    const far = orderBy(
      extras,
      (word) => `${seed}|spare|${entry.headword}|${word}`,
    )
    const decoys = [...near, ...far].slice(0, CHOICE_COUNT - 1)

    return [
      {
        wordId: entry.wordId,
        headword: entry.headword,
        example: entry.example?.trim() || null,
        prompt: maskHeadword(definition, entry.headword),
        choices: orderBy(
          [entry.headword, ...decoys],
          (word) => `${seed}|choice|${entry.headword}|${word}`,
        ),
      },
    ]
  })

  return orderBy(questions, (question) => `${seed}|ask|${question.headword}`)
}
