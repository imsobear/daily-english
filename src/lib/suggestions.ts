import { normalizeHeadword } from '#/lib/dictionary'

export type ArticleSuggestion = {
  headword: string
  /** The gloss the writer already produced, so no second lookup is needed. */
  meaning: string
}

/**
 * Words to offer at the end of a lesson, taken from the article itself.
 *
 * Every article ships with a handful of explained words, most of which are the
 * lesson's own targets. Whatever is left is vocabulary the learner has just met
 * in context but does not own yet — a better prompt than a fresh pick from the
 * catalog, and free, since the writer produced the glosses anyway.
 *
 * Multi-word phrases are left out: they read well in an explanation list but
 * make poor list entries, since a dictionary lookup cannot resolve them.
 */
/**
 * A spelling-insensitive key, so an article that slips into British spelling
 * cannot offer "realise" to a learner who already keeps "realize".
 */
function key(raw: string) {
  return normalizeHeadword(raw)
    .replace(/isation$/, 'ization')
    .replace(/yse$/, 'yze')
    .replace(/ise$/, 'ize')
}

export function pickArticleWords(input: {
  explanations: Array<{ phrase: string; meaning: string }>
  targets: Iterable<string>
  owned: Iterable<string>
  limit?: number
}): ArticleSuggestion[] {
  const skip = new Set<string>()
  for (const value of input.targets) skip.add(key(value))
  for (const value of input.owned) skip.add(key(value))

  const picks: ArticleSuggestion[] = []
  for (const item of input.explanations) {
    const headword = normalizeHeadword(item.phrase)
    if (headword.includes(' ') || headword.length < 3) continue
    if (skip.has(key(headword))) continue
    skip.add(key(headword))
    picks.push({ headword, meaning: item.meaning })
    if (picks.length >= (input.limit ?? 4)) break
  }
  return picks
}
