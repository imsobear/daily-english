import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowUpRight, Check, ChevronsDown, Plus, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  Button,
  ButtonLink,
  EmptyState,
  ProgressRing,
  Spinner,
} from '#/components/ui'
import { BROWSE_SOURCES, type BrowseSource } from '#/lib/browse'
import { readAutoplay } from '#/lib/settings'
import {
  getBrowseMore,
  getBrowseStart,
  markWordKnown,
  setBrowseSource,
  type BrowseCard,
} from '#/server/browse'
import { addWord } from '#/server/words'

export const Route = createFileRoute('/_app/explore')({
  loader: () => getBrowseStart(),
  component: ExploreScreen,
})

const LABELS: Record<BrowseSource, string> = {
  mine: 'Mine',
  mix: 'Mix',
  new: 'New',
}

/** What the learner has just done to a card, before the feed is rebuilt. */
type Mark = 'saved' | 'known'

/**
 * How long the feed waits after the last scroll before speaking.
 *
 * Long enough for a snap to finish and for a flick through several cards to
 * count as one arrival, short enough that a card sitting still in front of
 * someone does not feel like it is thinking about it.
 */
const SETTLE_MS = 180

function ExploreScreen() {
  const start = Route.useLoaderData()
  const [source, setSource] = useState<BrowseSource>(start.source)
  const [cards, setCards] = useState<BrowseCard[]>(start.cards)
  const [cursor, setCursor] = useState(start.mineCursor)
  const [seed, setSeed] = useState(start.seed)
  const [end, setEnd] = useState(start.end)
  const [busy, setBusy] = useState(false)
  const [marks, setMarks] = useState<Record<string, Mark>>({})

  const head = useRef<HTMLElement>(null)
  const headHeight = useRef(0)
  const feed = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const started = useRef(false)
  const settling = useRef(0)
  /*
   * Read once on arrival rather than watched: storage is not there to read
   * during the server render, and the switch is on another screen, which this
   * one is remounted from.
   */
  const autoplay = useRef(true)
  // Read inside the scroll handler, which must not be rebuilt on every card.
  const state = useRef({ cards, cursor, seed, end, busy, source, active: 0 })
  state.current = {
    cards,
    cursor,
    seed,
    end,
    busy,
    source,
    active: state.current.active,
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(settling.current)
      audio.current?.pause()
      audio.current = null
    }
  }, [])

  /*
   * The feed borrows the document's scrolling rather than keeping its own —
   * see `html[data-feed]` in the stylesheet for why a phone browser will only
   * fold its bars away for the one and not the other. The flag stands for as
   * long as this screen does, and the header is measured rather than assumed
   * so a card snaps to rest exactly underneath it.
   *
   * The handler is the one from the first render, which is all it can be
   * given the listener is attached once, and all it needs to be: everything
   * it reads that moves it reads from a ref.
   */
  useEffect(() => {
    const root = document.documentElement
    const header = head.current
    root.dataset.feed = ''
    autoplay.current = readAutoplay()

    function measure() {
      const height = header?.offsetHeight
      if (!height) return
      headHeight.current = height
      root.style.setProperty('--feed-head', `${height}px`)
    }

    measure()
    const watcher = new ResizeObserver(measure)
    if (header) watcher.observe(header)
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      watcher.disconnect()
      window.removeEventListener('scroll', onScroll)
      delete root.dataset.feed
      root.style.removeProperty('--feed-head')
    }
  }, [])

  const loadMore = useCallback(async () => {
    const now = state.current
    if (now.busy || now.end) return
    setBusy(true)
    try {
      const page = await getBrowseMore({
        data: { source: now.source, mineCursor: now.cursor, seed: now.seed },
      })
      setCards((previous) => [...previous, ...page.cards])
      setCursor(page.mineCursor)
      setSeed(page.seed)
      setEnd(page.end || page.cards.length === 0)
    } catch {
      // A failed page is a pause, not a dead end: the next scroll asks again.
    } finally {
      setBusy(false)
    }
  }, [])

  function speak(card: BrowseCard) {
    const element = (audio.current ??= new Audio())
    const href = new URL(card.audioUrl, location.href).href
    if (element.src !== href) element.src = href
    element.currentTime = 0
    element.muted = false
    void element.play().catch(() => undefined)
  }

  /*
   * A card arrived at should say itself, and on a phone that means asking
   * permission first: iOS refuses to let a script start an element nobody has
   * ever started by hand, and a scroll is not that. The touch beginning the
   * scroll is, so the element is started muted there and stopped on the spot —
   * silent, and enough to let the feed speak for itself afterwards. Where the
   * trick fails the fallback is only that the first tap on a speaker does the
   * unlocking instead.
   */
  function arm() {
    if (started.current || !autoplay.current) return
    started.current = true
    const card = state.current.cards[state.current.active]
    if (!card) return
    const element = (audio.current ??= new Audio())
    element.src = new URL(card.audioUrl, location.href).href
    element.muted = true
    void element.play().catch(() => undefined)
    element.pause()
  }

  /*
   * Every card is the same height, so where we are in the feed is arithmetic
   * rather than a stack of observers: how far the first card has travelled
   * past the header, over the height of one. The next card's audio is warmed
   * on arrival: the endpoint synthesises on first play, and nobody should
   * wait for that. A silenced feed warms nothing — there is no play to be
   * ahead of, and the speaker on a card is a tap somebody chose to wait for.
   */
  function onScroll() {
    const first = feed.current?.firstElementChild
    if (!first) return
    const box = first.getBoundingClientRect()
    if (box.height === 0) return
    const index = Math.round((headHeight.current - box.top) / box.height)
    if (index !== state.current.active) {
      state.current.active = index
      const card = state.current.cards[index]
      // A flick past four cards should speak the one it lands on, not all
      // four, so the word waits for the scrolling to stop.
      window.clearTimeout(settling.current)
      if (card && autoplay.current) {
        settling.current = window.setTimeout(() => speak(card), SETTLE_MS)
      }
      const next = state.current.cards[index + 1]
      if (next && autoplay.current) {
        void fetch(next.audioUrl).catch(() => undefined)
      }
    }
    if (index >= state.current.cards.length - 3) void loadMore()
  }

  async function choose(next: BrowseSource) {
    if (next === source || busy) return
    setSource(next)
    setBusy(true)
    void setBrowseSource({ data: { source: next } }).catch(() => undefined)
    try {
      // Seed zero: a different feed deserves a fresh order rather than this
      // one's, and there is no page of it yet to stay consistent with.
      const page = await getBrowseMore({
        data: { source: next, mineCursor: 0, seed: 0 },
      })
      setCards(page.cards)
      setCursor(page.mineCursor)
      setSeed(page.seed)
      setEnd(page.end)
      state.current.active = 0
      window.clearTimeout(settling.current)
      window.scrollTo({ top: 0 })
    } catch {
      // Leave the old feed up rather than blanking the screen.
    } finally {
      setBusy(false)
    }
  }

  async function save(card: BrowseCard) {
    setMarks((previous) => ({ ...previous, [card.normalized]: 'saved' }))
    try {
      await addWord({
        data: { headword: card.headword, source: 'recommendation' },
      })
    } catch {
      setMarks((previous) => {
        const next = { ...previous }
        delete next[card.normalized]
        return next
      })
    }
  }

  async function dismiss(card: BrowseCard) {
    setMarks((previous) => ({ ...previous, [card.normalized]: 'known' }))
    try {
      await markWordKnown({ data: { headword: card.headword } })
    } catch {
      setMarks((previous) => {
        const next = { ...previous }
        delete next[card.normalized]
        return next
      })
    }
  }

  return (
    /*
     * In the page's flow, not pinned to the viewport. A pinned feed scrolls
     * inside itself, and a browser that never sees the document move keeps
     * its address bar and toolbar out for the whole visit — on a feed of
     * one-screen cards that is the two strips of screen the cards most want.
     * The cards take their height from `--feed-slide` instead.
     */
    <div className="flex flex-1 flex-col">
      {/* Stays put while the cards go by, so the three feeds are always a
          tap away rather than a flick back to the top. */}
      <header
        ref={head}
        className="safe-top sticky top-0 z-20 bg-page/90 px-3.5 pb-2 backdrop-blur-xl"
      >
        <h1 className="sr-only">Explore</h1>
        <div className="flex justify-center">
          <div
            role="tablist"
            aria-label="Which words to show"
            className="flex gap-0.5 rounded-full bg-surface-sunk p-0.5"
          >
            {BROWSE_SOURCES.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={option === source}
                onClick={() => void choose(option)}
                className={`min-h-8 rounded-full px-3.5 text-xs font-extrabold transition-colors ${
                  option === source
                    ? 'bg-surface text-ink shadow-[var(--shadow-card)]'
                    : 'text-ink-soft'
                }`}
              >
                {LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        {start.levelHint ? (
          <Link
            to="/settings"
            className="mt-2 flex items-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-2 text-sm font-bold text-brand-700"
          >
            <span className="min-w-0 flex-1">
              You know most of {start.level}. Try {start.levelHint}?
            </span>
            <ArrowUpRight className="size-4 shrink-0" />
          </Link>
        ) : null}
      </header>

      {cards.length === 0 ? (
        <div className="p-3.5">
          <EmptyState
            title={
              source !== 'mine'
                ? 'Nothing left here'
                : start.savedTotal > 0
                  ? `None of your words are ${start.level}`
                  : 'No words yet'
            }
            body={
              source !== 'mine'
                ? 'You have seen everything at your level. Try raising it in settings.'
                : start.savedTotal > 0
                  ? `Every card here is ${start.level}, and your saved words sit at other levels. Change your level in settings, or save some more.`
                  : 'Save a few words and they will show up here to flick through.'
            }
            action={
              <ButtonLink
                to={
                  source === 'mine' && start.savedTotal === 0
                    ? '/words/add'
                    : '/settings'
                }
              >
                {source === 'mine' && start.savedTotal === 0
                  ? 'Add words'
                  : 'Open settings'}
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <div ref={feed} onTouchStart={arm} onMouseDown={arm}>
          {cards.map((card, index) => (
            /*
              The step from one card to the next, which is a little more than a
              screen while the browser's bars are out — that is what keeps the
              next card from showing under this one when they fold away.
            */
            <div
              // Wrapping the learner's list can show a word twice in one feed,
              // so position is part of what makes a card itself.
              key={`${card.normalized}-${index}`}
              className="h-[var(--feed-slide)] snap-start snap-always"
            >
              <WordSlide
                card={card}
                mark={marks[card.normalized]}
                first={index === 0}
                onSpeak={() => speak(card)}
                onSave={() => void save(card)}
                onDismiss={() => void dismiss(card)}
              />
            </div>
          ))}

          <div className="h-[var(--feed-slide)] snap-start snap-always">
            <div className="flex h-[var(--feed-card)] flex-col items-center justify-center gap-3 px-8 text-center">
              {end ? (
                <>
                  <p className="text-lg font-extrabold">That is the lot</p>
                  <p className="text-sm text-ink-soft">
                    You have been through everything at your level. Raising it
                    in settings opens a new pool.
                  </p>
                  <ButtonLink to="/settings" tone="neutral" className="mt-1">
                    Open settings
                  </ButtonLink>
                </>
              ) : (
                <Spinner className="size-6 text-ink-faint" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function WordSlide({
  card,
  mark,
  first,
  onSpeak,
  onSave,
  onDismiss,
}: {
  card: BrowseCard
  mark: Mark | undefined
  first: boolean
  onSpeak: () => void
  onSave: () => void
  onDismiss: () => void
}) {
  const mine = Boolean(card.wordId)
  const percent =
    card.familiarity != null ? Math.round(card.familiarity * 100) : null
  /*
   * Meanings and nothing else. A card is read in a second on the way past, and
   * everything that was competing with the definitions for that second —
   * patterns, collocation chips — is a tap away on the word page, where there
   * is room to take them in.
   *
   * A snap card cannot scroll either, so only what fits a phone stays on it.
   */
  const senses = card.senses.slice(0, 3)

  return (
    /*
      The screen this card is drawn in, which is not the same as the step from
      one card to the next — see `html[data-feed]` in the stylesheet. The feed
      owns the step; a card owns only what it can be seen in.
    */
    <article className="flex h-[var(--feed-card)] flex-col overflow-hidden px-4 pt-1 pb-3">
      <div className="mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col overflow-hidden">
        {/*
          A word takes up a third of a screen and the buttons a little at the
          bottom, so left alone the card is content pinned to the ceiling over
          a drop of empty space. Centring what is left between the two puts the
          word where a thumb rests and the eye already is.
        */}
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={onSpeak}
                aria-label={`Hear ${card.headword}`}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="selectable min-w-0 text-[1.75rem] font-black leading-none tracking-tight">
                  {card.headword}
                </span>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-sunk text-ink-soft">
                  <Volume2 className="size-4" />
                </span>
              </button>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
                {card.ipa ? <span>{card.ipa}</span> : null}
                {card.level ? (
                  <span className="rounded-full bg-surface-sunk px-1.5 py-px text-[0.625rem] font-black tracking-wider">
                    {card.level}
                  </span>
                ) : null}
              </p>
            </div>
            {mine && percent != null ? (
              <ProgressRing
                value={percent}
                max={100}
                size={48}
                stroke={6}
                tone={percent >= 80 ? 'grass' : 'brand'}
              >
                <span className="tabular text-[0.625rem] font-black">
                  {percent}%
                </span>
              </ProgressRing>
            ) : null}
          </div>

          {card.pending ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-faint">
              <Spinner /> Looking this one up…
            </p>
          ) : (
            <div className="mt-3.5 min-h-0 overflow-hidden">
              {senses.length === 0 ? (
                <p className="text-sm leading-snug text-ink-soft">
                  No definition for this one yet.
                </p>
              ) : (
                /*
                  A box each, as on the word page. Loose paragraphs down a screen
                  of nothing read as one grey block a thumb flicks past, where
                  three separated cards read as three things a word can mean.
                */
                <ul className="space-y-2">
                  {senses.map((sense, index) => (
                    <li
                      key={`${sense.pos}-${index}`}
                      className="card-soft px-3.5 py-2.5"
                    >
                      {/*
                        The Chinese is the word rather than the definition
                        said again, so it goes on the line and not under it:
                        two characters cost nothing a card cannot spare, and
                        they are the fastest way into a sense on the way past.
                      */}
                      <p className="text-[0.9375rem] leading-snug">
                        {sense.pos ? (
                          <span className="kicker mr-1.5 inline">
                            {sense.pos}{' '}
                          </span>
                        ) : null}
                        {sense.zh ? (
                          <span className="selectable mr-1.5 font-bold">
                            {sense.zh}
                          </span>
                        ) : null}
                        <span className="selectable">{sense.definition}</span>
                      </p>
                      {sense.examples[0] ? (
                        <p className="selectable mt-1 text-sm italic leading-snug text-ink-soft">
                          {sense.examples[0]}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {!mine || first ? (
          <div className="mt-auto flex w-full shrink-0 flex-col items-center pt-3">
            {first ? (
              <ChevronsDown className="mb-2 size-5 animate-bounce text-ink-faint" />
            ) : null}
            {mine ? null : mark === 'saved' ? (
              <Button tone="neutral" size="sm" block disabled>
                <Check className="size-4" /> Saved
              </Button>
            ) : mark === 'known' ? (
              <Button tone="ghost" size="sm" block disabled>
                Marked as known
              </Button>
            ) : (
              <div className="flex w-full gap-2">
                <Button onClick={onSave} size="sm" block>
                  <Plus className="size-4" /> Save
                </Button>
                <Button
                  onClick={onDismiss}
                  tone="neutral"
                  size="sm"
                  className="shrink-0"
                >
                  Know it
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </article>
  )
}
