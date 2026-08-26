/*
 * Offline support, aimed at one thing: a lesson you already opened should still
 * play on a train with no signal. Build assets and audio are immutable once
 * written, so they are served from the cache; pages and read-only data go to
 * the network first and fall back to the last copy only when the fetch fails.
 */
const SHELL = 'shell-v1'
const AUDIO = 'audio-v1'
const PAGES = 'pages-v1'
const DATA = 'data-v1'
const KEEP = new Set([SHELL, AUDIO, PAGES, DATA])

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => !KEEP.has(name)).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (error) {
    const hit = await cache.match(request)
    if (hit) return hit
    throw error
  }
}

/**
 * Media players ask for byte ranges, and a range request can neither be stored
 * in the cache nor answered with a whole file, so the clip is fetched and kept
 * in one piece and the slice is cut here.
 */
async function partial(response, range) {
  const buffer = await response.arrayBuffer()
  const match = /bytes=(\d*)-(\d*)/.exec(range)
  const start = match && match[1] ? Number(match[1]) : 0
  const end = match && match[2] ? Number(match[2]) : buffer.byteLength - 1
  const body = buffer.slice(start, end + 1)

  return new Response(body, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'content-type': response.headers.get('content-type') ?? 'audio/mpeg',
      'content-length': String(body.byteLength),
      'content-range': `bytes ${start}-${end}/${buffer.byteLength}`,
      'accept-ranges': 'bytes',
    },
  })
}

async function clip(request) {
  const cache = await caches.open(AUDIO)
  const whole = new Request(request.url)
  const range = request.headers.get('range')

  const hit = await cache.match(whole)
  if (hit) return range ? partial(hit, range) : hit

  const response = await fetch(whole)
  if (!response.ok) return response
  await cache.put(whole, response.clone())
  return range ? partial(response, range) : response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Signing in must always reach the server, and it redirects off-origin.
  if (url.pathname.startsWith('/api/auth')) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL))
    return
  }

  if (
    url.pathname.startsWith('/api/audio/') ||
    url.pathname.startsWith('/api/word-audio/')
  ) {
    event.respondWith(clip(request))
    return
  }

  if (url.pathname.startsWith('/_serverFn/')) {
    event.respondWith(networkFirst(request, DATA))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGES))
  }
})
