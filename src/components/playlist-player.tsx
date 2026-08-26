import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  afterClipEnds,
  currentUrl,
  skipTrack,
  type Playhead,
  type PlaylistTrack,
} from '#/lib/playlist'
import { cn } from '#/lib/utils'

type PlaylistApi = {
  tracks: PlaylistTrack[]
  head: Playhead
  playing: boolean
  sheetOpen: boolean
  start: (tracks: PlaylistTrack[]) => void
  playTrack: (index: number) => void
  toggle: () => void
  skip: (delta: number) => void
  closeSheet: () => void
}

const PlaylistContext = createContext<PlaylistApi | null>(null)

export function usePlaylist() {
  const value = useContext(PlaylistContext)
  if (!value) throw new Error('usePlaylist must be used inside PlaylistProvider')
  return value
}

/**
 * Loops spoken articles from the Today list.
 *
 * The audio element lives here, above the sheet, so dismissing the sheet does
 * not stop playback — lock-screen and Bluetooth controls keep working.
 */
export function PlaylistProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [tracks, setTracks] = useState<PlaylistTrack[]>([])
  const [head, setHead] = useState<Playhead>({ track: 0, clip: 0 })
  const [playing, setPlaying] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const tracksRef = useRef(tracks)
  const headRef = useRef(head)
  const playingRef = useRef(playing)
  tracksRef.current = tracks
  headRef.current = head
  playingRef.current = playing

  const load = useCallback((next: Playhead, play: boolean) => {
    const element = audioRef.current
    const url = currentUrl(tracksRef.current, next)
    if (!element || !url) return
    const abs = new URL(url, window.location.href).href
    if (element.src !== abs) element.src = url
    if (play) void element.play().catch(() => setPlaying(false))
    else element.pause()
  }, [])

  const start = useCallback(
    (nextTracks: PlaylistTrack[]) => {
      setSheetOpen(true)
      if (nextTracks.length === 0) return
      setTracks(nextTracks)

      if (playingRef.current) return

      const element = audioRef.current
      if (element && !element.ended && element.src && tracksRef.current.length > 0) {
        setPlaying(true)
        void element.play().catch(() => setPlaying(false))
        return
      }

      const next = { track: 0, clip: 0 }
      headRef.current = next
      tracksRef.current = nextTracks
      setHead(next)
      setPlaying(true)
      const url = currentUrl(nextTracks, next)
      if (element && url) {
        element.src = url
        void element.play().catch(() => setPlaying(false))
      }
    },
    [],
  )

  const playTrack = useCallback(
    (index: number) => {
      const next = { track: index, clip: 0 }
      headRef.current = next
      setHead(next)
      setPlaying(true)
      load(next, true)
    },
    [load],
  )

  const toggle = useCallback(() => {
    const element = audioRef.current
    if (!element) return
    if (playingRef.current) {
      element.pause()
      setPlaying(false)
      return
    }
    setPlaying(true)
    void element.play().catch(() => setPlaying(false))
  }, [])

  const skip = useCallback(
    (delta: number) => {
      const next = skipTrack(tracksRef.current, headRef.current, delta)
      headRef.current = next
      setHead(next)
      load(next, true)
      setPlaying(true)
    },
    [load],
  )

  function handleEnded() {
    const next = afterClipEnds(tracksRef.current, headRef.current)
    headRef.current = next
    setHead(next)
    load(next, true)
    setPlaying(true)
  }

  useEffect(() => {
    const url = currentUrl(tracks, afterClipEnds(tracks, head))
    if (url) void fetch(url).catch(() => undefined)
  }, [tracks, head])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const track = tracks[head.track]
    if (!track) {
      navigator.mediaSession.metadata = null
      return
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: 'Daily English',
      artwork: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      ],
    })
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    navigator.mediaSession.setActionHandler('play', () => {
      setPlaying(true)
      void audioRef.current?.play().catch(() => setPlaying(false))
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause()
      setPlaying(false)
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1))
    navigator.mediaSession.setActionHandler('nexttrack', () => skip(1))
    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
    }
  }, [head, playing, skip, tracks])

  const api = useMemo<PlaylistApi>(
    () => ({
      tracks,
      head,
      playing,
      sheetOpen,
      start,
      playTrack,
      toggle,
      skip,
      closeSheet: () => setSheetOpen(false),
    }),
    [head, playTrack, playing, sheetOpen, skip, start, toggle, tracks],
  )

  return (
    <PlaylistContext.Provider value={api}>
      {children}
      <audio
        ref={audioRef}
        playsInline
        preload="auto"
        className="hidden"
        onEnded={handleEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          if (!audioRef.current?.ended) setPlaying(false)
        }}
      />
      {sheetOpen ? <PlaylistSheet /> : null}
    </PlaylistContext.Provider>
  )
}

function PlaylistSheet() {
  const { tracks, head, playing, playTrack, toggle, skip, closeSheet } =
    usePlaylist()
  const current = tracks[head.track]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close player"
        onClick={closeSheet}
        className="absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
      />
      <div
        className="animate-pop-in relative mx-auto flex max-h-[85dvh] w-full max-w-[26rem] flex-col rounded-t-3xl border-t border-hairline bg-surface shadow-pop"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-hairline-strong" />
        <button
          type="button"
          onClick={closeSheet}
          aria-label="Close player"
          className="absolute right-3 top-3 grid size-11 place-items-center rounded-full text-ink-faint active:bg-surface-sunk"
        >
          <X className="size-4" />
        </button>

        <div className="px-5 pb-4 pt-5">
          <p className="kicker">Now playing</p>
          <p className="mt-1 truncate text-xl font-black leading-tight">
            {current?.title ?? 'No spoken articles yet'}
          </p>
          {tracks.length > 1 ? (
            <p className="mt-1 text-sm text-ink-soft">
              {head.track + 1} of {tracks.length} · looping
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-center gap-5">
            <button
              type="button"
              onClick={() => skip(-1)}
              disabled={tracks.length === 0}
              aria-label="Previous article"
              className="grid size-14 place-items-center rounded-full text-ink-soft active:bg-surface-sunk disabled:opacity-40"
            >
              <SkipBack className="size-7" />
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={tracks.length === 0}
              aria-label={playing ? 'Pause' : 'Play'}
              className="btn-3d grid size-20 place-items-center rounded-full border-brand-700 bg-brand-500 text-white disabled:opacity-40"
            >
              {playing ? (
                <Pause className="size-9" fill="currentColor" />
              ) : (
                <Play className="size-9 translate-x-0.5" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={() => skip(1)}
              disabled={tracks.length === 0}
              aria-label="Next article"
              className="grid size-14 place-items-center rounded-full text-ink-soft active:bg-surface-sunk disabled:opacity-40"
            >
              <SkipForward className="size-7" />
            </button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto border-t border-hairline px-3 pb-4 pt-2">
          {tracks.map((track, index) => {
            const active = index === head.track
            return (
              <li key={track.lessonId}>
                <button
                  type="button"
                  onClick={() => playTrack(index)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left',
                    active ? 'bg-brand-50' : 'active:bg-surface-sunk',
                  )}
                >
                  <span
                    className={cn(
                      'w-6 shrink-0 text-center text-xs font-black tabular-nums',
                      active ? 'text-brand-600' : 'text-ink-faint',
                    )}
                  >
                    {index + 1}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate font-extrabold',
                      active ? 'text-brand-700' : 'text-ink',
                    )}
                  >
                    {track.title}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
