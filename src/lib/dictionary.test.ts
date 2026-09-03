import { describe, expect, it } from 'vitest'

import { americanIpa, sensesFrom, type DictionaryApiEntry } from './dictionary'

describe('americanIpa', () => {
  it('prefers the variant paired with US audio over the RP headline', () => {
    expect(
      americanIpa({
        phonetic: '/dɪsˈkʊvə/',
        phonetics: [
          { text: '/dɪsˈkʊvə/', audio: '' },
          {
            text: '/dɪsˈkʌvɚ/',
            audio: 'https://example.test/discover-us.mp3',
          },
        ],
      }),
    ).toBe('/dɪsˈkʌvɚ/')
  })

  it('ignores non-US audio variants', () => {
    expect(
      americanIpa({
        phonetics: [
          { text: '/ˈɪnsɛntɪv/', audio: 'https://example.test/incentive-uk.mp3' },
          { text: '/ˈkɹuːʃəl/', audio: 'https://example.test/crucial-au.mp3' },
        ],
      }),
    ).toBe('/ˈɪnsɛntɪv/')
  })

  it('falls back to the headline transcription, then to any variant', () => {
    expect(americanIpa({ phonetic: '/ˈpatən/' })).toBe('/ˈpatən/')
    expect(americanIpa({ phonetics: [{ text: '/rɪsk/' }] })).toBe('/rɪsk/')
    expect(americanIpa({})).toBeNull()
  })
})

describe('sensesFrom', () => {
  /** How "squash" arrives: one entry per etymology, the verb inside the first. */
  const squash: DictionaryApiEntry[] = [
    {
      word: 'squash',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            { definition: 'A sport played in a walled court.' },
            { definition: 'A soft drink made from a fruit concentrate.' },
            { definition: 'A place where people have limited space.' },
            { definition: 'A fourth reading nobody asked for.' },
          ],
        },
        {
          partOfSpeech: 'verb',
          definitions: [{ definition: 'To press into a flat mass; to crush.' }],
        },
      ],
    },
    {
      word: 'squash',
      meanings: [
        { partOfSpeech: 'noun', definitions: [{ definition: 'A gourd.' }] },
      ],
    },
  ]

  it('reads past the first entry, which is one etymology and not the word', () => {
    expect(sensesFrom(squash).map((sense) => sense.definition)).toContain(
      'A gourd.',
    )
  })

  it('keeps the verb, which is what a card built on three nouns was missing', () => {
    expect(sensesFrom(squash).filter((sense) => sense.pos === 'verb')).toEqual([
      {
        pos: 'verb',
        definition: 'To press into a flat mass; to crush.',
        zh: null,
        examples: [],
      },
    ])
  })

  it('takes a few from each part of speech rather than a few from the top', () => {
    expect(sensesFrom(squash)).toHaveLength(5)
  })

  it('drops the senses nobody meets', () => {
    expect(
      sensesFrom([
        {
          meanings: [
            {
              partOfSpeech: 'noun',
              definitions: [
                { definition: 'Disdain (archaic).' },
                { definition: 'What it means now.' },
              ],
            },
          ],
        },
      ]).map((sense) => sense.definition),
    ).toEqual(['What it means now.'])
  })
})
