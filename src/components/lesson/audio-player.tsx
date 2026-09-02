import { Pause, Play, RotateCcw, SkipBack } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'

import { cn } from '#/lib/utils'

export type Clip = { url: string; from: number; to: number }

export type PlayerHandle = {
  /** Play one sentence, from wherever inside its clip it happens to fall. */
  playSentence: (index: number) => void
}

/**
 * How much to allow either side of an estimated sentence boundary.
 *
 * The position is inferred from character counts, not from marks in the audio,
 * so it lands near the sentence rather than on it. Erring early and late means
 * the error is heard as a little of the neighbouring sentence instead of as a
 * clipped first or last syllable.
 */
const SEEK_SLACK_SECONDS = 0.2

/** How far "back" goes, in seconds, crossing into the clip before if it must. */
const REWIND_SECONDS = 10

const SPEEDS = [0.75, 1, 1.25] as const

/**
 * Plays an article that happens to be stored as several clips.
 *
 * Splitting the audio is a recording decision — shorter requests synthesise
 * faster, and a clip spanning a handful of sentences is what makes seeking to
 * one of them accurate enough to be worth offering. None of that is the
 * learner's business, so the player presents the clips as a single track: one
 * bar over the whole article, playback running through the joins, and "back"
 * measured in seconds rather than in parts.
 *
 * Position within a clip is estimated from character counts, which holds well
 * enough because TTS keeps a near-constant pace. The same estimate weights the
 * clips against each other, so the bar moves at one speed across a boundary
 * instead of jumping.
 */
export function AudioPlayer({
  clips,
  sentences,
  startSpeed = 1,
  onSentenceChange,
  onComplete,
  ref,
}: {
  clips: Clip[]
  sentences: string[]
  /** Where the speed control starts. Still the learner's to change. */
  startSpeed?: number
  onSentenceChange?: (index: number | null) => void
  /** Fired when the final clip ends, so the whole article has been heard. */
  onComplete?: () => void
  ref?: Ref<PlayerHandle>
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [clipIndex, setClipIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(startSpeed)
  const [elapsed, setElapsed] = useState(0)
  const [finished, setFinished] = useState(false)

  const clip = clips[clipIndex]

  /*
   * Pull the rest of the article down while the first part plays. The learner
   * has to hear every part to finish the step anyway, and fetching them now is
   * what lets the service worker answer once the signal goes — a lesson opened
   * at home keeps working underground.
   */
  useEffect(() => {
    let cancelled = false
    async function warm() {
      for (const item of clips.slice(1)) {
        if (cancelled) return
        try {
          await fetch(item.url)
        } catch {
          return
        }
      }
    }
    void warm()
    return () => {
      cancelled = true
    }
  }, [clips])

  const report = useCallback(
    (index: number | null) => onSentenceChange?.(index),
    [onSentenceChange],
  )

  /** A sentence waiting for its clip's duration to be known before it seeks. */
  const pending = useRef<number | null>(null)
  /**
   * A position waiting on the same thing, in seconds — negative counts back
   * from the end, which is the only way to land in a clip whose length is not
   * known until it loads.
   */
  const pendingTime = useRef<number | null>(null)
  /** Where the current sentence ends, so playback stops with the sentence. */
  const stopAt = useRef<number | null>(null)

  /**
   * Each clip's share of the article, measured in characters.
   *
   * The bar covers the whole article but the element only ever knows the
   * length of the clip it is playing, so the clips either side are sized by
   * how much text they hold. Speech runs at a near-constant pace, so the bar
   * crosses a join at the speed it was already moving.
   */
  const shares = useMemo(() => {
    const chars = clips.map((item) =>
      sentences
        .slice(item.from, item.to + 1)
        .reduce((sum, sentence) => sum + sentence.length, 0),
    )
    const total = chars.reduce((sum, count) => sum + count, 0)
    if (total <= 0) return clips.map(() => 1 / Math.max(1, clips.length))
    return chars.map((count) => count / total)
  }, [clips, sentences])

  /**
   * Move to a clip, clearing the position along with it.
   *
   * `elapsed` is measured against whichever clip produced it, so carrying it
   * across a clip change would divide the old position by the new duration and
   * throw the bar forward for the frame before the first timeupdate lands.
   */
  const goToClip = useCallback((index: number) => {
    stopAt.current = null
    setClipIndex(index)
    setElapsed(0)
    setFinished(false)
  }, [])

  /**
   * Where one sentence sits inside its clip, as a fraction of the clip.
   *
   * Speech keeps a near-constant pace, so how far through the clip's
   * characters a sentence starts is a good proxy for how far through its
   * seconds — the same assumption the progress highlighting already runs on.
   */
  const spanOf = useCallback(
    (clip: Clip, index: number) => {
      const within = sentences.slice(clip.from, clip.to + 1)
      const total = within.reduce((sum, item) => sum + item.length, 0)
      if (total === 0) return null
      const before = within
        .slice(0, index - clip.from)
        .reduce((sum, item) => sum + item.length, 0)
      const length = sentences[index]?.length ?? 0
      return { start: before / total, end: (before + length) / total }
    },
    [sentences],
  )

  const seekToSentence = useCallback(
    (index: number) => {
      const element = audioRef.current
      const clip = clips.find((item) => index >= item.from && index <= item.to)
      if (!element || !clip || !Number.isFinite(element.duration)) return false

      const span = spanOf(clip, index)
      if (!span) return false

      const from = Math.max(0, span.start * element.duration - SEEK_SLACK_SECONDS)
      stopAt.current = Math.min(
        element.duration,
        span.end * element.duration + SEEK_SLACK_SECONDS,
      )
      element.currentTime = from
      setElapsed(from)
      setFinished(false)
      void element.play().catch(() => setPlaying(false))
      return true
    },
    [clips, spanOf],
  )

  useImperativeHandle(ref, () => ({
    playSentence(index: number) {
      const target = clips.findIndex(
        (item) => index >= item.from && index <= item.to,
      )
      if (target < 0) return
      setPlaying(true)
      // A clip that is not loaded yet has no duration to measure against, so
      // the seek waits for its metadata rather than guessing at zero.
      if (target === clipIndex && seekToSentence(index)) return
      pending.current = index
      goToClip(target)
    },
  }))

  function handleLoadedMetadata() {
    const element = audioRef.current
    if (pendingTime.current != null && element) {
      const offset = pendingTime.current
      pendingTime.current = null
      const at =
        offset < 0 ? Math.max(0, element.duration + offset) : Math.max(0, offset)
      element.currentTime = at
      setElapsed(at)
      if (playing) void element.play().catch(() => setPlaying(false))
      return
    }
    if (pending.current == null) return
    const index = pending.current
    pending.current = null
    seekToSentence(index)
  }

  // Autoplay when the clip changes as part of continuous playback. Anything
  // waiting on metadata starts itself once it knows where to start.
  useEffect(() => {
    const element = audioRef.current
    if (!element || !playing) return
    if (pending.current != null || pendingTime.current != null) return
    element.playbackRate = speed
    void element.play().catch(() => setPlaying(false))
  }, [clipIndex, playing, speed])

  useEffect(() => {
    const element = audioRef.current
    if (element) element.playbackRate = speed
  }, [speed])

  function handleTimeUpdate() {
    const element = audioRef.current
    if (!element || !clip) return
    setElapsed(element.currentTime)

    if (stopAt.current != null && element.currentTime >= stopAt.current) {
      stopAt.current = null
      element.pause()
      setPlaying(false)
    }

    const span = clip.to - clip.from + 1
    if (span <= 1 || !Number.isFinite(element.duration) || element.duration <= 0) {
      report(clip.from)
      return
    }
    const within = sentences.slice(clip.from, clip.to + 1)
    const totalChars = within.reduce((sum, item) => sum + item.length, 0) || 1
    const played = (element.currentTime / element.duration) * totalChars
    let consumed = 0
    for (let i = 0; i < within.length; i += 1) {
      consumed += within[i].length
      if (played <= consumed) {
        report(clip.from + i)
        return
      }
    }
    report(clip.to)
  }

  function handleEnded() {
    if (clipIndex >= clips.length - 1) {
      // Hold the bar full rather than snapping back to the last clip's start.
      setPlaying(false)
      setFinished(true)
      report(null)
      onComplete?.()
      return
    }

    goToClip(clipIndex + 1)
  }

  function toggle() {
    const element = audioRef.current
    if (!element) return
    // Pressing play means the rest of the article, not the rest of a sentence.
    stopAt.current = null
    if (playing) {
      element.pause()
      setPlaying(false)
      return
    }
    if (finished) {
      // Replay the article from the top instead of repeating its last part.
      goToClip(0)
      setPlaying(true)
      return
    }
    element.playbackRate = speed
    setPlaying(true)
    void element.play().catch(() => setPlaying(false))
  }

  function restart() {
    goToClip(0)
    const element = audioRef.current
    if (element) element.currentTime = 0
    setPlaying(true)
  }

  function back() {
    const element = audioRef.current
    if (!element) return
    stopAt.current = null
    setFinished(false)

    const target = element.currentTime - REWIND_SECONDS
    if (target >= 0 || clipIndex === 0) {
      element.currentTime = Math.max(0, target)
      setElapsed(element.currentTime)
      return
    }

    // The ten seconds run off the front of this clip and into the one before,
    // whose length is unknown until it loads — so the remainder is carried
    // over as a distance from its end.
    pendingTime.current = target
    goToClip(clipIndex - 1)
  }

  if (clips.length === 0) {
    return (
      <p className="rounded-2xl bg-surface-sunk px-4 py-3 text-center text-xs font-bold text-ink-soft">
        Audio was not generated for this article. You can still read it.
      </p>
    )
  }

  const duration = audioRef.current?.duration
  const ratio =
    Number.isFinite(duration) && duration && duration > 0
      ? Math.min(1, elapsed / duration)
      : 0

  const paused = !playing && !finished && elapsed > 0
  const behind = shares
    .slice(0, clipIndex)
    .reduce((sum, share) => sum + share, 0)
  const progress = finished
    ? 1
    : Math.min(1, behind + ratio * (shares[clipIndex] ?? 1))

  return (
    <div className="rounded-2xl bg-surface-sunk p-2.5">
      <audio
        ref={audioRef}
        src={clip?.url}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        // Reaching the end fires `pause` just before `ended`. Treating that as
        // a real pause would clear `playing` and strand continuous playback on
        // the first clip boundary, so only a deliberate pause counts.
        onPause={() => {
          if (!audioRef.current?.ended) setPlaying(false)
        }}
        className="hidden"
      />

      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-hairline-strong">
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={back}
          aria-label="Back ten seconds"
          className="grid size-11 place-items-center rounded-xl text-ink-soft active:bg-hairline"
        >
          <SkipBack className="size-5" />
        </button>

        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : paused ? 'Resume' : 'Play'}
          className="btn-3d grid size-12 place-items-center rounded-full border-brand-700 bg-brand-500 text-white"
        >
          {playing ? (
            <Pause className="size-6" fill="currentColor" />
          ) : (
            <Play className="size-6 translate-x-0.5" fill="currentColor" />
          )}
        </button>

        <button
          type="button"
          onClick={restart}
          aria-label="Start over"
          className="grid size-11 place-items-center rounded-xl text-ink-soft active:bg-hairline"
        >
          <RotateCcw className="size-5" />
        </button>

        <div className="ml-auto flex items-center gap-0.5 rounded-full bg-hairline p-0.5">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSpeed(value)}
              aria-pressed={speed === value}
              className={cn(
                'min-h-8 rounded-full px-2 text-[0.6875rem] font-black tabular-nums',
                speed === value
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-ink-soft',
              )}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
