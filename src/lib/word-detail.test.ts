import { describe, expect, it } from 'vitest'

import {
  modelText,
  parseWordDetail,
  readWordDetail,
  serializeWordDetail,
  wordDetailPrompt,
} from '#/lib/word-detail'

const CARD = {
  usage: { pattern: 'at risk of something', example: 'Half the coast is at risk of flooding.' },
  senses: [
    {
      pos: 'noun',
      definition: 'the possibility that something bad will happen',
      example: 'The risk of flooding has risen.',
    },
  ],
  collocations: ['take a risk', 'risk factor'],
  family: [{ word: 'risky', pos: 'adjective' }],
  zh: '风险；冒险',
}

describe('parseWordDetail', () => {
  it('reads a well-formed answer', () => {
    const detail = parseWordDetail('risk', JSON.stringify(CARD))

    expect(detail?.usage?.pattern).toBe('at risk of something')
    expect(detail?.senses).toHaveLength(1)
    expect(detail?.collocations).toEqual(['take a risk', 'risk factor'])
    expect(detail?.zh).toBe('风险；冒险')
  })

  it('digs the JSON out of whatever the model wrapped it in', () => {
    const detail = parseWordDetail(
      'risk',
      `Sure! Here is the card:\n\`\`\`json\n${JSON.stringify(CARD)}\n\`\`\``,
    )

    expect(detail?.senses[0].definition).toBe(
      'the possibility that something bad will happen',
    )
  })

  it('is nothing at all without a sense to show', () => {
    expect(parseWordDetail('risk', 'sorry, I cannot help with that')).toBeNull()
    expect(parseWordDetail('risk', JSON.stringify({ ...CARD, senses: [] }))).toBeNull()
    expect(parseWordDetail('risk', null)).toBeNull()
  })

  it('drops the inflections a model offers as family', () => {
    const detail = parseWordDetail(
      'risk',
      JSON.stringify({
        ...CARD,
        family: [
          { word: 'risky', pos: 'adjective' },
          // Grammar the learner already has, taking the room a real
          // derivative wants.
          { word: 'riskier', pos: 'adjective' },
          { word: 'riskiest', pos: 'adjective' },
          { word: 'risked', pos: 'verb' },
          { word: 'riskily', pos: 'adverb' },
        ],
      }),
    )

    expect(detail?.family.map((item) => item.word)).toEqual(['risky', 'riskily'])
  })

  it('drops a participle of the headword itself', () => {
    const detail = parseWordDetail(
      'thrive',
      JSON.stringify({
        ...CARD,
        family: [
          { word: 'thriving', pos: 'adjective' },
          { word: 'thrived', pos: 'verb' },
          { word: 'thriver', pos: 'noun' },
        ],
      }),
    )

    expect(detail?.family).toEqual([])
  })

  it('does not chip a phrase the pattern already shows', () => {
    const detail = parseWordDetail(
      'cycle',
      JSON.stringify({
        ...CARD,
        usage: { pattern: 'break the cycle', example: 'She broke the cycle.' },
        collocations: ['break the cycle', 'full cycle'],
      }),
    )

    expect(detail?.collocations).toEqual(['full cycle'])
  })

  it('drops single words offered as collocations', () => {
    const detail = parseWordDetail(
      'risk',
      JSON.stringify({ ...CARD, collocations: ['risk', 'take a risk', 'high'] }),
    )

    expect(detail?.collocations).toEqual(['take a risk'])
  })

  it('refuses a pattern written in grammar shorthand', () => {
    for (const pattern of [
      'risk + V-ing',
      'a firm ...',
      'comply with + noun',
      'tell sb about sth',
      'at risk of ___',
    ]) {
      const detail = parseWordDetail(
        'risk',
        JSON.stringify({ ...CARD, usage: { pattern, example: 'A sentence.' } }),
      )

      expect(detail?.usage, pattern).toBeNull()
      // The rest of the card is fine, and worth keeping.
      expect(detail?.collocations).toHaveLength(2)
    }
  })

  it('keeps the patterns that read like English', () => {
    for (const pattern of [
      'risk doing something',
      'a bleak outlook/future',
      'comply with something',
      'tell somebody about something',
    ]) {
      const detail = parseWordDetail(
        'risk',
        JSON.stringify({ ...CARD, usage: { pattern, example: 'A sentence.' } }),
      )

      expect(detail?.usage?.pattern, pattern).toBe(pattern)
    }
  })

  it('keeps a usage pattern only when its example came too', () => {
    const detail = parseWordDetail(
      'risk',
      JSON.stringify({ ...CARD, usage: { pattern: 'at risk of' } }),
    )

    expect(detail?.usage).toBeNull()
    expect(detail?.senses).toHaveLength(1)
  })

  it('caps what a card can hold, however much comes back', () => {
    const detail = parseWordDetail(
      'set',
      JSON.stringify({
        ...CARD,
        senses: Array.from({ length: 9 }, (_, i) => ({
          pos: 'verb',
          definition: `sense ${i}`,
          example: 'x',
        })),
        collocations: Array.from({ length: 12 }, (_, i) => `phrase ${i}`),
      }),
    )

    expect(detail?.senses).toHaveLength(3)
    expect(detail?.collocations).toHaveLength(6)
  })
})

describe('modelText', () => {
  it('reads both envelopes a Workers AI model replies in', () => {
    expect(modelText({ response: 'hello' })).toBe('hello')
    expect(modelText({ choices: [{ message: { content: 'hello' } }] })).toBe(
      'hello',
    )
    expect(modelText({ nothing: true })).toBe('')
  })
})

describe('readWordDetail', () => {
  it('round-trips a card', () => {
    const detail = parseWordDetail('risk', JSON.stringify(CARD))

    expect(readWordDetail(serializeWordDetail(detail!))).toEqual(detail)
  })

  it('shrugs off a column holding nonsense', () => {
    expect(readWordDetail(null)).toBeNull()
    expect(readWordDetail('')).toBeNull()
    expect(readWordDetail('{')).toBeNull()
    expect(readWordDetail('{"senses":"lots"}')).toBeNull()
  })
})

describe('wordDetailPrompt', () => {
  it('asks for the word at the level the learner set', () => {
    const prompt = wordDetailPrompt('bleak', 'B2')

    expect(prompt).toContain('card for "bleak"')
    expect(prompt).toContain('CEFR B2')
  })
})
