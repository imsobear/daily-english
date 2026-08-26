import { and, eq } from 'drizzle-orm'

import { getAudioBucket, getDb } from '#/db'
import { lessonArticles, lessons } from '#/db/schema'
import { audioKeysOf, type AudioChunk } from '#/lib/generate-lesson'
import { currentUser } from '#/lib/session'

function parseChunks(raw: string | null): AudioChunk[] {
  try {
    const value = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(value) ? (value as AudioChunk[]) : []
  } catch {
    return []
  }
}

/** Translate a `Range: bytes=a-b` header into an R2 range request. */
function parseRange(header: string | null, size: number) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number
  if (rawStart === '') {
    // Suffix form: the last N bytes.
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= size) return { unsatisfiable: true as const }
  return { start, end: Math.min(end, size - 1) }
}

/**
 * Stream a lesson audio clip.
 *
 * Range support matters beyond seeking: without `Content-Length` iOS Safari
 * cannot determine the clip duration, which breaks scrubbing and the player's
 * "listened enough" detection.
 */
export async function serveArticleAudio(
  articleId: string,
  chunkIndex: number,
  request: Request,
) {
  // A media element cannot follow a redirect to a sign-in page, so this says
  // no in the only way <audio> understands.
  const user = await currentUser()
  if (!user) return new Response('Sign in first', { status: 401 })
  const db = getDb()

  const article = await db.query.lessonArticles.findFirst({
    where: eq(lessonArticles.id, articleId),
  })
  if (!article) return new Response('Not found', { status: 404 })

  const lesson = await db.query.lessons.findFirst({
    where: and(eq(lessons.id, article.lessonId), eq(lessons.userId, user.id)),
  })
  if (!lesson) return new Response('Not found', { status: 404 })

  const chunks = parseChunks(article.audioChunks)
  const key =
    chunks.length > 0
      ? chunks[chunkIndex]?.key
      : chunkIndex === 0
        ? (article.audioKey ?? undefined)
        : undefined
  if (!key) return new Response('Not found', { status: 404 })

  const etag = `"${articleId}-${chunkIndex}"`
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }

  const head = await getAudioBucket().head(key)
  if (!head) return new Response('Not found', { status: 404 })

  const headers = new Headers({
    'Content-Type': head.httpMetadata?.contentType ?? 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    // Clip bytes never change once written; only the owner can read them.
    'Cache-Control': 'private, max-age=31536000, immutable',
  })

  const range = parseRange(request.headers.get('range'), head.size)

  if (range && 'unsatisfiable' in range) {
    headers.set('Content-Range', `bytes */${head.size}`)
    return new Response(null, { status: 416, headers })
  }

  if (range) {
    const length = range.end - range.start + 1
    const object = await getAudioBucket().get(key, {
      range: { offset: range.start, length },
    })
    if (!object) return new Response('Not found', { status: 404 })
    headers.set('Content-Length', String(length))
    headers.set(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${head.size}`,
    )
    return new Response(object.body, { status: 206, headers })
  }

  const object = await getAudioBucket().get(key)
  if (!object) return new Response('Not found', { status: 404 })
  headers.set('Content-Length', String(head.size))
  return new Response(object.body, { status: 200, headers })
}

export async function deleteArticleAudio(
  audioKey: string | null,
  audioChunks: string | null,
) {
  for (const key of audioKeysOf(audioKey, audioChunks)) {
    try {
      await getAudioBucket().delete(key)
    } catch {
      // object may already be gone
    }
  }
}
