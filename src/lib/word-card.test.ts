import { describe, expect, it } from 'vitest'

import {
  hasChinese,
  modelText,
  parseWordCard,
  readList,
  wordCardPrompt,
  type CardSubject,
  type Sense,
  type WordCard,
} from '#/lib/word-card'

const CARD = {
  senses: [
    {
      pos: 'noun',
      definition: 'the possibility that something bad will happen',
      zh: '风险；危险',
      examples: [
        'There is a real risk of flooding this spring.',
        'She took the risk and moved to a new city.',
      ],
    },
  ],
  collocations: ['take a risk', 'risk factor'],
  family: [{ word: 'risky', pos: 'adjective' }],
}

/** The card, for the tests that do not care what was thrown away. */
function read(headword: string, body: unknown): WordCard | null {
  return parseWordCard(headword, body)?.card ?? null
}

function complaintsFor(headword: string, body: unknown) {
  return parseWordCard(headword, body)?.complaints ?? []
}

describe('parseWordCard', () => {
  it('reads a well-formed answer', () => {
    const card = read('risk', JSON.stringify(CARD))

    expect(card?.senses).toHaveLength(1)
    expect(card?.collocations).toEqual(['take a risk', 'risk factor'])
    expect(card?.senses[0].zh).toBe('风险；危险')
    expect(complaintsFor('risk', JSON.stringify(CARD))).toEqual([])
  })

  it('keeps both examples a sense comes with', () => {
    const card = read('risk', JSON.stringify(CARD))

    expect(card?.senses[0].examples).toEqual([
      'There is a real risk of flooding this spring.',
      'She took the risk and moved to a new city.',
    ])
  })

  it('still reads the single example an older answer gives', () => {
    const card = read(
      'risk',
      JSON.stringify({
        ...CARD,
        senses: [
          {
            pos: 'noun',
            definition: 'the possibility that something bad will happen',
            zh: '风险',
            example: 'There is a risk of rain.',
          },
        ],
      }),
    )

    expect(card?.senses[0].examples).toEqual(['There is a risk of rain.'])
  })

  it('digs the JSON out of whatever the model wrapped it in', () => {
    const card = read(
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
    const card = read(
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
    const card = read(
      'thrive',
      JSON.stringify({
        ...CARD,
        family: [
          { word: 'thriving', pos: 'adjective' },
          { word: 'thrived', pos: 'verb' },
        ],
      }),
    )

    expect(card?.family).toEqual([])
  })

  it('keeps the noun in -er, which is a word rather than an ending', () => {
    const card = read(
      'clean',
      JSON.stringify({
        ...CARD,
        family: [
          { word: 'cleaner', pos: 'noun' },
          // The same six letters as an adjective are the comparative, and
          // teach nothing.
          { word: 'cleaner', pos: 'adjective' },
        ],
      }),
    )

    expect(card?.family).toEqual([{ word: 'cleaner', pos: 'noun' }])
  })

  it('knows an irregular past tense is the same word', () => {
    const card = read(
      'write',
      JSON.stringify({
        ...CARD,
        family: [
          { word: 'wrote', pos: 'verb' },
          { word: 'written', pos: 'adjective' },
          { word: 'writer', pos: 'noun' },
        ],
      }),
    )

    expect(card?.family.map((item) => item.word)).toEqual(['writer'])
  })

  it('caps what a card can hold, however much comes back', () => {
    const card = read(
      'set',
      JSON.stringify({
        ...CARD,
        senses: Array.from({ length: 9 }, (_, i) => ({
          pos: 'verb',
          definition: `meaning number ${i}`,
          zh: `义项${i}`,
          examples: ['She set the table.'],
        })),
        collocations: Array.from({ length: 12 }, (_, i) => `set phrase ${i}`),
      }),
    )

    expect(card?.senses).toHaveLength(3)
    expect(card?.collocations).toHaveLength(6)
  })
})

describe('an example that does not show the word', () => {
  function examplesFor(headword: string, ...examples: string[]) {
    return read(
      headword,
      JSON.stringify({
        ...CARD,
        senses: [{ ...CARD.senses[0], examples }],
      }),
    )?.senses[0].examples
  }

  it('goes, and the one that does show it stays', () => {
    // A real card for "eliminate" was illustrated with a sentence about an
    // elimination round: a true sentence about a different word.
    expect(
      examplesFor(
        'eliminate',
        'The elimination round starts on Monday.',
        'They eliminated the last of the paperwork.',
      ),
    ).toEqual(['They eliminated the last of the paperwork.'])
  })

  it('counts an irregular form as the word', () => {
    expect(examplesFor('swear', 'He swore he had locked the door.')).toEqual([
      'He swore he had locked the door.',
    ])
    expect(examplesFor('child', 'Both children walked to school.')).toEqual([
      'Both children walked to school.',
    ])
  })

  it('counts the verb of a phrasal headword', () => {
    expect(
      examplesFor('point out', 'She pointed the mistake out to me.'),
    ).toEqual(['She pointed the mistake out to me.'])
  })

  it('says so, so the second attempt can do better', () => {
    const complaints = complaintsFor(
      'eliminate',
      JSON.stringify({
        ...CARD,
        senses: [
          { ...CARD.senses[0], examples: ['The elimination round is next.'] },
        ],
      }),
    )

    expect(complaints).toContain(
      '"The elimination round is next." does not use "eliminate" itself',
    )
    expect(complaints).toContain('no usable example for one sense of "eliminate"')
  })
})

describe('two senses that are one sense', () => {
  it('become one, because a card has room for three meanings', () => {
    const card = read(
      'consolidate',
      JSON.stringify({
        ...CARD,
        senses: [
          {
            pos: 'verb',
            definition: 'to combine several things into one',
            zh: '合并',
            examples: ['They consolidated the two teams.'],
          },
          {
            pos: 'verb',
            definition: 'to bring several parts together into a single whole',
            zh: '合并',
            examples: ['The banks consolidated their branches.'],
          },
        ],
      }),
    )

    expect(card?.senses).toHaveLength(1)
    expect(card?.senses[0].examples).toEqual(['They consolidated the two teams.'])
  })
})

describe('the Chinese on a sense', () => {
  function zhOf(zh: string, pos = 'noun') {
    return read(
      'risk',
      JSON.stringify({ ...CARD, senses: [{ ...CARD.senses[0], pos, zh }] }),
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

  it('throws out the adjective where the adverb was asked for', () => {
    // "personally" came back as 个人的, which is "personal". An adverb glossed
    // as an adjective teaches the wrong word in the only place a learner is
    // certain to look.
    expect(zhOf('个人的', 'adverb')).toBeNull()
    expect(zhOf('就我个人而言', 'adverb')).toBe('就我个人而言')
  })
})

describe('a definition that leans on the word it defines', () => {
  it('is kept, but complained about', () => {
    const body = JSON.stringify({
      ...CARD,
      senses: [
        {
          pos: 'noun',
          definition: 'a fever is when your temperature is too high',
          zh: '发烧',
          examples: ['She stayed home with a fever.'],
        },
      ],
    })

    expect(read('fever', body)?.senses).toHaveLength(1)
    expect(complaintsFor('fever', body)).toContain(
      'the definition of "fever" uses the word itself',
    )
  })
})

describe('collocations', () => {
  it('drops single words offered as collocations', () => {
    const card = read(
      'risk',
      JSON.stringify({ ...CARD, collocations: ['risk', 'take a risk', 'high'] }),
    )

    expect(card?.collocations).toEqual(['take a risk'])
  })

  it('drops a phrase the word is not even in', () => {
    const card = read(
      'risk',
      JSON.stringify({ ...CARD, collocations: ['a great deal', 'at risk of'] }),
    )

    expect(card?.collocations).toEqual(['at risk of'])
  })

  it('drops a fragment caught mid-sentence', () => {
    // "rid the" is what came back for "rid". The phrase worth teaching, "get
    // rid of", was not in the list at all.
    const body = JSON.stringify({
      ...CARD,
      collocations: ['rid the', 'get rid of'],
    })

    expect(read('rid', body)?.collocations).toEqual(['get rid of'])
    expect(complaintsFor('rid', body)).toContain(
      '"rid the" is a fragment, not a phrase',
    )
  })
})

describe('a sense answered in Chinese', () => {
  it('is dropped, so no card ever defines a word in Chinese', () => {
    const card = read(
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
    const card = read(
      'recall',
      JSON.stringify({
        ...CARD,
        senses: [{ pos: 'verb', definition: '把记忆带回脑中', zh: '想起' }],
      }),
    )
    expect(card).toBeNull()
  })

  it('drops an example written in Chinese but keeps the sense', () => {
    const card = read(
      'risk',
      JSON.stringify({
        ...CARD,
        senses: [{ ...CARD.senses[0], examples: ['她冒了很大的风险。'] }],
      }),
    )
    expect(card?.senses[0].examples).toEqual([])
    expect(card?.senses[0].definition).toBe(CARD.senses[0].definition)
  })
})

describe('hasChinese', () => {
  it('is true only when some sense has a translation to show', () => {
    const card = read('risk', JSON.stringify(CARD))
    expect(hasChinese(card!.senses)).toBe(true)

    const bare = read(
      'risk',
      JSON.stringify({
        ...CARD,
        senses: [{ pos: 'noun', definition: 'a chance of harm' }],
      }),
    )
    expect(hasChinese(bare!.senses)).toBe(false)
    expect(hasChinese([])).toBe(false)
  })

  it('is a complaint when no sense has one', () => {
    const complaints = complaintsFor(
      'risk',
      JSON.stringify({
        ...CARD,
        senses: [{ pos: 'noun', definition: 'a chance of harm' }],
      }),
    )

    expect(complaints).toContain('no sense came back with its Chinese')
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
    const card = read('risk', JSON.stringify(CARD))

    expect(readList<Sense>(JSON.stringify(card!.senses))).toEqual(card!.senses)
  })

  it('shrugs off a column holding nonsense', () => {
    expect(readList(null)).toEqual([])
    expect(readList('')).toEqual([])
    expect(readList('{')).toEqual([])
    expect(readList('{"senses":"lots"}')).toEqual([])
  })
})

describe('parseWordCard, for a word that is only a form of another', () => {
  const dancing = {
    senses: [
      {
        pos: 'noun',
        definition: 'the activity of moving your body to music',
        zh: '舞蹈',
        examples: ['She loves dancing.', 'Dancing keeps him fit.'],
      },
      {
        pos: 'verb',
        definition: 'to move your body to music',
        zh: '跳舞',
        examples: ['They were dancing all night.', 'He is dancing badly.'],
      },
    ],
    collocations: ['go dancing'],
    family: [],
  }

  const lock = { pos: 'n', formOf: 'dance' } as const

  it('throws away the sense that is really the other word', () => {
    const read = parseWordCard('dancing', JSON.stringify(dancing), lock)

    expect(read?.card.senses.map((sense) => sense.pos)).toEqual(['noun'])
    expect(read?.complaints).toEqual([
      '"dancing" as a verb is really "dance", which is not this card',
    ])
  })

  it('leaves a word with two jobs alone', () => {
    const read = parseWordCard('dancing', JSON.stringify(dancing), {
      pos: 'n',
      formOf: null,
    })

    expect(read?.card.senses).toHaveLength(2)
    expect(read?.complaints).toEqual([])
  })
})

describe('wordCardPrompt', () => {
  const subject: CardSubject = {
    headword: 'bleak',
    level: 'B2',
    dictionary: [],
    pos: null,
    formOf: null,
  }

  it('asks for the word at the level the learner set', () => {
    const prompt = wordCardPrompt(subject)

    expect(prompt).toContain('card for "bleak"')
    expect(prompt).toContain('CEFR B2')
  })

  it('hands over what the dictionary already says', () => {
    const prompt = wordCardPrompt({
      ...subject,
      dictionary: [
        {
          pos: 'adjective',
          definition: 'without hope or encouragement',
          zh: null,
          examples: [],
        },
      ],
    })

    expect(prompt).toContain('adjective — without hope or encouragement')
    expect(prompt).toContain('Work from that list')
  })

  it('says so when the dictionary has nothing, rather than inventing a list', () => {
    expect(wordCardPrompt(subject)).toContain('nothing for this word')
  })

  it('pins a word that is only a form of another to its own part of speech', () => {
    // Without this, the card for "dancing" describes the verb "dance", which
    // the dictionary files under the same spelling.
    const prompt = wordCardPrompt({
      ...subject,
      headword: 'dancing',
      pos: 'n',
      formOf: 'dance',
    })

    expect(prompt).toContain('"dancing" as a noun and nothing else')
    expect(prompt).toContain('belongs to "dance"')
  })

  it('lets a word with two jobs keep both, leading with the one taught', () => {
    // "squash" is carried as a noun and is also the everyday verb; walling it
    // in cost the card the crushing.
    const prompt = wordCardPrompt({ ...subject, headword: 'squash', pos: 'n' })

    expect(prompt).toContain('meets "squash" as a noun')
    expect(prompt).not.toContain('nothing else')
  })

  it('tells a second attempt what the first one got wrong', () => {
    const prompt = wordCardPrompt(subject, ['two senses both mean "合并"'])

    expect(prompt).toContain('thrown away in part')
    expect(prompt).toContain('two senses both mean "合并"')
  })
})
