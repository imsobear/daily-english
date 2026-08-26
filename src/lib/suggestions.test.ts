import { describe, expect, it } from 'vitest'

import { pickArticleWords } from '#/lib/suggestions'

const explained = (...phrases: string[]) =>
  phrases.map((phrase) => ({ phrase, meaning: `what ${phrase} means` }))

describe('pickArticleWords', () => {
  it('keeps the explained words the learner does not have', () => {
    const picks = pickArticleWords({
      explanations: explained('deadline', 'shift', 'commute'),
      targets: ['shift'],
      owned: ['commute'],
    })

    expect(picks).toEqual([
      { headword: 'deadline', meaning: 'what deadline means' },
    ])
  })

  it('matches regardless of case or padding', () => {
    const picks = pickArticleWords({
      explanations: explained('  Deadline '),
      targets: ['DEADLINE'],
      owned: [],
    })

    expect(picks).toEqual([])
  })

  it('treats a British spelling as the word the learner already keeps', () => {
    const picks = pickArticleWords({
      explanations: explained('realise', 'organisation'),
      targets: [],
      owned: ['realize', 'organization'],
    })

    expect(picks).toEqual([])
  })

  it('leaves out phrases and very short words', () => {
    const picks = pickArticleWords({
      explanations: explained('in charge of', 'up', 'budget'),
      targets: [],
      owned: [],
    })

    expect(picks.map((item) => item.headword)).toEqual(['budget'])
  })

  it('drops a word explained twice', () => {
    const picks = pickArticleWords({
      explanations: explained('budget', 'Budget'),
      targets: [],
      owned: [],
    })

    expect(picks).toHaveLength(1)
  })

  it('stops at the limit', () => {
    const picks = pickArticleWords({
      explanations: explained('one', 'two', 'three', 'four', 'five'),
      targets: [],
      owned: [],
      limit: 3,
    })

    expect(picks.map((item) => item.headword)).toEqual(['one', 'two', 'three'])
  })
})
