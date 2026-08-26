import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Check, RefreshCcw, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button, Card, Spinner } from '#/components/ui'
import { CEFR_LEVELS, type CefrLevel } from '#/lib/settings'
import { cn } from '#/lib/utils'
import {
  completeOnboarding,
  getOnboardingState,
  skipOnboarding,
  swapStarters,
} from '#/server/onboarding'

const LEVEL_BLURB: Record<CefrLevel, string> = {
  A2: 'Everyday basics',
  B1: 'Comfortable with simple articles',
  B2: 'Follows most news',
  C1: 'Reads freely, wants nuance',
  C2: 'Near-native, chasing precision',
}

export const Route = createFileRoute('/welcome')({
  loader: async () => {
    const state = await getOnboardingState()
    // Nothing to set up for someone who has already been through this.
    if (state.done) throw redirect({ to: '/' })
    return state
  },
  component: WelcomePage,
})

function WelcomePage() {
  const state = Route.useLoaderData()
  const router = useRouter()

  const [level, setLevel] = useState<CefrLevel>(state.cefrLevel)
  const [starters, setStarters] = useState(state.starters)
  const [swapping, setSwapping] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const picks = starters[level]

  async function onSwap() {
    setSwapping(true)
    try {
      const next = await swapStarters({ data: { cefrLevel: level } })
      setStarters((prev) => ({ ...prev, [level]: next }))
    } catch {
      // A worse set of words than the learner hoped for is not worth an error
      // message on the first screen of the app.
    } finally {
      setSwapping(false)
    }
  }

  async function onStart() {
    setPending(true)
    setError(null)
    try {
      await completeOnboarding({ data: { cefrLevel: level, headwords: picks } })
      await router.invalidate()
      await router.navigate({ to: '/' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save')
      setPending(false)
    }
  }

  async function onSkip() {
    setPending(true)
    try {
      await skipOnboarding()
      await router.invalidate()
      await router.navigate({ to: '/' })
    } catch {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="safe-top flex-1 space-y-3 p-3.5">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            What level are you?
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            It sets how hard your articles are. Change it any time in Settings.
          </p>
        </div>

        <ul className="space-y-1.5">
          {CEFR_LEVELS.map((item) => (
            <li key={item}>
              <button
                type="button"
                onClick={() => setLevel(item)}
                className={cn(
                  'btn-3d flex min-h-12 w-full items-center gap-3 rounded-2xl border px-3.5 text-left',
                  item === level
                    ? 'border-brand-700 bg-brand-500 text-white'
                    : 'border-hairline bg-surface',
                )}
              >
                <span className="w-7 font-black">{item}</span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm font-bold',
                    item === level ? 'text-white/85' : 'text-ink-soft',
                  )}
                >
                  {LEVEL_BLURB[item]}
                </span>
                {item === level ? (
                  <Check className="size-5 shrink-0" strokeWidth={3} />
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-extrabold">Your first {picks.length} words</h2>
              <p className="mt-0.5 text-xs text-ink-soft">
                A head start. You can add your own at any time.
              </p>
            </div>
            <Button
              tone="neutral"
              size="sm"
              className="shrink-0"
              disabled={swapping}
              onClick={() => void onSwap()}
            >
              <RefreshCcw className={cn('size-3.5', swapping && 'animate-spin')} />
              Swap
            </Button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {picks.map((headword) => (
              <li
                key={headword}
                className="inline-flex items-center gap-1 rounded-full bg-grass-100 px-2.5 py-1 text-sm font-bold text-grass-600"
              >
                <Check className="size-3.5" strokeWidth={3} />
                {headword}
              </li>
            ))}
          </ul>
        </Card>

        {error ? (
          <p className="text-sm font-bold text-destructive">{error}</p>
        ) : null}
      </main>

      <footer className="safe-bottom sticky bottom-0 space-y-1 border-t border-hairline bg-page/92 px-3.5 pt-2.5 backdrop-blur-xl">
        <Button block size="lg" disabled={pending} onClick={onStart}>
          {pending ? (
            <>
              <Spinner /> Setting up…
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Start learning
            </>
          )}
        </Button>
        {/* No longer a dead end: a lesson can be written without any words,
            and the article's own vocabulary is offered at the end of it. */}
        <button
          type="button"
          onClick={onSkip}
          disabled={pending}
          className="min-h-10 w-full text-sm font-bold text-ink-faint"
        >
          Start with an empty list
        </button>
      </footer>
    </div>
  )
}
