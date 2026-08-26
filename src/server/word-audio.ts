import { eq } from 'drizzle-orm'

import { getAudioBucket, getDb, getEnv } from '#/db'
import { dictionaryEntries } from '#/db/schema'
import {
  readOpenAiApiKey,
  readTtsMockUrl,
  synthesizeSpeech,
  TTS_VOICE,
  type SpokenAudio,
} from '#/lib/ai'
import { normalizeHeadword } from '#/lib/dictionary'
import { loadEntry, stubEntry } from '#/lib/entries'
import { currentUser } from '#/lib/session'

const KEY_PREFIX = `word-audio/${TTS_VOICE}/`

/**
 * A headword, or a short phrasal verb like "give up". Anything longer is
 * someone trying to have the endpoint read their text aloud for free.
 */
const SPEAKABLE = /^[a-z][a-z'-]*( [a-z'-]+){0,2}$/

function audioHeaders(etag: string, length: number, contentType: string) {
  return new Headers({
    'Content-Type': contentType,
    'Content-Length': String(length),
    ETag: etag,
    // How a word sounds is the same for everyone and never changes, so this
    // can sit in shared caches forever.
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
}

/**
 * Serve the spoken form of a word, synthesising it on first play.
 *
 * Pronunciation used to be hotlinked from dictionaryapi.dev, but that media
 * host now returns 502 for every file, and the clips it did serve were a mix
 * of Australian, British and American recordings. Speaking the word with the
 * same OpenAI voice that reads the lessons keeps the accent consistent.
 *
 * The clip is keyed by the word rather than by whose list it is in, so it is
 * spoken once and every learner after that is served from R2.
 */
export async function serveWordAudio(word: string, request: Request) {
  // Speech costs money to make, so a caller with no session does not get to
  // ask for it. This used to mint a guest to satisfy itself, which is how the
  // crawlers ended up with accounts.
  if (!(await currentUser())) {
    return new Response('Sign in first', { status: 401 })
  }

  const normalized = normalizeHeadword(decodeURIComponent(word))
  if (normalized.length > 40 || !SPEAKABLE.test(normalized)) {
    return new Response('Not a word we can speak', { status: 400 })
  }

  const db = getDb()
  const etag = `"${TTS_VOICE}-${normalized}"`
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }

  const bucket = getAudioBucket()
  const key = `${KEY_PREFIX}${normalized}.mp3`
  const entry = await loadEntry(db, normalized)

  const stored = entry?.audioKey === key ? await bucket.get(key) : null
  if (stored) {
    return new Response(stored.body, {
      headers: audioHeaders(
        etag,
        stored.size,
        stored.httpMetadata?.contentType ?? 'audio/mpeg',
      ),
    })
  }

  let spoken: SpokenAudio
  try {
    // The trailing period keeps the model from clipping the final consonant
    // of a bare word.
    spoken = await synthesizeSpeech({
      text: `${entry?.headword ?? normalized}.`,
      mockUrl: readTtsMockUrl(getEnv()),
      apiKey: readOpenAiApiKey(getEnv()),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not speak this word'
    return new Response(message, { status: 503 })
  }

  const { audio, contentType } = spoken
  await bucket.put(key, audio, { httpMetadata: { contentType } })
  // A word can be spoken before anyone saves it, straight from a tap in an
  // article, so the entry may still need creating.
  if (!entry) await stubEntry(db, normalized, normalized)
  await db
    .update(dictionaryEntries)
    .set({ audioKey: key })
    .where(eq(dictionaryEntries.normalized, normalized))

  return new Response(audio, {
    headers: audioHeaders(etag, audio.byteLength, contentType),
  })
}
