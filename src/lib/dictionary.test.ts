import { describe, expect, it } from 'vitest'

import { americanIpa } from './dictionary'

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
