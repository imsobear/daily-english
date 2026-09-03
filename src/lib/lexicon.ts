import { LEXICON } from '#/data/lexicon'
import type { PartOfSpeech } from '#/lib/vocabulary'

let index: Map<string, PartOfSpeech[]> | null = null

/**
 * What parts of speech a word can be, or nothing if it is not a word.
 *
 * Built on first use and kept, the same as the pool's index: it is read once
 * per word written, which is a few thousand times a night and never on a
 * request a learner is waiting on.
 */
export function partsOf(word: string): PartOfSpeech[] {
  if (!index) {
    index = new Map()
    for (const entry of LEXICON.split(',')) {
      const [headword, parts] = entry.split(':')
      if (headword && parts) {
        index.set(headword, parts.split('|') as PartOfSpeech[])
      }
    }
  }
  return index.get(word.toLowerCase()) ?? []
}
