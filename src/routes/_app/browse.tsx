import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowUpRight, Check, ChevronsDown, Plus, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, ButtonLink, EmptyState, Spinner } from '#/components/ui'
import { BROWSE_SOURCES, type BrowseSource } from '#/lib/browse'
import {
  getBrowseMore,
  getBrowseStart,
  markWordKnown,
  setBrowseSource,
  type BrowseCard,
} from '#/server/browse'
import { addWord } from '#/server/words'

export const Route = createFileRoute('/_app/browse')({
  loader: () => getBrowseStart(),
  component: BrowseScreen,
})

const LABELS: Record<BrowseSource, string> = {
  mine: 'Mine',
  mix: 'Mix',
  new: 'New',
}

/** What the learner has just done to a card, before the feed is rebuilt. */
type Mark = 'saved' | 'known'

function BrowseScreen() {
  const start = Route.useLoaderData()
  const [source, setSource] = useState<BrowseSource>(start.source)
  const [cards, setCards] = useState<BrowseCard[]>(start.cards)
  const [cursor, setCursor] = useState(start.mineCursor)
  const [end, setEnd] = useState(start.end)
  const [busy, setBusy] = useState(false)
  const [marks, setMarks] = useState<Record<string, Mark>>({})

  const scroller = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  // Read inside the scroll handler, which must not be rebuilt on every card.
  const state = useRef({ cards, cursor, end, busy, source, active: 0 })
  state.current = { cards, cursor, end, busy, source, active: state.current.active }

  useEffect(() => {
    return () => {
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
        data: { source: now.source, mineCursor: now.cursor },
      })
      setCards((previous) => [...previous, ...page.cards])
      setCursor(page.mineCursor)
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
    void element.play().catch(() => undefined)
  }

  /*
   * Every card is exactly one viewport tall, so where we are in the feed is
   * arithmetic rather than a stack of observers. The next card's audio is
   * warmed on arrival: the endpoint synthesises on first play, and a learner
   * who taps the speaker should not wait for that.
   */
  function onScroll() {
    const element = scroller.current
    if (!element || element.clientHeight === 0) return
    const index = Math.round(element.scrollTop / element.clientHeight)
    if (index !== state.current.active) {
      state.current.active = index
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
      const page = await getBrowseMore({ data: { source: next, mineCursor: 0 } })
      setCards(page.cards)
      setCursor(page.mineCursor)
      setEnd(page.end)
      state.current.active = 0
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
      <header className="safe-top flex items-center gap-3 px-3.5 pb-2">
        <h1 className="text-xl font-black tracking-tight">Browse</h1>
        <div
          role="tablist"
          aria-label="Which words to show"
          className="ml-auto flex gap-0.5 rounded-full bg-surface-sunk p-0.5"
        >
          {BROWSE_SOURCES.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={option === source}
              onClick={() => void choose(option)}
              className={`min-h-8 rounded-full px-3 text-xs font-extrabold transition-colors ${
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
            title={source === 'mine' ? 'No words yet' : 'Nothing left here'}
            body={
              source === 'mine'
                ? 'Save a few words and they will show up here to flick through.'
                : 'You have seen everything at your level. Try raising it in settings.'
            }
            action={
              <ButtonLink to={source === 'mine' ? '/words/add' : '/settings'}>
                {source === 'mine' ? 'Add words' : 'Open settings'}
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <div
          ref={scroller}
          onScroll={onScroll}
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

          <div className="flex h-full snap-start flex-col items-center justify-center gap-3 px-8 text-center">
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

  return (
    <article className="relative flex h-full snap-start flex-col justify-center px-5">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex items-center gap-2">
          {card.level ? (
            <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-[0.6875rem] font-black tracking-wider text-ink-soft">
              {card.level}
            </span>
          ) : null}
          {card.partOfSpeech ? (
            <span className="text-[0.6875rem] font-black uppercase tracking-wider text-ink-faint">
              {card.partOfSpeech}
            </span>
          ) : null}
          {mine ? (
            <span className="ml-auto text-[0.6875rem] font-black uppercase tracking-wider text-brand-600">
              Yours
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onSpeak}
          aria-label={`Hear ${card.headword}`}
          className="mt-2 flex w-full items-center gap-3 text-left"
        >
          <span className="selectable min-w-0 text-4xl font-black tracking-tight">
            {card.headword}
          </span>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-sunk text-ink-soft">
            <Volume2 className="size-5" />
          </span>
        </button>

        {card.ipa ? (
          <p className="mt-1.5 text-sm text-ink-soft">{card.ipa}</p>
        ) : null}

        {card.pending ? (
          <p className="mt-5 flex items-center gap-2 text-[1.0625rem] text-ink-faint">
            <Spinner /> Looking this one up…
          </p>
        ) : (
          <p className="selectable mt-5 text-[1.0625rem] leading-relaxed">
            {card.definition ?? 'No definition for this one yet.'}
          </p>
        )}

        {card.example ? (
          <p className="selectable mt-3 border-l-2 border-brand-300 pl-3 text-[0.9375rem] italic leading-relaxed text-ink-soft">
            {card.example}
          </p>
        ) : null}

        <div className="mt-7 flex gap-2">
          {mine ? (
            <ButtonLink
              to="/words/$wordId"
              params={{ wordId: card.wordId ?? '' }}
              tone="neutral"
              block
            >
              Open this word
            </ButtonLink>
          ) : mark === 'saved' ? (
            <Button tone="neutral" block disabled>
              <Check className="size-4" /> Saved
            </Button>
          ) : mark === 'known' ? (
            <Button tone="ghost" block disabled>
              Marked as known
            </Button>
          ) : (
            <>
              <Button onClick={onSave} block>
                <Plus className="size-4" /> Save
              </Button>
              <Button onClick={onDismiss} tone="neutral" className="shrink-0">
                Know it
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Only on the very first card: a feed that has to be scrolled should
          say so once, then never again. */}
      {first ? (
        <span className="absolute inset-x-0 bottom-5 grid place-items-center text-ink-faint">
          <ChevronsDown className="size-5 animate-bounce" />
        </span>
      ) : null}
    </article>
  )
}
