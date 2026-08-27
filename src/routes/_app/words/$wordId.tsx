import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { ChevronLeft, Trash2, Volume2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button, Card, ProgressRing, Spinner } from '#/components/ui'
import { deleteWord, getWord, refreshWord } from '#/server/words'

export const Route = createFileRoute('/_app/words/$wordId')({
  loader: async ({ params }) => {
    const word = await getWord({ data: { wordId: params.wordId } })
    if (!word) throw notFound()
    return word
  },
  component: WordCardPage,
})

function WordCardPage() {
  const word = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [speaking, setSpeaking] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)

  async function onSpeak() {
    const audio = audioRef.current
    if (!audio) return
    setAudioFailed(false)
    // The first play waits on synthesis, so the button has to show progress.
    setSpeaking(true)
    try {
      audio.currentTime = 0
      await audio.play()
    } catch {
      setAudioFailed(true)
    } finally {
      setSpeaking(false)
    }
  }

  async function onRefresh() {
    setPending(true)
    setError(null)
    try {
      await refreshWord({ data: { wordId: word.id } })
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not look up word')
    } finally {
      setPending(false)
    }
  }

  async function onDelete() {
    if (!window.confirm(`Remove “${word.headword}”?`)) return
    setPending(true)
    try {
      await deleteWord({ data: { wordId: word.id } })
      await router.navigate({ to: '/words' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete word')
      setPending(false)
    }
  }

  const percent = Math.round(word.familiarity * 100)

  return (
    <div className="flex min-h-full flex-col">
      <header className="safe-top sticky top-0 z-20 flex items-center gap-1 border-b border-hairline bg-page/85 px-2 pb-2 backdrop-blur-xl">
        <Link
          to="/words"
          className="inline-flex size-11 items-center justify-center rounded-full active:bg-surface-sunk"
        >
          <ChevronLeft className="size-6" />
          <span className="sr-only">Back</span>
        </Link>
        <h1 className="flex-1 font-extrabold">Word</h1>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          aria-label="Delete word"
          className="grid size-11 place-items-center rounded-full text-ink-faint active:bg-surface-sunk disabled:opacity-50"
        >
          <Trash2 className="size-4" />
        </button>
      </header>

      <main className="space-y-3 p-3.5 pb-8">
        <Card className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-black tracking-tight">
              {word.headword}
            </h2>
            <div className="mt-0.5 flex items-center gap-1">
              {word.ipa ? (
                <p className="truncate text-sm text-ink-soft">{word.ipa}</p>
              ) : null}
              <audio
                ref={audioRef}
                src={word.audioUrl}
                preload="none"
                className="hidden"
                onError={() => setAudioFailed(true)}
              />
              <button
                type="button"
                onClick={() => void onSpeak()}
                disabled={speaking}
                aria-label="Hear it"
                className="grid size-8 shrink-0 place-items-center rounded-full text-ink-soft active:bg-hairline disabled:opacity-40"
              >
                {speaking ? (
                  <Spinner className="size-4" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </button>
            </div>
            <p className="kicker mt-1">
              {word.source === 'recommendation' ? 'Recommended' : 'Added by you'}
            </p>
            {audioFailed ? (
              <p className="mt-1 text-xs text-ink-faint">
                Audio is unavailable right now.
              </p>
            ) : null}
          </div>
          <ProgressRing
            value={percent}
            max={100}
            size={60}
            stroke={7}
            tone={word.familiarity >= 0.8 ? 'grass' : 'brand'}
          >
            <span className="tabular text-xs font-black">{percent}%</span>
          </ProgressRing>
        </Card>

        {error ? (
          <p className="text-sm font-bold text-destructive">{error}</p>
        ) : null}

        {word.dictionaryMiss ? (
          <Card>
            <p className="text-sm text-ink-soft">
              No definition yet. The word is still saved and will appear in
              lessons.
            </p>
            <Button block className="mt-3" onClick={onRefresh} disabled={pending}>
              {pending ? 'Looking up…' : 'Look up again'}
            </Button>
          </Card>
        ) : (
          <>
            {/*
              No pattern here, deliberately. It belongs on the feed, where a
              card is glanced at and a definition is not enough to use the
              word. This page is what you open when you want the whole entry,
              and every sense below already carries a sentence.
            */}
            <section>
              <h3 className="kicker mb-2 px-1">Meanings</h3>
              <ul className="space-y-1.5">
                {word.senses.map((sense, index) => (
                  <li
                    key={`${sense.pos}-${index}`}
                    className="card-soft px-3.5 py-2.5"
                  >
                    {/* The Chinese is the word, not the definition said
                        again, so it shares the line with it — as on a feed
                        card and in the sheet over an article. */}
                    <p className="text-[0.9375rem] leading-snug">
                      {sense.pos ? (
                        <span className="kicker mr-1.5 inline">
                          {sense.pos}{' '}
                        </span>
                      ) : null}
                      {sense.zh ? (
                        <span className="mr-1.5 font-bold">{sense.zh}</span>
                      ) : null}
                      {sense.definition}
                    </p>
                    {sense.examples.map((example) => (
                      <p
                        key={example}
                        className="mt-1 text-sm italic leading-snug text-ink-soft"
                      >
                        {example}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </section>

            {word.collocations.length > 0 ? (
              <section>
                <h3 className="kicker mb-2 px-1">Goes with</h3>
                <ul className="flex flex-wrap gap-2">
                  {word.collocations.map((phrase) => (
                    <li
                      key={phrase}
                      className="rounded-full border border-hairline px-3 py-1.5 text-[0.9375rem] font-bold text-ink-soft"
                    >
                      {phrase}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {word.family.length > 0 ? (
              <section>
                <h3 className="kicker mb-2 px-1">Same family</h3>
                <ul className="space-y-1.5">
                  {word.family.map((relative) => (
                    <li
                      key={relative.word}
                      className="flex items-baseline gap-2 rounded-2xl bg-surface-sunk px-4 py-2.5"
                    >
                      <span className="text-[1.0625rem] font-bold">
                        {relative.word}
                      </span>
                      <span className="kicker">{relative.pos}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
