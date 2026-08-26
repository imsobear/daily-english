import { Check, Plus, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, Spinner } from '#/components/ui'
import { glossWord, type Gloss } from '#/server/gloss'
import { addWord } from '#/server/words'

/**
 * Bottom sheet shown when a learner taps a word inside the article.
 *
 * The lookup happens on demand rather than up front — glossing every word of
 * every article would be a large cost for something most words never need.
 */
export function GlossSheet({
  headword,
  sentence,
  onPlaySentence,
  onClose,
}: {
  headword: string | null
  /** The article sentence the word was tapped in, if it came from one. */
  sentence?: string | null
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
      <div className="animate-pop-in relative mx-auto w-full max-w-[26rem] rounded-t-3xl border-t border-hairline bg-surface p-5 pb-8 shadow-pop">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline-strong" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-ink-faint active:bg-surface-sunk"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-center gap-2 pr-9">
          {/* The looked-up form, which is the dictionary's rather than the
              article's: tapping "revealed" asks about "reveal". */}
          <h2 className="selectable min-w-0 flex-1 text-2xl font-black tracking-tight">
            {gloss?.headword ?? headword}
          </h2>
          <button
            type="button"
            onClick={speak}
            disabled={!gloss}
            aria-label={`Hear ${gloss?.headword ?? headword}`}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-sunk text-ink-soft active:bg-hairline disabled:opacity-40"
          >
            <Volume2 className="size-5" />
          </button>
        </div>

        {loading ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <Spinner /> Looking it up…
          </p>
        ) : error ? (
          <p className="mt-3 text-sm font-bold text-destructive">{error}</p>
        ) : gloss ? (
          <>
            {gloss.ipa ? (
              <p className="selectable mt-1 text-sm text-ink-soft">
                {gloss.ipa}
              </p>
            ) : null}
            {gloss.partOfSpeech ? (
              <span className="mt-2 inline-block rounded-full bg-surface-sunk px-2.5 py-0.5 text-[0.6875rem] font-black uppercase tracking-wider text-ink-soft">
                {gloss.partOfSpeech}
              </span>
            ) : null}
            <p className="selectable mt-3 text-[1.0625rem] leading-relaxed">
              {gloss.definition ?? 'No definition found for this word.'}
            </p>
            {gloss.example ? (
              <p className="selectable mt-2 border-l-2 border-brand-300 pl-3 text-sm italic text-ink-soft">
                {gloss.example}
              </p>
            ) : null}

            {sentence && onPlaySentence ? (
              <button
                type="button"
                onClick={onPlaySentence}
                className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-surface-sunk px-3.5 py-2.5 text-left active:bg-hairline"
              >
                <Volume2 className="size-5 shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="kicker block">In the article</span>
                  <span className="mt-0.5 line-clamp-2 block text-sm leading-snug text-ink-soft">
                    {sentence}
                  </span>
                </span>
              </button>
            ) : null}

            <Button
              block
              size="lg"
              tone={saved ? 'neutral' : 'brand'}
              className="mt-5"
              disabled={saved || saving || !gloss.definition}
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
