import { describe, expect, it } from 'vitest'

import {
  hasChinese,
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
      zh: '风险，可能发生的坏事',
    },
  ],
  collocations: ['take a risk', 'risk factor'],
  family: [{ word: 'risky', pos: 'adjective' }],
}

describe('parseWordDetail', () => {
  it('reads a well-formed answer', () => {
    const detail = parseWordDetail('risk', JSON.stringify(CARD))

    expect(detail?.usage?.pattern).toBe('at risk of something')
    expect(detail?.senses).toHaveLength(1)
    expect(detail?.collocations).toEqual(['take a risk', 'risk factor'])
    expect(detail?.senses[0].zh).toBe('风险，可能发生的坏事')
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
          zh: '义项',
        })),
        collocations: Array.from({ length: 12 }, (_, i) => `phrase ${i}`),
      }),
    )

    expect(detail?.senses).toHaveLength(3)
    expect(detail?.collocations).toHaveLength(6)
  })
})

describe('the Chinese on a sense', () => {
  function zhOf(zh: string) {
    return parseWordDetail(
      'risk',
      JSON.stringify({ ...CARD, senses: [{ ...CARD.senses[0], zh }] }),
    )?.senses[0].zh
  }

  it('keeps a gloss', () => {
    expect(zhOf('风险，可能发生的坏事')).toBe('风险，可能发生的坏事')
    expect(zhOf('使…面临危险或损失')).toBe('使…面临危险或损失')
  })

  it('throws out an English answer in the Chinese slot', () => {
    expect(zhOf('a chance of harm')).toBeNull()
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
    const detail = parseWordDetail(
      'recall',
      JSON.stringify({
        ...CARD,
        senses: [
          { pos: 'verb', definition: '把记忆带回脑中', zh: '把记忆带回脑中' },
          { ...CARD.senses[0] },
        ],
      }),
    )
    expect(detail?.senses).toHaveLength(1)
    expect(detail?.senses[0].definition).toBe(CARD.senses[0].definition)
  })

  it('takes the whole card with it when no sense is left in English', () => {
    const detail = parseWordDetail(
      'recall',
      JSON.stringify({
        ...CARD,
        senses: [{ pos: 'verb', definition: '把记忆带回脑中', zh: '想起' }],
      }),
    )
    expect(detail).toBeNull()
  })

  it('drops an example written in Chinese but keeps the sense', () => {
    const detail = parseWordDetail(
      'risk',
      JSON.stringify({
        ...CARD,
        senses: [{ ...CARD.senses[0], example: '她冒了很大的风险。' }],
      }),
    )
    expect(detail?.senses[0].example).toBeNull()
    expect(detail?.senses[0].definition).toBe(CARD.senses[0].definition)
  })
})

describe('hasChinese', () => {
  it('is true only when some sense has a translation to show', () => {
    const detail = parseWordDetail('risk', JSON.stringify(CARD))
    expect(hasChinese(detail)).toBe(true)

    const bare = parseWordDetail(
      'risk',
      JSON.stringify({
        ...CARD,
        senses: [{ pos: 'noun', definition: 'a chance of harm' }],
      }),
    )
    expect(hasChinese(bare)).toBe(false)
    expect(hasChinese(null)).toBe(false)
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
