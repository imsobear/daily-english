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
import { hasChinese } from '#/lib/word-detail'
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

  const scroller = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const started = useRef(false)
  const settling = useRef(0)
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
    if (started.current) return
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
   * Every card is exactly one viewport tall, so where we are in the feed is
   * arithmetic rather than a stack of observers. The next card's audio is
   * warmed on arrival: the endpoint synthesises on first play, and nobody
   * should wait for that.
   */
  function onScroll() {
    const element = scroller.current
    if (!element || element.clientHeight === 0) return
    const index = Math.round(element.scrollTop / element.clientHeight)
    if (index !== state.current.active) {
      state.current.active = index
      const card = state.current.cards[index]
      // A flick past four cards should speak the one it lands on, not all
      // four, so the word waits for the scrolling to stop.
      window.clearTimeout(settling.current)
      if (card) {
        settling.current = window.setTimeout(() => speak(card), SETTLE_MS)
      }
      const next = state.current.cards[index + 1]
      if (next) void fetch(next.audioUrl).catch(() => undefined)
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
      scroller.current?.scrollTo({ top: 0 })
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
     * Pinned rather than laid out in the page's flow. A card is one screen
     * tall, and `h-full` only means anything if some ancestor has a height to
     * take a percentage of — the app shell is `min-h-dvh`, which is a floor
     * and not a height. Anchoring to the viewport, stopping where the tab bar
     * starts, is what gives the feed a definite box to divide.
     */
    <div
      className="fixed inset-x-0 top-0 flex flex-col"
      style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
    >
      <header className="safe-top flex justify-center px-3.5 pb-2">
        <h1 className="sr-only">Explore</h1>
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
      </header>

      {start.levelHint ? (
        <Link
          to="/settings"
          className="mx-3.5 mb-2 flex items-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-2 text-sm font-bold text-brand-700"
        >
          <span className="min-w-0 flex-1">
            You know most of {start.level}. Try {start.levelHint}?
          </span>
          <ArrowUpRight className="size-4 shrink-0" />
        </Link>
      ) : null}

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
        <div
          ref={scroller}
          onScroll={onScroll}
          onTouchStart={arm}
          onMouseDown={arm}
          className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain"
        >
          {cards.map((card, index) => (
            <WordSlide
              // Wrapping the learner's list can show a word twice in one feed,
              // so position is part of what makes a card itself.
              key={`${card.normalized}-${index}`}
              card={card}
              mark={marks[card.normalized]}
              first={index === 0}
              onSpeak={() => speak(card)}
              onSave={() => void save(card)}
              onDismiss={() => void dismiss(card)}
            />
          ))}

          <div className="flex h-full snap-start snap-always flex-col items-center justify-center gap-3 px-8 text-center">
            {end ? (
              <>
                <p className="text-lg font-extrabold">That is the lot</p>
                <p className="text-sm text-ink-soft">
                  You have been through everything at your level. Raising it in
                  settings opens a new pool.
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
  const [gloss, setGloss] = useState(false)
  const percent =
    card.familiarity != null ? Math.round(card.familiarity * 100) : null
  const detail = card.detail
  const chinese = hasChinese(detail)
  /*
   * Meanings and nothing else. A card is read in a second on the way past, and
   * everything that was competing with the definitions for that second —
   * patterns, collocation chips — is a tap away on the word page, where there
   * is room to take them in.
   *
   * A snap card cannot scroll either, so only what fits a phone stays on it.
   */
  const senses = detail
    ? detail.senses.slice(0, 3).map((sense) => ({
        partOfSpeech: sense.pos,
        definition: sense.definition,
        example: sense.example,
        zh: sense.zh,
      }))
    : card.definitions
        .slice(0, 3)
        .map((sense) => ({ ...sense, example: null, zh: null }))
  // Older entries keep their examples in a list of their own.
  const samples = detail ? [] : card.examples.slice(0, 2)

  return (
    <article className="flex h-full snap-start snap-always flex-col overflow-hidden px-4 pt-1 pb-3">
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
                {/*
                  Up here with the pronunciation, where it is in the same place
                  on every card, rather than trailing whatever the last sense
                  happens to be. Off until asked for: the English below is the
                  exercise, and a translation in plain sight is read instead of
                  it. One tap is a small enough price for being stuck.
                */}
                {chinese ? (
                  <button
                    type="button"
                    onClick={() => setGloss((shown) => !shown)}
                    aria-pressed={gloss}
                    className={`rounded-full border px-2 py-px text-[0.6875rem] font-bold ${
                      gloss
                        ? 'border-transparent bg-surface-sunk text-ink-soft'
                        : 'border-hairline text-ink-faint'
                    }`}
                  >
                    中文
                  </button>
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
                      key={`${sense.partOfSpeech}-${index}`}
                      className="card-soft px-3.5 py-2.5"
                    >
                      <p className="text-[0.9375rem] leading-snug">
                        {sense.partOfSpeech ? (
                          <span className="kicker mr-1.5 inline">
                            {sense.partOfSpeech}{' '}
                          </span>
                        ) : null}
                        <span className="selectable">{sense.definition}</span>
                      </p>
                      {gloss && sense.zh ? (
                        <p className="selectable mt-1 text-[0.9375rem] leading-snug text-ink-soft">
                          {sense.zh}
                        </p>
                      ) : null}
                      {sense.example ? (
                        <p className="selectable mt-1 text-sm italic leading-snug text-ink-soft">
                          {sense.example}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {samples.length > 0 ? (
                <ul className="mt-2.5 space-y-1">
                  {samples.map((example) => (
                    <li
                      key={example}
                      className="selectable text-sm italic leading-snug text-ink-soft"
                    >
                      {example}
                    </li>
                  ))}
                </ul>
              ) : null}
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
