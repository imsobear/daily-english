import { Check, Plus, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, Spinner } from '#/components/ui'
import { glossWord, type Gloss } from '#/server/gloss'
import { addWord } from '#/server/words'

/**
 * Bottom sheet shown when a learner taps a word inside the article.
 *
 * The same card as the Explore feed — headword, pronunciation, a box per sense
 * with its Chinese beside the definition — so a word looks the same wherever
 * it is met.
 * What the article adds is the sentence it was tapped in, spoken aloud.
 *
 * The lookup happens on demand rather than up front — glossing every word of
 * every article would be a large cost for something most words never need.
 */
export function GlossSheet({
  headword,
  onPlaySentence,
  onClose,
}: {
  headword: string | null
  onPlaySentence?: () => void
  onClose: () => void
}) {
  const [gloss, setGloss] = useState<Gloss | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wordAudio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!headword) return
    let cancelled = false
    setLoading(true)
    setGloss(null)
    setSaved(false)
    setError(null)

    void glossWord({ data: { headword } })
      .then((result) => {
        if (cancelled) return
        setGloss(result)
        setSaved(result.saved)
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not look that word up.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [headword])

  // The word is spoken by an endpoint that synthesises on first play, so the
  // element is made here rather than rendered: nothing to show, and reusing
  // one keeps a fast second tap from stacking voices.
  useEffect(() => {
    return () => {
      wordAudio.current?.pause()
      wordAudio.current = null
    }
  }, [])

  function speak() {
    if (!gloss) return
    const element = (wordAudio.current ??= new Audio())
    if (element.src !== new URL(gloss.audioUrl, location.href).href) {
      element.src = gloss.audioUrl
    }
    element.currentTime = 0
    void element.play().catch(() => undefined)
  }

  async function onSave() {
    if (!gloss) return
    setSaving(true)
    try {
      await addWord({ data: { headword: gloss.headword, source: 'manual' } })
      setSaved(true)
    } catch {
      setError('Could not save that word.')
    } finally {
      setSaving(false)
    }
  }

  if (!headword) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
      />
      <div className="animate-pop-in relative mx-auto max-h-[85svh] w-full max-w-[26rem] overflow-y-auto rounded-t-3xl border-t border-hairline bg-surface p-4 pb-7 shadow-pop">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hairline-strong" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-ink-faint active:bg-surface-sunk"
        >
          <X className="size-4" />
        </button>

        {/* The looked-up form, which is the dictionary's rather than the
            article's: tapping "revealed" asks about "reveal". */}
        <button
          type="button"
          onClick={speak}
          disabled={!gloss}
          aria-label={`Hear ${gloss?.headword ?? headword}`}
          className="flex w-full items-center gap-2 pr-9 text-left disabled:opacity-60"
        >
          <span className="selectable min-w-0 text-[1.75rem] font-black leading-none tracking-tight">
            {gloss?.headword ?? headword}
          </span>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-sunk text-ink-soft">
            <Volume2 className="size-4" />
          </span>
        </button>

        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
          {gloss?.ipa ? <span className="selectable">{gloss.ipa}</span> : null}
          {/* The sentence is behind the sheet and already read, so this is the
              speaker and nothing else — the article says the rest. */}
          {onPlaySentence ? (
            <button
              type="button"
              onClick={onPlaySentence}
              className="flex items-center gap-1 rounded-full border border-hairline px-2 py-px text-[0.6875rem] font-bold text-ink-faint"
            >
              <Volume2 className="size-3" /> Sentence
            </button>
          ) : null}
        </p>

        {loading ? (
          <p className="mt-3.5 flex items-center gap-2 text-sm text-ink-soft">
            <Spinner /> Looking it up…
          </p>
        ) : error ? (
          <p className="mt-3.5 text-sm font-bold text-destructive">{error}</p>
        ) : gloss ? (
          <>
            {gloss.senses.length === 0 ? (
              <p className="mt-3.5 text-sm leading-snug text-ink-soft">
                No definition for this one yet.
              </p>
            ) : (
              <ul className="mt-3.5 space-y-2">
                {gloss.senses.map((sense, index) => (
                  <li
                    key={`${sense.pos}-${index}`}
                    className="card-soft px-3.5 py-2.5"
                  >
                    {/* The Chinese shares the line with the definition, as on
                        a feed card: it is the word rather than the definition
                        said again, and somebody who tapped mid-article wants
                        it at a glance. */}
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

            <Button
              block
              tone={saved ? 'neutral' : 'brand'}
              className="mt-4"
              disabled={saved || saving || gloss.senses.length === 0}
              onClick={onSave}
            >
              {saved ? (
                <>
                  <Check className="size-4" /> In your words
                </>
              ) : saving ? (
                'Saving…'
              ) : (
                <>
                  <Plus className="size-4" /> Add to my words
                </>
              )}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
