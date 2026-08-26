import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Check, Copy, LogOut, Minus, Moon, Plus, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { PageHeader } from '#/components/bottom-nav'
import { Button, Card, Chip, Spinner } from '#/components/ui'
import { CEFR_LEVELS, TOPIC_PRESETS, type CefrLevel } from '#/lib/settings'
import { cn } from '#/lib/utils'
import { getAccount, signOut, type AccountSnapshot } from '#/server/auth'
import { getSettings, saveSettings } from '#/server/settings'

export const Route = createFileRoute('/_app/settings')({
  loader: async () => {
    const [settings, account] = await Promise.all([getSettings(), getAccount()])
    return { settings, account }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { settings: initial, account } = Route.useLoaderData()
  const [cefrLevel, setCefrLevel] = useState<CefrLevel>(initial.cefrLevel)
  const [topics, setTopics] = useState<string[]>(initial.topics)
  const [customTopic, setCustomTopic] = useState('')
  const [wordsPerLesson, setWordsPerLesson] = useState(initial.wordsPerLesson)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const current = `${cefrLevel}|${wordsPerLesson}|${topics.join(',')}`
  /** What the server is known to hold, so a save only fires on real change. */
  const stored = useRef(current)

  /*
   * Settings save themselves. The debounce is what makes that affordable:
   * holding the stepper or picking three topics in a row is one write, not
   * one per tap.
   */
  useEffect(() => {
    if (current === stored.current) return
    const timer = window.setTimeout(async () => {
      setSaveState('saving')
      setError(null)
      try {
        await saveSettings({ data: { cefrLevel, topics, wordsPerLesson } })
        stored.current = current
        setSaveState('saved')
      } catch (cause) {
        setSaveState('idle')
        setError(cause instanceof Error ? cause.message : 'Could not save')
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [current])

  useEffect(() => {
    if (saveState !== 'saved') return
    const timer = window.setTimeout(() => setSaveState('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [saveState])

  function toggleTopic(topic: string) {
    setTopics((current) =>
      current.includes(topic)
        ? current.filter((item) => item !== topic)
        : [...current, topic].slice(0, 12),
    )
  }

  function addCustomTopic() {
    const topic = customTopic.trim().toLowerCase()
    if (!topic) return
    setTopics((current) =>
      current.includes(topic) ? current : [...current, topic].slice(0, 12),
    )
    setCustomTopic('')
  }

  const customTopics = topics.filter(
    (topic) => !TOPIC_PRESETS.includes(topic as (typeof TOPIC_PRESETS)[number]),
  )

  return (
    <>
      <PageHeader
        title="You"
        description="Settings and account"
        trailing={
          saveState === 'saving' ? (
            <span className="flex items-center gap-1.5 text-xs font-bold text-ink-faint">
              <Spinner /> Saving
            </span>
          ) : saveState === 'saved' ? (
            <span className="flex items-center gap-1.5 text-xs font-bold text-grass-600">
              <Check className="size-3.5" strokeWidth={3} /> Saved
            </span>
          ) : null
        }
      />

      <div className="space-y-3 p-3.5">
        <Card>
          <h2 className="font-extrabold">English level</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Sets article difficulty and length.
          </p>
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {CEFR_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setCefrLevel(level)}
                className={cn(
                  'btn-3d min-h-10 rounded-xl border text-sm font-black',
                  level === cefrLevel
                    ? 'border-brand-700 bg-brand-500 text-white'
                    : 'border-hairline bg-surface',
                )}
              >
                {level}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="font-extrabold">Topics</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            These steer both the article and your recommended words.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...TOPIC_PRESETS, ...customTopics].map((topic) => {
              const on = topics.includes(topic)
              return (
                <Chip
                  key={topic}
                  tone={on ? 'brand' : 'default'}
                  onClick={() => toggleTopic(topic)}
                >
                  {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                  {topic}
                </Chip>
              )
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={customTopic}
              onChange={(event) => setCustomTopic(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addCustomTopic()
                }
              }}
              placeholder="Add your own topic"
              className="min-h-10 flex-1 rounded-2xl border border-hairline-strong bg-surface px-4 text-base font-semibold"
            />
            <Button tone="neutral" size="sm" onClick={addCustomTopic}>
              Add
            </Button>
          </div>
        </Card>

        <Card className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-extrabold">Words per lesson</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              How many of your words each article works in.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-sunk p-1">
            <button
              type="button"
              aria-label="Fewer words"
              disabled={wordsPerLesson <= 4}
              onClick={() => setWordsPerLesson((value) => Math.max(4, value - 1))}
              className="grid size-8 place-items-center rounded-full text-ink-soft active:bg-hairline disabled:opacity-35"
            >
              <Minus className="size-4" strokeWidth={3} />
            </button>
            <span className="tabular w-6 text-center font-black">
              {wordsPerLesson}
            </span>
            <button
              type="button"
              aria-label="More words"
              disabled={wordsPerLesson >= 20}
              onClick={() =>
                setWordsPerLesson((value) => Math.min(20, value + 1))
              }
              className="grid size-8 place-items-center rounded-full text-ink-soft active:bg-hairline disabled:opacity-35"
            >
              <Plus className="size-4" strokeWidth={3} />
            </button>
          </div>
        </Card>

        {error ? (
          <p className="text-center text-sm font-bold text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 px-3.5 pb-8">
        <ThemeCard />
        <AccountSection account={account} />
      </div>
    </>
  )
}

function ThemeCard() {
  const [dark, setDark] = useState(false)

  // Read the class applied by the pre-paint bootstrap rather than storage, so
  // the toggle reflects the system default on a first visit too.
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  function apply(next: boolean) {
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', next ? '#16120f' : '#fff8f2')
  }

  return (
    <Card className="flex items-center gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-sunk text-ink-soft">
        {dark ? <Moon className="size-5" /> : <Sun className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold">Appearance</p>
        <p className="text-xs text-ink-soft">
          {dark ? 'Dark' : 'Light'} theme on this device
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label="Dark mode"
        onClick={() => apply(!dark)}
        className={cn(
          'relative h-8 w-14 shrink-0 rounded-full transition-colors',
          dark ? 'bg-brand-500' : 'bg-hairline-strong',
        )}
      >
        {/* Anchored with `left`, since an absolute child with `left: auto`
            inherits the button's centred static position. */}
        <span
          className={cn(
            'absolute left-1 top-1 size-6 rounded-full bg-white shadow-sm transition-transform',
            dark ? 'translate-x-6' : 'translate-x-0',
          )}
        />
      </button>
    </Card>
  )
}

/**
 * A guest has no email to recognise them by, so the session id is the only
 * handle they can quote when something goes wrong.
 */
function IdRow({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(userId)
      setCopied(true)
    } catch {
      // Clipboard is blocked in some browsers; the id is still readable.
    }
  }

  return (
    <div className="mt-2.5 flex items-center gap-2">
      <span className="kicker">Account ID</span>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface-sunk px-2.5 font-mono text-xs text-ink-soft active:bg-hairline"
      >
        {userId.slice(0, 8)}
        {copied ? (
          <Check className="size-3.5 text-grass-500" strokeWidth={3} />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  )
}

function AccountSection({ account }: { account: AccountSnapshot }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSignOut() {
    setPending(true)
    setError(null)
    try {
      await signOut()
      await router.invalidate()
      await router.navigate({ to: '/' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out')
      setPending(false)
    }
  }

  return (
    <Card>
      <h2 className="font-extrabold">Account</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {account.email
          ? `Signed in as ${account.email}.`
          : 'Signed in with Gmail.'}
      </p>

      <IdRow userId={account.userId} />

      {error ? (
        <p className="mt-3 text-sm font-bold text-destructive">{error}</p>
      ) : null}

      <div className="mt-4">
        <Button tone="neutral" block disabled={pending} onClick={onSignOut}>
          <LogOut className="size-4" />
          {pending ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </Card>
  )
}
