/**
 * Queue for looping lesson audio — the car player, not the four-step lesson.
 *
 * Articles are stored as one or more clips. Playback walks those clips, then
 * the next article, and wraps so a commute never hits a stop.
 */

export type PlaylistTrack = {
  lessonId: string
  title: string
  clips: string[]
}

export type Playhead = {
  track: number
  clip: number
}

type ArticleAudio = {
  id: string
  audioKey: string | null
  audioChunks: string | null
}

function parseChunks(raw: string | null): Array<{ key: string }> {
  try {
    const value = JSON.parse(raw ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is { key: string } =>
        Boolean(item) && typeof (item as { key: string }).key === 'string',
    )
  } catch {
    return []
  }
}

/** Clip URLs for one article, in play order. Empty when there is no speech. */
export function clipUrls(article: ArticleAudio): string[] {
  const chunks = parseChunks(article.audioChunks)
  if (chunks.length > 0) {
    return chunks.map((_, index) => `/api/audio/${article.id}/${index}`)
  }
  if (article.audioKey) return [`/api/audio/${article.id}/0`]
  return []
}

export function tracksFrom(
  lessons: Array<{
    lessonId: string
    title: string | null
    clips: string[]
  }>,
): PlaylistTrack[] {
  return lessons
    .filter((item) => item.clips.length > 0)
    .map((item) => ({
      lessonId: item.lessonId,
      title: item.title?.trim() || 'Untitled',
      clips: item.clips,
    }))
}

function wrap(index: number, length: number, delta: number) {
  if (length <= 0) return 0
  return (((index + delta) % length) + length) % length
}

export function currentUrl(
  tracks: PlaylistTrack[],
  head: Playhead,
): string | null {
  return tracks[head.track]?.clips[head.clip] ?? null
}

/** Next clip, or the start of the next article, wrapping the list. */
export function afterClipEnds(
  tracks: PlaylistTrack[],
  head: Playhead,
): Playhead {
  const track = tracks[head.track]
  if (!track) return { track: 0, clip: 0 }
  if (head.clip + 1 < track.clips.length) {
    return { track: head.track, clip: head.clip + 1 }
  }
  return { track: wrap(head.track, tracks.length, 1), clip: 0 }
}

/** Skip a whole article. Always starts that article from its first clip. */
export function skipTrack(
  tracks: PlaylistTrack[],
  head: Playhead,
  delta: number,
): Playhead {
  return { track: wrap(head.track, tracks.length, delta), clip: 0 }
}
