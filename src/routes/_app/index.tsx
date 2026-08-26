import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Flame,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { PageHeader } from '#/components/bottom-nav'
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ProgressRing,
} from '#/components/ui'
import { shiftDate } from '#/lib/day'
import { getHomeSnapshot } from '#/server/home'
import {
  createLesson,
  deleteLesson,
  retryLesson,
  type LessonSummary,
} from '#/server/lessons'

export const Route = createFileRoute('/_app/')({
  loader: () => getHomeSnapshot(),
  component: HomePage,
})

/** Steps in a lesson, and so the denominator of the daily goal ring. */
const GOAL_STEPS = 4

function statusLabel(status: string) {
  if (status === 'ready') return 'Ready'
  if (status === 'in_progress') return 'In progress'
  if (status === 'generating') return 'Writing'
  if (status === 'failed') return 'Failed'
  if (status === 'completed') return 'Done'
  return status
}

/**
 * Both dates are already the learner's own calendar days, so this is a plain
 * string comparison. Formatting is pinned to UTC and a fixed locale so the
 * label cannot differ between the Worker that renders it and the browser that
 * hydrates it.
 */
function dayLabel(date: string, today: string) {
  if (date === today) return 'Today'
  if (date === shiftDate(today, -1)) return 'Yesterday'
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function groupByDay(history: LessonSummary[], today: string) {
  const groups: Array<{ label: string; items: LessonSummary[] }> = []
  for (const lesson of history) {
    const label = dayLabel(lesson.localDate, today)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(lesson)
    else groups.push({ label, items: [lesson] })
  }
  return groups
}

function HomePage() {
  const snapshot = Route.useLoaderData()
  const {
    today,
    wordCount,
    streak,
    todayDone,
    settings,
    activeLesson,
    history,
  } = snapshot
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generating = history.some((lesson) => lesson.status === 'generating')

  useEffect(() => {
    if (!generating) return
    const timer = window.setInterval(() => {
      void router.invalidate()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [generating, router])

  async function onStart(options: { replace?: boolean } = {}) {
    setPending(true)
    setError(null)
    try {
      const result = await createLesson({ data: options })
      await router.invalidate()
      await router.navigate({
        to: '/lessons/$lessonId',
        params: { lessonId: result.lessonId },
        search: { s: 0 },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start lesson')
      setPending(false)
    }
  }

  async function onRetry(lessonId: string) {
    setPending(true)
    setError(null)
    try {
      await retryLesson({ data: { lessonId } })
      await router.invalidate()
      await router.navigate({
        to: '/lessons/$lessonId',
        params: { lessonId },
        search: { s: 0 },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not retry lesson')
      setPending(false)
    }
  }

  async function onDelete(lessonId: string) {
    if (!window.confirm('Delete this lesson?')) return
    setPending(true)
    setError(null)
    try {
      await deleteLesson({ data: { lessonId } })
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete lesson')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Today"
        trailing={
          <div
            className="flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-brand-700"
            title={`${streak} day streak`}
          >
            <Flame
              className={`size-4 ${streak > 0 ? 'animate-flame' : 'opacity-40'}`}
              fill={streak > 0 ? 'currentColor' : 'none'}
            />
            <span className="tabular text-sm font-black">{streak}</span>
          </div>
        }
      />

      <main className="space-y-3 p-3.5 pb-8">
        <Card className="animate-rise-in flex items-center gap-3.5">
          {/* Always the same scale — steps of today's lesson — so the number
              never silently changes what it counts. */}
          <ProgressRing
            value={todayDone ? GOAL_STEPS : (activeLesson?.doneSteps ?? 0)}
            max={GOAL_STEPS}
            tone={todayDone ? 'grass' : 'brand'}
          >
            <span className="text-lg font-black">
              {todayDone ? '✓' : `${activeLesson?.doneSteps ?? 0}/${GOAL_STEPS}`}
            </span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <p className="kicker">Daily goal</p>
            <p className="mt-0.5 text-lg font-black leading-tight">
              {todayDone
                ? 'Lesson done. Nice.'
                : activeLesson
                  ? 'Pick up where you left off'
                  : 'One lesson today'}
            </p>
            <p className="mt-0.5 text-sm text-ink-soft">
              {todayDone
                ? `${streak} day${streak === 1 ? '' : 's'} in a row.`
                : streak > 0
                  ? `Keep your ${streak} day streak alive.`
                  : 'Finish a lesson to start a streak.'}
            </p>
          </div>
        </Card>

        <Card className="animate-rise-in">
          <p className="kicker">
            {todayDone ? 'Extra practice' : "Today's lesson"}
          </p>
          {activeLesson ? (
            <>
              <h2 className="mt-2 text-xl font-black leading-tight">
                {activeLesson.title ??
                  (activeLesson.status === 'generating'
                    ? 'Writing your article…'
                    : statusLabel(activeLesson.status))}
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                {activeLesson.status === 'generating'
                  ? `Built from ${activeLesson.wordCount} of your words.`
                  : `${statusLabel(activeLesson.status)} · ${activeLesson.doneSteps}/${GOAL_STEPS} steps · ${activeLesson.wordCount} words`}
              </p>
              <ButtonLink
                to="/lessons/$lessonId"
                params={{ lessonId: activeLesson.id }}
                search={{ s: 0 }}
                block
                size="lg"
                className="mt-3"
              >
                {activeLesson.status === 'generating'
                  ? 'Open lesson'
                  : activeLesson.doneSteps > 0
                    ? 'Continue'
                    : 'Start'}
              </ButtonLink>
              {/* Only once there is something to judge: mid-generation the
                  article does not exist yet, so there is nothing to reject. */}
              {activeLesson.status !== 'generating' ? (
                <Button
                  tone="ghost"
                  size="sm"
                  block
                  className="mt-1"
                  disabled={pending}
                  onClick={() => onStart({ replace: true })}
                >
                  {pending ? 'Writing…' : 'Write a different one'}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <h2 className="mt-2 text-xl font-black leading-tight">
                {todayDone ? 'Want another round?' : 'Ready when you are'}
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                {todayDone
                  ? 'Today is already done. An extra lesson is just for the practice.'
                  : wordCount === 0
                    ? `An article at your level, then ${GOAL_STEPS} steps. Keep whatever words you like from it.`
                    : `We'll write one article using ${Math.min(
                        wordCount,
                        settings.wordsPerLesson,
                      )} of your words, then walk you through ${GOAL_STEPS} steps.`}
              </p>
              <Button
                tone={todayDone ? 'neutral' : 'brand'}
                block
                size="lg"
                className="mt-3"
                disabled={pending}
                onClick={() => onStart()}
              >
                {pending
                  ? 'Starting…'
                  : todayDone
                    ? 'Start another lesson'
                    : 'Start a lesson'}
              </Button>
              {/* A short list is no longer a blocker, so this is an offer
                  rather than the only way forward. */}
              {wordCount < settings.wordsPerLesson ? (
                <ButtonLink
                  to="/words/add"
                  tone="ghost"
                  size="sm"
                  block
                  className="mt-1"
                >
                  <Plus className="size-4" />
                  {wordCount === 0 ? 'Add your first words' : 'Add more words'}
                </ButtonLink>
              ) : null}
            </>
          )}
          {error ? (
            <p className="mt-3 text-sm font-bold text-destructive">{error}</p>
          ) : null}
        </Card>

        <section>
          <h2 className="kicker mb-1.5 px-1">History</h2>
          {history.length === 0 ? (
            <EmptyState
              title="No lessons yet"
              body="Finished lessons collect here, grouped by day."
            />
          ) : (
            <div className="space-y-4">
              {groupByDay(history, today).map((group) => (
                <div key={group.label}>
                  <h3 className="mb-1.5 px-1 text-xs font-extrabold uppercase tracking-wider text-ink-faint">
                    {group.label}
                  </h3>
                  <ul className="space-y-1.5">
                    {group.items.map((lesson) => (
                      <li key={lesson.id} className="card-soft overflow-hidden">
                        <Link
                          to="/lessons/$lessonId"
                          params={{ lessonId: lesson.id }}
                          search={{ s: 0 }}
                          className="flex items-center gap-3 px-3.5 py-2.5"
                        >
                          <span
                            className={`grid size-9 shrink-0 place-items-center rounded-xl text-xs font-black ${
                              lesson.status === 'completed'
                                ? 'bg-grass-100 text-grass-600'
                                : lesson.status === 'failed'
                                  ? 'bg-brand-50 text-destructive'
                                  : 'bg-surface-sunk text-ink-soft'
                            }`}
                          >
                            {lesson.status === 'failed' ? (
                              <AlertTriangle className="size-4" />
                            ) : lesson.status === 'completed' ? (
                              // A tick rather than a count: lessons finished
                              // before the fourth step existed only ever
                              // stamped three, and "3/4" reads as unfinished.
                              <Check className="size-4" strokeWidth={3} />
                            ) : (
                              `${lesson.doneSteps}/${GOAL_STEPS}`
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-extrabold">
                              {lesson.title ??
                                (lesson.status === 'generating'
                                  ? 'Writing your article…'
                                  : statusLabel(lesson.status))}
                            </span>
                            <span className="block text-xs text-ink-soft">
                              {statusLabel(lesson.status)} · {lesson.wordCount}{' '}
                              words
                            </span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-ink-faint" />
                        </Link>
                        {lesson.status === 'failed' ? (
                          <div className="border-t border-hairline bg-surface-sunk px-4 py-3">
                            <p className="text-sm text-ink-soft">
                              {lesson.failureReason ??
                                'This lesson could not be written.'}
                            </p>
                            <div className="mt-2 flex gap-2">
                              <Button
                                size="sm"
                                className="flex-1"
                                disabled={pending}
                                onClick={() => onRetry(lesson.id)}
                              >
                                Retry
                              </Button>
                              <Button
                                tone="neutral"
                                size="sm"
                                disabled={pending}
                                onClick={() => onDelete(lesson.id)}
                                aria-label="Delete lesson"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  )
}
