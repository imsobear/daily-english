import {
  Link,
  createFileRoute,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Ear,
  Eye,
  Headphones,
  Lightbulb,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { AudioPlayer, type PlayerHandle } from '#/components/lesson/audio-player'
import { GlossSheet } from '#/components/lesson/gloss-sheet'
import { Reader } from '#/components/lesson/reader'
import { Button, ButtonLink, Card, Spinner } from '#/components/ui'
import { localToday } from '#/lib/day'
import type { ArticleSuggestion } from '#/lib/suggestions'
import { baseForm, findSentenceWith, wordPattern } from '#/lib/text'
import { cn } from '#/lib/utils'
import {
  completeStep,
  getLesson,
  retryLesson,
  retryLessonAudio,
  type LessonArticle,
} from '#/server/lessons'
import { addWord } from '#/server/words'

/**
 * Hear it in parts, read it, then listen again to the whole article.
 * The first listen reveals each part in writing as soon as it has played, so
 * the third step is the only pass where speech has to carry the meaning on its
 * own — and by then the meaning is known, which is what makes it worth doing.
 */
const STEPS = [
  { id: 0, label: 'Listen', icon: Ear },
  { id: 1, label: 'Read', icon: Eye },
  { id: 2, label: 'Listen again', icon: Headphones },
  { id: 3, label: 'Recall', icon: Lightbulb },
] as const

const LAST_STEP = STEPS.length - 1

/** The whole article, heard once more. Known words at speed is the exercise. */
const FULL_LISTEN_STEP = 2
const FULL_LISTEN_SPEED = 1.25

const STAGE_ORDER = ['writing', 'speaking', 'saving'] as const

type Search = { s: number }

export const Route = createFileRoute('/lessons/$lessonId')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    s: Math.max(0, Number(search.s) || 0),
  }),
  loader: async ({ params }) => {
    const lesson = await getLesson({ data: { lessonId: params.lessonId } })
    if (!lesson) throw notFound()
    return lesson
  },
  component: LessonPage,
})

function stepsDone(article: LessonArticle) {
  return [
    article.steps.blindListen,
    article.steps.listenRead,
    article.steps.fullListen,
    article.steps.explain,
  ]
}

function currentUnlocked(article: LessonArticle) {
  const done = stepsDone(article)
  const next = done.findIndex((finished) => !finished)
  return next < 0 ? LAST_STEP : next
}

function isStepDone(article: LessonArticle, step: number) {
  return stepsDone(article)[step] ?? false
}

function LessonPage() {
  const lesson = Route.useLoaderData()
  const { s } = Route.useSearch()
  const router = useRouter()

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [heard, setHeard] = useState(false)
  const [activeSentence, setActiveSentence] = useState<number | null>(null)
  /** The word the gloss card is open on, and where in the article it was. */
  const [tapped, setTapped] = useState<{
    word: string
    sentence: number
  } | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  /** The listen-again pass, with the text shown anyway because it was too hard. */
  const [peeking, setPeeking] = useState(false)
  /** The recall quiz: which question is on screen, and what was picked where. */
  const [quizIndex, setQuizIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  /** How many leading clips the listening step has played, and so may show. */
  const [heardClips, setHeardClips] = useState(0)
  /** null when idle, 'working' while synthesising, else a message to show. */
  const [audioRetry, setAudioRetry] = useState<string | null>(null)
  /** Set the moment the last step lands, holding what to offer next. */
  const [finished, setFinished] = useState<ArticleSuggestion[] | null>(null)
  /** Seconds spent generating, shown while the learner waits. */
  const [elapsed, setElapsed] = useState(0)
  const playerRef = useRef<PlayerHandle>(null)

  const article = lesson.article
  const unlocked = article ? currentUnlocked(article) : 0
  const step = article ? Math.min(s, unlocked) : 0
  const targets = lesson.words.map((word) => word.headword)
  const quiz = lesson.quiz
  const picked = answers[quizIndex] ?? null
  const answeredCount = Object.keys(answers).length

  useEffect(() => {
    if (lesson.status !== 'generating') return
    const timer = window.setInterval(() => void router.invalidate(), 2500)
    return () => window.clearInterval(timer)
  }, [lesson.status, router])

  // Counts up from when the lesson was queued, so a reload keeps the real
  // total rather than restarting the clock. Starts at 0 to match the server
  // render, then corrects on the first tick.
  useEffect(() => {
    if (lesson.status !== 'generating') return
    const started = new Date(lesson.createdAt).getTime()
    const tick = () =>
      setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [lesson.status, lesson.createdAt])

  useEffect(() => {
    setHeard(false)
    setActiveSentence(null)
    setHeardClips(0)
    setPeeking(false)
    setQuizIndex(0)
    setAnswers({})
  }, [article?.id, step])

  /**
   * The article inflects the words it was built from, and a card about the
   * past tense of a word is not what was asked for. The lesson's own targets
   * settle most taps here, before the round trip; the server works the rest
   * out against words it can confirm exist.
   */
  function onWordTap(word: string, sentence: number) {
    setTapped({ word: baseForm(word, targets), sentence })
  }

  async function onRetryAudio() {
    setAudioRetry('working')
    try {
      await retryLessonAudio({ data: { lessonId: lesson.id } })
      // Whether audio arrived or the allowance is still spent, the freshly
      // stored note is the single source of truth. Reload rather than echo it.
      setAudioRetry(null)
      await router.invalidate()
    } catch (cause) {
      setAudioRetry(
        cause instanceof Error ? cause.message : 'Could not make the audio.',
      )
    }
  }

  async function go(nextS: number) {
    await router.navigate({
      to: '/lessons/$lessonId',
      params: { lessonId: lesson.id },
      search: { s: nextS },
      replace: true,
    })
  }

  const stepDone = article ? isStepDone(article, step) : false

  async function onComplete() {
    if (!article) return
    if (stepDone) {
      if (step < LAST_STEP) await go(step + 1)
      else await router.navigate({ to: '/' })
      return
    }
    setPending(true)
    setError(null)
    try {
      const detail = await completeStep({
        data: {
          articleId: article.id,
          step,
          localDate: localToday(),
          answers: quiz.flatMap((question, index) =>
            question.wordId && answers[index] != null
              ? [
                  {
                    wordId: question.wordId,
                    correct: answers[index] === question.headword,
                  },
                ]
              : [],
          ),
        },
      })
      await router.invalidate()
      if (step < LAST_STEP) await go(step + 1)
      else setFinished(detail?.suggestions ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save step')
    } finally {
      setPending(false)
    }
  }

  async function onRetry() {
    setPending(true)
    setError(null)
    try {
      await retryLesson({ data: { lessonId: lesson.id } })
      await router.invalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not retry')
    } finally {
      setPending(false)
    }
  }

  if (lesson.status === 'generating') {
    const at = STAGE_ORDER.indexOf(lesson.progress?.stage ?? 'writing')
    const part = lesson.progress
    /**
     * The wait, named. The models are shown because they are what the time is
     * being spent on: knowing which one is running is the difference between
     * a slow writer and a slow recording.
     */
    const stages = [
      {
        label: 'Writing the article',
        model: lesson.models.article,
        title: 'Writing one article',
      },
      {
        label: 'Recording the audio',
        model: lesson.models.speech,
        title:
          part?.part && part.parts
            ? `Recording part ${part.part} of ${part.parts}`
            : 'Recording the audio',
      },
      { label: 'Saving the lesson', model: 'D1', title: 'Saving the lesson' },
    ]
    return (
      <Shell title="Writing your lesson">
        <main className="space-y-3 p-3.5">
          <Card>
            <div className="flex items-center gap-3">
              <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-brand-500/25" />
                <Sparkles className="relative size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">{stages[at].title}</p>
                <p className="text-xs text-ink-soft">
                  Using {lesson.wordCount} of your words.
                </p>
              </div>
              <span className="tabular-nums text-xs font-black text-ink-faint">
                {formatElapsed(elapsed)}
              </span>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hairline-strong">
              <div className="h-full w-1/3 animate-sweep rounded-full bg-brand-500" />
            </div>

            {/* Which of the two long calls is running, and which model is
                making it: a minute of nothing reads as a hang otherwise. */}
            <ol className="mt-3 space-y-1.5">
              {stages.map((item, index) => (
                <li
                  key={item.model}
                  className={cn(
                    'flex items-center gap-2 text-xs font-bold',
                    index > at && 'text-ink-faint',
                  )}
                >
                  <span className="grid size-4 shrink-0 place-items-center">
                    {index < at ? (
                      <Check className="size-3.5 text-grass-500" strokeWidth={3} />
                    ) : index === at ? (
                      <Spinner className="size-3.5 text-brand-500" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-hairline-strong" />
                    )}
                  </span>
                  <span className={cn(index === at && 'text-ink')}>
                    {item.label}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[0.625rem] text-ink-faint">
                    {item.model}
                  </span>
                </li>
              ))}
            </ol>

            <ul className="mt-3 flex flex-wrap gap-1.5">
              {lesson.words.map((word, index) => (
                <li
                  key={word.headword}
                  style={{ animationDelay: `${index * 120}ms` }}
                  className="animate-pulse rounded-full bg-surface-sunk px-2.5 py-1 text-xs font-bold"
                >
                  {word.headword}
                </li>
              ))}
            </ul>
          </Card>

          {/* The shape of what is coming, so the wait reads as progress. */}
          <div aria-hidden className="space-y-2.5 px-1 pt-1">
            <div className="skeleton h-5 w-2/5" />
            {['100%', '94%', '98%', '88%', '96%', '70%'].map((width, index) => (
              <div key={index} className="skeleton h-3.5" style={{ width }} />
            ))}
          </div>
        </main>
      </Shell>
    )
  }

  if (finished) {
    return (
      <Shell title="Lesson complete">
        <LessonDone
          suggestions={finished}
          right={
            lesson.quiz.filter((item, index) => answers[index] === item.headword)
              .length
          }
          total={lesson.quiz.length}
        />
      </Shell>
    )
  }

  if (lesson.status === 'failed' || !article) {
    return (
      <Shell title="Lesson">
        <main className="space-y-3 p-3.5">
          <Card>
            <div className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-destructive">
              <AlertTriangle className="size-6" />
            </div>
            <p className="mt-3 font-extrabold">This lesson was not written</p>
            <p className="mt-1 text-sm text-ink-soft">
              {lesson.failureReason ??
                'Something went wrong while writing this lesson.'}
            </p>
          </Card>
          {error ? (
            <p className="text-sm font-bold text-destructive">{error}</p>
          ) : null}
          <Button block size="lg" disabled={pending} onClick={onRetry}>
            {pending ? 'Retrying…' : 'Try again'}
          </Button>
        </main>
      </Shell>
    )
  }

  /** True while the recall step still owes answers. */
  const quizAsking = step === LAST_STEP && !stepDone && quiz.length > 0
  const question = quiz[quizIndex]
  const lastQuestion = quizIndex >= quiz.length - 1
  const correctCount = quiz.filter(
    (item, index) => answers[index] === item.headword,
  ).length

  /** The two steps whose work is done by the player rather than on screen. */
  const listening = step === 0 || step === FULL_LISTEN_STEP
  const silent = article.clips.length === 0

  const canComplete = listening
    ? heard || stepDone || silent
    : quizAsking
      ? picked != null
      : true

  /**
   * The footer button carries the recall quiz as well as step completion, so
   * there is one place to press throughout rather than a second stack of
   * buttons appearing under the choices.
   */
  async function onPrimary() {
    if (quizAsking && !lastQuestion) {
      setQuizIndex(quizIndex + 1)
      return
    }
    await onComplete()
  }

  const primaryLabel = () => {
    if (pending) return <Spinner />
    if (listening) {
      if (silent) return step === 0 ? 'Skip to reading' : 'Skip to the words'
      if (!canComplete) return 'Listen to the end first'
      return stepDone ? 'Next step' : 'Mark complete'
    }
    if (step === 1) return stepDone ? 'Next step' : 'Mark complete'
    if (quizAsking) {
      if (picked == null) return 'Pick an answer'
      return lastQuestion ? 'Finish lesson' : 'Next question'
    }
    return 'Finish lesson'
  }

  /** The fuller gloss to show once an answer is in. */
  const meaningOf = (headword: string) => {
    const explained = article.explanations.find(
      (item) => item.phrase.toLowerCase() === headword.toLowerCase(),
    )
    if (explained) return explained.meaning
    return lesson.words.find((word) => word.headword === headword)?.definition
  }

  /**
   * How much of the article the listening step may show.
   *
   * Only parts played all the way through are revealed, so the learner always
   * hears a passage before they read it. Legacy single-clip articles carry an
   * open-ended `to`, hence the clamp.
   */
  const revealedThrough =
    heardClips > 0
      ? Math.min(
          (article.clips[heardClips - 1]?.to ?? -1) + 1,
          article.sentences.length,
        )
      : 0

  return (
    <Shell title={article.title}>
      <ol className="grid grid-cols-4 gap-1.5 px-3.5 pt-2.5">
        {STEPS.map((item) => {
          const locked = item.id > unlocked
          const done = isStepDone(article, item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={locked}
                onClick={() => go(item.id)}
                className={cn(
                  'flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-2xl border px-0.5 text-center text-[0.6875rem] leading-tight font-black transition-colors',
                  item.id === step
                    ? 'border-brand-700 bg-brand-500 text-white'
                    : done
                      ? 'border-transparent bg-grass-100 text-grass-600'
                      : locked
                        ? 'border-hairline text-ink-faint opacity-50'
                        : 'border-hairline bg-surface text-ink-soft',
                )}
              >
                {done && item.id !== step ? (
                  <Check className="size-4" strokeWidth={3} />
                ) : (
                  <item.icon className="size-4" />
                )}
                {item.label}
              </button>
            </li>
          )
        })}
      </ol>

      <main className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-3.5">
        {lesson.audioNote && step < LAST_STEP ? (
          <p className="rounded-2xl bg-brand-50 px-3.5 py-2.5 text-sm font-bold text-brand-700">
            {lesson.audioNote}
          </p>
        ) : null}

        {step === 0 && !silent ? (
          <p className="text-sm text-ink-soft">
            Listen one part at a time. Each part appears in writing once you
            have heard it to the end.
          </p>
        ) : null}

        {listening && silent ? (
          <Card className="flex items-start gap-3 bg-indigo-100/50">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-indigo-500">
              <Ear className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold">No audio this time</p>
              <p className="mt-0.5 text-sm text-ink-soft">
                {step === 0
                  ? 'Read the article instead — the other steps work as usual. The voice budget resets at 00:00 UTC.'
                  : 'Nothing to listen to, so this step is a formality. The voice budget resets at 00:00 UTC.'}
              </p>
              <Button
                tone="neutral"
                block
                className="mt-3"
                disabled={audioRetry === 'working'}
                onClick={onRetryAudio}
              >
                {audioRetry === 'working' ? (
                  <>
                    <Spinner /> Making audio…
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-4" /> Try audio again
                  </>
                )}
              </Button>
              {audioRetry && audioRetry !== 'working' ? (
                <p className="mt-2 text-sm text-ink-soft">{audioRetry}</p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {step === 0 && revealedThrough > 0 ? (
          <div className="animate-rise-in">
            <p className="kicker mb-2">
              Heard so far · {heardClips} of {article.clips.length}
            </p>
            <Reader
              sentences={article.sentences.slice(0, revealedThrough)}
              paragraphStarts={article.paragraphStarts.filter(
                (index) => index < revealedThrough,
              )}
              targets={targets}
              onWordTap={onWordTap}
            />
          </div>
        ) : null}

        {step === 1 ? (
          <>
            <p className="text-sm text-ink-soft">
              Read it at your own pace. Tap any word you do not know, or tap a
              sentence to hear it again. Play to hear the whole article.
            </p>
            <Reader
              sentences={article.sentences}
              paragraphStarts={article.paragraphStarts}
              targets={targets}
              activeSentence={activeSentence}
              onWordTap={onWordTap}
              onSentenceTap={(index) => playerRef.current?.playSentence(index)}
            />
          </>
        ) : null}

        {step === FULL_LISTEN_STEP && !silent ? (
          <>
            <Card className="animate-pop-in text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-indigo-100 text-indigo-500">
                <Headphones className="size-7" />
              </span>
              <p className="mt-2.5 font-extrabold">Listen again</p>
              <p className="mt-0.5 text-sm text-ink-soft">
                The whole article, straight through and a little faster. You
                know what it says now, so all that is left is keeping up with
                it.
              </p>
            </Card>

            {/* Blind is the exercise, not a rule. Someone who has lost the
                thread gets more out of following the text than out of
                replaying a passage they cannot hear their way into. */}
            {peeking ? (
              <Reader
                sentences={article.sentences}
                paragraphStarts={article.paragraphStarts}
                targets={targets}
                activeSentence={activeSentence}
                onWordTap={onWordTap}
              />
            ) : (
              <button
                type="button"
                onClick={() => setPeeking(true)}
                className="mx-auto block px-3 py-2 text-sm font-bold text-ink-soft underline decoration-hairline-strong underline-offset-4"
              >
                Lost? Show the text
              </button>
            )}
          </>
        ) : null}

        {step === LAST_STEP && quizAsking ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="kicker">
                Question {quizIndex + 1} of {quiz.length}
              </p>
              <p className="kicker">
                {answeredCount} answered · {correctCount} right
              </p>
            </div>

            <Card className="animate-pop-in" key={quizIndex}>
              <p className="kicker">Which word means this?</p>
              <p className="mt-2 text-xl font-bold leading-snug">
                {question.prompt}
              </p>
            </Card>

            <ul className="space-y-2">
              {question.choices.map((choice) => {
                const chosen = picked === choice
                const isAnswer = choice === question.headword
                const reveal = picked != null
                return (
                  <li key={choice}>
                    <button
                      type="button"
                      aria-disabled={reveal}
                      onClick={() => {
                        if (reveal) return
                        setAnswers((prev) => ({ ...prev, [quizIndex]: choice }))
                      }}
                      className={cn(
                        'btn-3d flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-left text-base font-extrabold',
                        reveal && 'pointer-events-none',
                        reveal && isAnswer
                          ? 'border-grass-600 bg-grass-100 text-grass-600'
                          : reveal && chosen
                            ? 'border-hairline-strong bg-surface-sunk text-ink-soft line-through'
                            : 'border-hairline bg-surface',
                      )}
                    >
                      {choice}
                      {reveal && isAnswer ? (
                        <Check className="size-5 shrink-0" strokeWidth={3} />
                      ) : reveal && chosen ? (
                        <X className="size-5 shrink-0" strokeWidth={3} />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>

            {picked != null ? (
              <div className="animate-rise-in space-y-1.5 border-l-2 border-brand-300 pl-3">
                <p className="text-sm leading-relaxed text-ink-soft">
                  <span className="font-extrabold text-ink">
                    {question.headword}
                  </span>{' '}
                  — {meaningOf(question.headword)}
                </p>
                {/* The word's own example, which was written to show this one
                    word. The article's sentence is the fallback: it had ten
                    words to carry, so it makes the weaker illustration. */}
                <InContext
                  sentence={
                    question.example ??
                    findSentenceWith(article.sentences, question.headword)
                  }
                  headword={question.headword}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {step === LAST_STEP && !quizAsking ? (
          <>
            <p className="text-sm text-ink-soft">
              {stepDone
                ? 'Already answered. Tap a word to check its meaning again.'
                : 'Say each meaning out loud before you reveal it. Recalling is what makes it stick.'}
            </p>
            <ul className="space-y-2">
              {article.explanations.map((item, index) => {
                const open = revealed.has(index)
                return (
                  <li key={item.phrase}>
                    <button
                      type="button"
                      onClick={() =>
                        setRevealed((prev) => {
                          const next = new Set(prev)
                          if (next.has(index)) next.delete(index)
                          else next.add(index)
                          return next
                        })
                      }
                      className="card-soft w-full px-4 py-3 text-left"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-extrabold">{item.phrase}</span>
                        {!open ? (
                          <span className="shrink-0 rounded-full bg-surface-sunk px-2.5 py-1 text-[0.6875rem] font-black uppercase tracking-wider text-ink-faint">
                            Reveal
                          </span>
                        ) : (
                          <Check className="size-4 shrink-0 text-grass-500" />
                        )}
                      </span>
                      {open ? (
                        <span className="animate-pop-in mt-2 block text-sm leading-relaxed text-ink-soft">
                          {item.meaning}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}

        {error ? (
          <p className="text-sm font-bold text-destructive">{error}</p>
        ) : null}
      </main>

      <footer className="safe-bottom sticky bottom-0 z-10 space-y-2 border-t border-hairline bg-page/92 p-2.5 backdrop-blur-xl">
        {step < LAST_STEP && !silent ? (
          <AudioPlayer
            // Remounting per step is what resets the bar when reading starts.
            key={step}
            ref={playerRef}
            clips={article.clips}
            sentences={article.sentences}
            // Only the first listen stops at the boundaries: it is handing
            // over one part at a time. The other two play the article whole.
            autoAdvance={step !== 0}
            startSpeed={step === FULL_LISTEN_STEP ? FULL_LISTEN_SPEED : 1}
            onSentenceChange={
              step === 1 || peeking ? setActiveSentence : undefined
            }
            onClipEnd={
              step === 0
                ? (index) => setHeardClips((count) => Math.max(count, index + 1))
                : undefined
            }
            onComplete={() => setHeard(true)}
          />
        ) : null}

        {/* Always the brand colour: green is what a finished thing looks like
            in this app, and the button is the thing still to be pressed. */}
        <Button
          block
          size="lg"
          onClick={onPrimary}
          disabled={pending || !canComplete}
        >
          {primaryLabel()}
        </Button>
      </footer>

      <GlossSheet
        headword={tapped?.word ?? null}
        // Only offered where there is audio to seek into, which rules out the
        // articles whose voice budget ran out.
        onPlaySentence={
          article.clips.length > 0 && tapped
            ? () => playerRef.current?.playSentence(tapped.sentence)
            : undefined
        }
        onClose={() => setTapped(null)}
      />
    </Shell>
  )
}

/** A sentence using the word, with that form picked out. */
function InContext({
  sentence,
  headword,
}: {
  sentence: string | null
  headword: string
}) {
  if (!sentence) return null

  const parts = sentence.split(
    new RegExp(`(${wordPattern(headword).source})`, 'gi'),
  )

  return (
    <p className="text-sm leading-relaxed text-ink-soft italic">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-extrabold text-ink not-italic">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </p>
  )
}

/**
 * The moment after the last answer.
 *
 * The article was just read closely enough to answer questions about it, which
 * is the one point where an unfamiliar word from it is still fresh — so the
 * words it explained but the learner does not own are offered here rather than
 * left to be rediscovered on the add page.
 */
function LessonDone({
  suggestions,
  right,
  total,
}: {
  suggestions: ArticleSuggestion[]
  right: number
  total: number
}) {
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  function add(word: ArticleSuggestion) {
    if (added.includes(word.headword)) return
    setError(null)
    setAdded((prev) => [...prev, word.headword])
    void addWord({
      data: { headword: word.headword, source: 'recommendation' },
    }).catch(() => {
      setAdded((prev) => prev.filter((item) => item !== word.headword))
      setError(`Could not add “${word.headword}”`)
    })
  }

  return (
    <>
      <main className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-3.5">
        <Card className="animate-pop-in text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-grass-100 text-grass-600">
            <Check className="size-7" strokeWidth={3} />
          </span>
          <p className="mt-2.5 text-xl font-black">Lesson complete</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            {total > 0
              ? `You recalled ${right} of ${total} words.`
              : 'All four steps done.'}
          </p>
        </Card>

        {suggestions.length > 0 ? (
          <section>
            <h2 className="font-extrabold">Worth keeping</h2>
            <p className="mt-0.5 mb-2 text-sm text-ink-soft">
              These came up in the article you just read.
            </p>
            <ul className="space-y-2">
              {suggestions.map((word) => {
                const saved = added.includes(word.headword)
                return (
                  <li key={word.headword}>
                    <button
                      type="button"
                      onClick={() => add(word)}
                      aria-pressed={saved}
                      className={cn(
                        'card-soft flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors',
                        saved && 'bg-grass-100',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-extrabold">
                          {word.headword}
                        </span>
                        <span className="mt-0.5 block text-sm leading-snug text-ink-soft">
                          {word.meaning}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'grid size-8 shrink-0 place-items-center rounded-full',
                          saved
                            ? 'text-grass-600'
                            : 'bg-brand-500 text-white',
                        )}
                      >
                        {saved ? (
                          <Check className="size-4" strokeWidth={3} />
                        ) : (
                          <Plus className="size-4" strokeWidth={3} />
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {error ? (
          <p className="text-sm font-bold text-destructive">{error}</p>
        ) : null}
      </main>

      {/* The article is read and the quiz is answered, so the useful next move
          is feeding tomorrow's lesson rather than going back to a home screen
          that has nothing left to offer today. */}
      <footer className="safe-bottom sticky bottom-0 z-10 space-y-2 border-t border-hairline bg-page/92 p-2.5 backdrop-blur-xl">
        <ButtonLink to="/words/add" block size="lg">
          <Plus className="size-4" strokeWidth={3} /> Add more words
        </ButtonLink>
        <ButtonLink to="/" block tone="ghost">
          Back to today
        </ButtonLink>
      </footer>
    </>
  )
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-20 flex items-center gap-1 border-b border-hairline bg-page/85 px-2 pb-2 backdrop-blur-xl">
        <Link
          to="/"
          className="inline-flex size-11 items-center justify-center rounded-full active:bg-surface-sunk"
        >
          <ChevronLeft className="size-6" />
          <span className="sr-only">Back</span>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="kicker">Lesson</p>
          <h1 className="truncate font-extrabold leading-tight">{title}</h1>
        </div>
      </header>
      {children}
    </div>
  )
}
