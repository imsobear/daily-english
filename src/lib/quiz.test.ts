import { describe, expect, it } from 'vitest'

import { buildQuiz, maskHeadword, type QuizEntry } from '#/lib/quiz'

function entries(count: number): QuizEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    wordId: `id-${index}`,
    headword: `word${index}`,
    definition: `meaning number ${index}`,
  }))
}

describe('maskHeadword', () => {
  it('blanks the answer out of its own definition', () => {
    expect(maskHeadword('to manage a shop', 'manage')).toBe('to ____ a shop')
  })

  it('blanks common inflections too', () => {
    expect(maskHeadword('someone who manages a team', 'manage')).toBe(
      'someone who ____ a team',
    )
  })

  it('ignores the word inside a longer one', () => {
    expect(maskHeadword('a management style', 'manage')).toBe(
      'a management style',
    )
  })

  it('leaves an unrelated definition alone', () => {
    expect(maskHeadword('to run a shop', 'manage')).toBe('to run a shop')
  })
})

describe('buildQuiz', () => {
  it('asks one question per word that has a definition', () => {
    const quiz = buildQuiz('seed', entries(10))
    expect(quiz).toHaveLength(10)
    expect(new Set(quiz.map((q) => q.headword)).size).toBe(10)
  })

  it('skips words with no definition', () => {
    const quiz = buildQuiz('seed', [
      ...entries(4),
      { wordId: 'x', headword: 'blank', definition: null },
      { wordId: 'y', headword: 'empty', definition: '   ' },
    ])
    expect(quiz.map((q) => q.headword)).not.toContain('blank')
    expect(quiz.map((q) => q.headword)).not.toContain('empty')
  })

  it('offers four distinct choices that include the answer', () => {
    for (const question of buildQuiz('seed', entries(10))) {
      expect(question.choices).toHaveLength(4)
      expect(new Set(question.choices).size).toBe(4)
      expect(question.choices).toContain(question.headword)
    }
  })

  it('draws decoys only from the lesson', () => {
    const lesson = entries(6)
    const pool = new Set(lesson.map((entry) => entry.headword))
    for (const question of buildQuiz('seed', lesson)) {
      for (const choice of question.choices) expect(pool.has(choice)).toBe(true)
    }
  })

  it('copes with a lesson smaller than one full set of choices', () => {
    const quiz = buildQuiz('seed', entries(2))
    expect(quiz).toHaveLength(2)
    expect(quiz[0].choices).toHaveLength(2)
  })

  it('fills a short lesson out with spare words', () => {
    const spares = ['alpha', 'beta', 'gamma', 'delta']
    for (const question of buildQuiz('seed', entries(2), spares)) {
      expect(question.choices).toHaveLength(4)
      expect(question.choices).toContain(question.headword)
    }
  })

  it('prefers the words of the lesson itself to the spares', () => {
    const lesson = entries(4)
    for (const question of buildQuiz('seed', lesson, ['alpha', 'beta'])) {
      expect(question.choices).not.toContain('alpha')
      expect(question.choices).not.toContain('beta')
    }
  })

  it('ignores a spare that is already an answer', () => {
    for (const question of buildQuiz('seed', entries(2), ['word0', 'alpha'])) {
      expect(new Set(question.choices).size).toBe(question.choices.length)
    }
  })

  it('is stable for a given seed', () => {
    const lesson = entries(10)
    expect(buildQuiz('seed', lesson)).toEqual(buildQuiz('seed', lesson))
  })

  it('varies between lessons', () => {
    const lesson = entries(10)
    const a = buildQuiz('lesson-a', lesson).map((q) => q.headword)
    const b = buildQuiz('lesson-b', lesson).map((q) => q.headword)
    expect(a).not.toEqual(b)
  })

  it('does not simply echo the source order', () => {
    const lesson = entries(10)
    const asked = buildQuiz('seed', lesson).map((q) => q.headword)
    expect(asked).not.toEqual(lesson.map((entry) => entry.headword))
  })
})
