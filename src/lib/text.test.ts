import { describe, expect, it } from 'vitest'

import {
  baseForm,
  baseFormCandidates,
  chunkSentences,
  findSentenceWith,
  stripPosTags,
} from '#/lib/text'

const sentences = [
  'Maya opened the notebook.',
  'She realized the week had cost her forty hours.',
  'The pattern repeated every month.',
]

describe('findSentenceWith', () => {
  it('finds the sentence that uses the word', () => {
    expect(findSentenceWith(sentences, 'pattern')).toBe(
      'The pattern repeated every month.',
    )
  })

  it('matches an inflected form', () => {
    expect(findSentenceWith(sentences, 'realize')).toBe(
      'She realized the week had cost her forty hours.',
    )
  })

  it('does not match a word inside a longer one', () => {
    expect(findSentenceWith(['She opened the notebook.'], 'note')).toBeNull()
  })

  it('returns null when the word is absent', () => {
    expect(findSentenceWith(sentences, 'commute')).toBeNull()
  })
})

describe('chunkSentences', () => {
  /** An article's worth of sentences, all the same length. */
  const article = (count: number, chars = 60) =>
    Array.from({ length: count }, () => 'x'.repeat(chars))

  it('splits an article into three parts', () => {
    expect(chunkSentences(article(18))).toHaveLength(3)
  })

  it('spreads the sentences evenly across them', () => {
    expect(chunkSentences(article(18)).map((part) => part.length)).toEqual([
      6, 6, 6,
    ])
  })

  it('keeps every sentence, in order', () => {
    const sentences = article(17).map((text, index) => `${index}${text}`)

    expect(chunkSentences(sentences).flat()).toEqual(sentences)
  })

  it('gives up parts rather than split a sentence', () => {
    expect(chunkSentences(['One.', 'Two.'])).toEqual([['One.'], ['Two.']])
  })

  it('leaves a single sentence whole', () => {
    expect(chunkSentences(['Only this.'])).toEqual([['Only this.']])
  })

  it('has nothing to say about an empty article', () => {
    expect(chunkSentences([])).toEqual([])
  })

  it('splits further when three parts would be too long to synthesise', () => {
    const parts = chunkSentences(article(40, 200))

    expect(parts.length).toBeGreaterThan(3)
    for (const part of parts) {
      expect(part.join(' ').length).toBeLessThanOrEqual(1400)
    }
  })
})

describe('baseForm', () => {
  const known = ['reveal', 'study', 'stop', 'use', 'watch', 'series']

  it('reads the article form back to the word that was saved', () => {
    expect(baseForm('revealed', known)).toBe('reveal')
    expect(baseForm('reveals', known)).toBe('reveal')
    expect(baseForm('revealing', known)).toBe('reveal')
  })

  it('handles the spelling changes that come with the ending', () => {
    expect(baseForm('studies', known)).toBe('study')
    expect(baseForm('studied', known)).toBe('study')
    expect(baseForm('stopped', known)).toBe('stop')
    expect(baseForm('using', known)).toBe('use')
    expect(baseForm('watches', known)).toBe('watch')
  })

  it('leaves a word that only looks inflected', () => {
    expect(baseForm('series', known)).toBe('series')
  })

  it('leaves a word no known form explains', () => {
    expect(baseForm('went', known)).toBe('went')
    expect(baseForm('bottleneck', known)).toBe('bottleneck')
  })

  it('proposes the plausible cuts, best first', () => {
    expect(baseFormCandidates('used')).toEqual(['use'])
    expect(baseFormCandidates('stopped')).toEqual(['stop', 'stopp', 'stoppe'])
  })
})

describe('stripPosTags', () => {
  it('removes a tag the writer copied out of the prompt', () => {
    expect(stripPosTags('The process [noun] often begins with a call.')).toBe(
      'The process often begins with a call.',
    )
  })

  it('leaves the punctuation that followed it', () => {
    expect(stripPosTags('She wanted to reveal [verb], and she did.')).toBe(
      'She wanted to reveal, and she did.',
    )
  })

  it('removes every tag in a paragraph, in either bracket', () => {
    expect(stripPosTags('A pattern [noun] can reveal (verb) a habit.')).toBe(
      'A pattern can reveal a habit.',
    )
  })

  it('leaves prose that merely mentions a word class', () => {
    expect(stripPosTags('The verb was hard to hear.')).toBe(
      'The verb was hard to hear.',
    )
  })
})
