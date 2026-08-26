import { describe, expect, it } from 'vitest'

import {
  afterClipEnds,
  clipUrls,
  currentUrl,
  skipTrack,
  tracksFrom,
} from '#/lib/playlist'

describe('clipUrls', () => {
  it('emits one url per stored chunk', () => {
    expect(
      clipUrls({
        id: 'art-1',
        audioKey: null,
        audioChunks: JSON.stringify([
          { key: 'a', from: 0, to: 2 },
          { key: 'b', from: 3, to: 5 },
        ]),
      }),
    ).toEqual(['/api/audio/art-1/0', '/api/audio/art-1/1'])
  })

  it('falls back to a single clip when only audioKey is set', () => {
    expect(
      clipUrls({ id: 'art-2', audioKey: 'legacy.mp3', audioChunks: '[]' }),
    ).toEqual(['/api/audio/art-2/0'])
  })

  it('is empty when the article has no speech', () => {
    expect(clipUrls({ id: 'art-3', audioKey: null, audioChunks: '[]' })).toEqual(
      [],
    )
  })
})

describe('tracksFrom', () => {
  it('drops lessons with no audio and keeps newest-first order', () => {
    expect(
      tracksFrom([
        { lessonId: 'new', title: 'Fresh', clips: ['/a'] },
        { lessonId: 'silent', title: 'Mute', clips: [] },
        { lessonId: 'old', title: 'Earlier', clips: ['/b', '/c'] },
      ]),
    ).toEqual([
      { lessonId: 'new', title: 'Fresh', clips: ['/a'] },
      { lessonId: 'old', title: 'Earlier', clips: ['/b', '/c'] },
    ])
  })
})

describe('playhead', () => {
  const tracks = tracksFrom([
    { lessonId: 'one', title: 'One', clips: ['/1a', '/1b'] },
    { lessonId: 'two', title: 'Two', clips: ['/2a'] },
  ])

  it('walks clips then the next article, then wraps', () => {
    expect(afterClipEnds(tracks, { track: 0, clip: 0 })).toEqual({
      track: 0,
      clip: 1,
    })
    expect(afterClipEnds(tracks, { track: 0, clip: 1 })).toEqual({
      track: 1,
      clip: 0,
    })
    expect(afterClipEnds(tracks, { track: 1, clip: 0 })).toEqual({
      track: 0,
      clip: 0,
    })
  })

  it('skips a whole article, wrapping at the ends', () => {
    expect(skipTrack(tracks, { track: 0, clip: 1 }, 1)).toEqual({
      track: 1,
      clip: 0,
    })
    expect(skipTrack(tracks, { track: 1, clip: 0 }, 1)).toEqual({
      track: 0,
      clip: 0,
    })
    expect(skipTrack(tracks, { track: 0, clip: 1 }, -1)).toEqual({
      track: 1,
      clip: 0,
    })
  })

  it('names the url the player should load', () => {
    expect(currentUrl(tracks, { track: 0, clip: 1 })).toBe('/1b')
    expect(currentUrl([], { track: 0, clip: 0 })).toBeNull()
  })
})
