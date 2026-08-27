import { describe, expect, it } from 'vitest'

import {
  hasChinese,
  modelText,
  parseWordCard,
  readList,
  wordCardPrompt,
  type Sense,
} from '#/lib/word-card'

const CARD = {
  senses: [
    {
      pos: 'noun',
      definition: 'the possibility that something bad will happen',
      example: 'The risk of flooding has risen.',
      zh: '风险；危险',
    },
  ],
  collocations: ['take a risk', 'risk factor'],
  family: [{ word: 'risky', pos: 'adjective' }],
}

describe('parseWordCard', () => {
  it('reads a well-formed answer', () => {
    const card = parseWordCard('risk', JSON.stringify(CARD))

    expect(card?.senses).toHaveLength(1)
    expect(card?.collocations).toEqual(['take a risk', 'risk factor'])
    expect(card?.senses[0].zh).toBe('风险；危险')
  })

  it('gives a sense its example as a list, ready for a second', () => {
    const card = parseWordCard('risk', JSON.stringify(CARD))

    expect(card?.senses[0].examples).toEqual(['The risk of flooding has risen.'])
  })

  it('digs the JSON out of whatever the model wrapped it in', () => {
    const card = parseWordCard(
      'risk',
      `Sure! Here is the card:\n\`\`\`json\n${JSON.stringify(CARD)}\n\`\`\``,
    )

    expect(card?.senses[0].definition).toBe(
      'the possibility that something bad will happen',
    )
  })

  it('is nothing at all without a sense to show', () => {
    const empty = JSON.stringify({ ...CARD, senses: [] })
    expect(parseWordCard('risk', 'sorry, I cannot help with that')).toBeNull()
    expect(parseWordCard('risk', empty)).toBeNull()
    expect(parseWordCard('risk', null)).toBeNull()
  })

  it('drops the inflections a model offers as family', () => {
    const card = parseWordCard(
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

    expect(card?.family.map((item) => item.word)).toEqual(['risky', 'riskily'])
  })

  it('drops a participle of the headword itself', () => {
    const card = parseWordCard(
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

    expect(card?.family).toEqual([])
  })

  it('drops single words offered as collocations', () => {
    const card = parseWordCard(
      'risk',
      JSON.stringify({ ...CARD, collocations: ['risk', 'take a risk', 'high'] }),
    )

    expect(card?.collocations).toEqual(['take a risk'])
  })

  it('caps what a card can hold, however much comes back', () => {
    const card = parseWordCard(
      'set',
      JSON.stringify({
        ...CARD,
        senses: Array.from({ length: 9 }, (_, i) => ({
          pos: 'verb',
          definition: `sense ${i}`,
          example: 'x',
          zh: '义项',
        })),
        collocations: Array.from({ length: 12 }, (_, i) => `phrase ${i}`),
      }),
    )

    expect(card?.senses).toHaveLength(3)
    expect(card?.collocations).toHaveLength(6)
  })
})

describe('the Chinese on a sense', () => {
  function zhOf(zh: string) {
    return parseWordCard(
      'risk',
      JSON.stringify({ ...CARD, senses: [{ ...CARD.senses[0], zh }] }),
    )?.senses[0].zh
  }

  it('keeps the word itself in Chinese', () => {
    expect(zhOf('风险；危险')).toBe('风险；危险')
    expect(zhOf('使…冒风险')).toBe('使…冒风险')
  })

  it('throws out an English answer in the Chinese slot', () => {
    expect(zhOf('a chance of harm')).toBeNull()
  })

  it('throws out an explanation given where the word was asked for', () => {
    // What is wanted opposite "optimistic" is 乐观的. A model that answers
    // with the definition in Chinese instead gives the learner something to
    // read rather than something to know, and runs long doing it.
    expect(
      zhOf('指对未来或情况持有积极的期待，相信事情会朝好的方向发展'),
    ).toBeNull()
  })

  it('throws out a translated example sentence', () => {
    // Asked for the definition, the model translates the example instead often
    // enough to be worth catching, and always ends it like a sentence.
    expect(zhOf('她决定冒险搬到一座新城市。')).toBeNull()
    expect(zhOf('The risk of flooding has risen.')).toBeNull()
  })
})

describe('a sense answered in Chinese', () => {
  it('is dropped, so no card ever defines a word in Chinese', () => {
    const card = parseWordCard(
      'recall',
      JSON.stringify({
        ...CARD,
        senses: [
          { pos: 'verb', definition: '把记忆带回脑中', zh: '把记忆带回脑中' },
          { ...CARD.senses[0] },
        ],
      }),
    )
    expect(card?.senses).toHaveLength(1)
    expect(card?.senses[0].definition).toBe(CARD.senses[0].definition)
  })

  it('takes the whole card with it when no sense is left in English', () => {
    const card = parseWordCard(
      'recall',
      JSON.stringify({
        ...CARD,
        senses: [{ pos: 'verb', definition: '把记忆带回脑中', zh: '想起' }],
      }),
    )
    expect(card).toBeNull()
  })

  it('drops an example written in Chinese but keeps the sense', () => {
    const card = parseWordCard(
      'risk',
      JSON.stringify({
        ...CARD,
        senses: [{ ...CARD.senses[0], example: '她冒了很大的风险。' }],
      }),
    )
    expect(card?.senses[0].examples).toEqual([])
    expect(card?.senses[0].definition).toBe(CARD.senses[0].definition)
  })
})

describe('hasChinese', () => {
  it('is true only when some sense has a translation to show', () => {
    const card = parseWordCard('risk', JSON.stringify(CARD))
    expect(hasChinese(card!.senses)).toBe(true)

    const bare = parseWordCard(
      'risk',
      JSON.stringify({
        ...CARD,
        senses: [{ pos: 'noun', definition: 'a chance of harm' }],
      }),
    )
    expect(hasChinese(bare!.senses)).toBe(false)
    expect(hasChinese([])).toBe(false)
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

describe('readList', () => {
  it('round-trips the senses column', () => {
    const card = parseWordCard('risk', JSON.stringify(CARD))

    expect(readList<Sense>(JSON.stringify(card!.senses))).toEqual(card!.senses)
  })

  it('shrugs off a column holding nonsense', () => {
    expect(readList(null)).toEqual([])
    expect(readList('')).toEqual([])
    expect(readList('{')).toEqual([])
    expect(readList('{"senses":"lots"}')).toEqual([])
  })
})

describe('wordCardPrompt', () => {
  it('asks for the word at the level the learner set', () => {
    const prompt = wordCardPrompt('bleak', 'B2')

    expect(prompt).toContain('card for "bleak"')
    expect(prompt).toContain('CEFR B2')
  })
})
