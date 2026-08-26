import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Check, ChevronLeft, RefreshCcw } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import { Button, Chip, Spinner } from '#/components/ui'
import type { RecommendedWord } from '#/lib/vocabulary'
import { addWord, getWordsPage, recommendWords } from '#/server/words'

export const Route = createFileRoute('/words/add')({
  loader: () => getWordsPage(),
  component: AddWordsPage,
})

function AddWordsPage() {
  const page = Route.useLoaderData()
  const router = useRouter()
  const [headword, setHeadword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recs, setRecs] = useState<RecommendedWord[]>([])
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')

  /**
   * Words accepted locally but not yet confirmed by the server. Adding a word
   * needs a dictionary lookup plus a model call, so waiting for the round trip
   * before updating the UI made filling a ten word lesson feel like a stall.
   */
  const [optimistic, setOptimistic] = useState<string[]>([])
  const [inFlight, setInFlight] = useState(0)
  const savedCount = useRef(0)

  const owned = useMemo(() => {
    const set = new Set(page.words.map((word) => word.headword.toLowerCase()))
    for (const word of optimistic) set.add(word.toLowerCase())
    return set
  }, [page.words, optimistic])

  const visible = recs.filter((item) => !owned.has(item.headword.toLowerCase()))

  const total = page.words.length + optimistic.length
  const target = page.settings.wordsPerLesson
  const remaining = Math.max(0, target - total)

  /** Identifies the newest ask, so a slower earlier one cannot answer it. */
  const asked = useRef(0)

  const load = useCallback(async () => {
    const id = (asked.current += 1)
    setStatus('loading')
    setError(null)
    try {
      // What has been shown is remembered on the server, so the ask carries
      // nothing: the next set differs from every earlier one, not just from
      // the one still on screen.
      const next = await recommendWords()
      if (asked.current !== id) return
      setRecs(next)
      setStatus('done')
    } catch {
      if (asked.current === id) setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, page.settings.cefrLevel])

  function save(value: string, source: 'manual' | 'recommendation') {
    const word = value.trim()
    if (!word || owned.has(word.toLowerCase())) return

    setError(null)
    setOptimistic((prev) => [...prev, word])
    setInFlight((count) => count + 1)
    if (source === 'manual') setHeadword('')

    void addWord({ data: { headword: word, source } })
      .then(() => {
        savedCount.current += 1
      })
      .catch((cause: unknown) => {
        // Put the chip back so the learner can see what failed and retry.
        setOptimistic((prev) => prev.filter((item) => item !== word))
        setError(
          cause instanceof Error
            ? `Could not add “${word}”: ${cause.message}`
            : `Could not add “${word}”`,
        )
      })
      .finally(() => {
        setInFlight((count) => count - 1)
      })
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    save(headword, 'manual')
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-20 flex items-center gap-1 border-b border-hairline bg-page/85 px-2 pb-2 backdrop-blur-xl">
        <Link
          to="/words"
          // Words are saved as they are tapped, so the list behind this screen
          // is out of date by the time anyone leaves it.
          onClick={() => void router.invalidate()}
          className="inline-flex size-11 items-center justify-center rounded-full active:bg-surface-sunk"
        >
          <ChevronLeft className="size-6" />
          <span className="sr-only">Back</span>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black">Add words</h1>
          <p className="text-xs text-ink-soft">
            {remaining > 0
              ? `${remaining} more to fill a lesson of ${target}`
              : `Enough for a lesson — ${total} saved`}
          </p>
        </div>
        {inFlight > 0 ? (
          <span className="pr-2 text-ink-faint">
            <Spinner />
          </span>
        ) : null}
      </header>

      <main className="flex-1 p-3.5 pb-8">
        <form onSubmit={onSubmit} className="mb-3.5 flex gap-2">
          <input
            value={headword}
            onChange={(event) => setHeadword(event.target.value)}
            placeholder="Type a word"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="done"
            className="min-h-11 flex-1 rounded-2xl border border-hairline-strong bg-surface px-4 text-base font-semibold"
          />
          <Button type="submit" disabled={headword.trim().length === 0}>
            Add
          </Button>
        </form>

        {error ? (
          <p className="mb-3 rounded-xl bg-brand-50 px-3 py-2 text-sm font-bold text-destructive">
            {error}
          </p>
        ) : null}

        {optimistic.length > 0 ? (
          <div className="mb-5 rounded-2xl bg-grass-100 px-4 py-3">
            <p className="text-sm font-extrabold text-grass-600">
              Added {optimistic.length} word{optimistic.length === 1 ? '' : 's'}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {optimistic.map((word) => (
                <li
                  key={word}
                  className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-bold"
                >
                  <Check className="size-3 text-grass-500" />
                  {word}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 font-extrabold">
              Recommended for {page.settings.cefrLevel}
            </h2>
            <Button
              tone="neutral"
              size="sm"
              onClick={() => void load()}
              disabled={status === 'loading'}
              className="shrink-0"
            >
              <RefreshCcw
                className={`size-3.5 ${status === 'loading' ? 'animate-spin' : ''}`}
              />
              New set
            </Button>
          </div>

          <p className="mt-2.5 text-xs text-ink-soft">
            Tap a word to save it. Every set is new — nothing you have already
            been offered comes back.
          </p>

          {status === 'loading' ? (
            <ul aria-busy className="mt-3 flex flex-wrap gap-2">
              {/* Chip-shaped placeholders: the list arrives in one piece, so
                  the row should not collapse and jump while it is written. */}
              {[14, 9, 11, 7, 13, 8, 10, 12].map((width, index) => (
                <li
                  key={index}
                  className="skeleton h-9 rounded-full"
                  style={{ width: `${width * 0.5}rem` }}
                />
              ))}
            </ul>
          ) : visible.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {visible.map((item) => (
                <li key={item.headword}>
                  <Chip onClick={() => save(item.headword, 'recommendation')}>
                    {item.headword}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-2xl border border-dashed border-hairline-strong px-4 py-6 text-sm text-ink-soft">
              {status === 'error'
                ? 'Suggestions could not be loaded. Try again, or type a word above.'
                : 'No suggestions left just now. Type your own above, or change your level in Settings.'}
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
