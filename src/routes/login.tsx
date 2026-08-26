import { createFileRoute, redirect } from '@tanstack/react-router'
import { BookOpen, Headphones, Sparkles } from 'lucide-react'

import { AppMark } from '#/components/app-mark'
import { Button, ExternalButtonLink } from '#/components/ui'
import { getSignInOptions } from '#/server/auth'

const MESSAGES: Record<string, string> = {
  denied: 'Sign-in was cancelled. You can try again.',
  failed: 'Sign-in did not complete. Please try again.',
  unconfigured: 'Sign-in is not available on this deployment yet.',
}

const PROMISES = [
  {
    icon: Sparkles,
    title: 'Written for you',
    body: 'A fresh article each day at your level, using the words you saved.',
  },
  {
    icon: Headphones,
    title: 'Heard, then read',
    body: 'Listen without the text, read along, then listen again.',
  },
  {
    icon: BookOpen,
    title: 'Kept in memory',
    body: 'A short recall round closes the lesson. Five minutes in all.',
  },
]

export const Route = createFileRoute('/login')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { next?: string; auth?: string } => ({
    next: typeof search.next === 'string' ? search.next : undefined,
    auth: typeof search.auth === 'string' ? search.auth : undefined,
  }),
  loaderDeps: ({ search }) => ({ next: search.next }),
  loader: async ({ deps }) => {
    const options = await getSignInOptions()
    // Nothing to sign in to twice: a session here means the guard sent them
    // away and they came back on the history stack.
    if (options.signedIn) throw redirect({ to: '/' })
    return { ...options, next: deps.next }
  },
  component: LoginPage,
})

/** Google's mark, in its four colours. Their branding rules require both. */
function GoogleMark() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  )
}

function LoginPage() {
  const { canSignIn, next } = Route.useLoaderData()
  const { auth } = Route.useSearch()

  const query = next ? `?next=${encodeURIComponent(next)}` : ''

  return (
    // Centred and bounded rather than the app's usual full-bleed column: this
    // is the one screen a stranger sees, and on a laptop a stretched mobile
    // layout reads as unfinished.
    <div className="flex min-h-dvh flex-col justify-center px-5 py-10">
      {/* On a phone the page is the panel. From a tablet up it becomes a
          card, so the sign-in does not read as a column of loose text on an
          empty desktop background. */}
      <main className="mx-auto w-full max-w-sm sm:max-w-md sm:rounded-3xl sm:bg-surface sm:p-9 sm:shadow-[var(--shadow-card)] sm:ring-1 sm:ring-hairline">
        <header className="flex flex-col items-center text-center">
          <AppMark className="size-16" />
          <h1 className="mt-4 text-3xl font-black tracking-tight">
            Daily English
          </h1>
          <p className="mt-1.5 text-pretty text-[0.9375rem] leading-relaxed text-ink-soft">
            One article a day, built from the words you are learning.
          </p>
        </header>

        <ul className="mt-8 space-y-4">
          {PROMISES.map((promise) => (
            <li key={promise.title} className="flex gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
                <promise.icon className="size-4.5" strokeWidth={2.5} />
              </span>
              <div className="min-w-0">
                <p className="font-extrabold leading-tight">{promise.title}</p>
                <p className="mt-0.5 text-sm leading-snug text-ink-soft">
                  {promise.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-9">
          {canSignIn ? (
            <ExternalButtonLink
              href={`/api/auth/google${query}`}
              tone="neutral"
              size="lg"
              block
            >
              <GoogleMark />
              Continue with Google
            </ExternalButtonLink>
          ) : (
            <Button tone="neutral" size="lg" block disabled>
              <GoogleMark />
              Continue with Google
            </Button>
          )}

          {auth && MESSAGES[auth] ? (
            <p
              role="alert"
              className="mt-3 text-center text-sm font-bold text-destructive"
            >
              {MESSAGES[auth]}
            </p>
          ) : null}

          {!canSignIn ? (
            <p className="mt-3 text-center text-xs text-ink-faint">
              Google credentials are missing on this deployment.
            </p>
          ) : null}

          {/* A build-time constant, so this button and the route behind it are
              both compiled out of the deployed Worker. */}
          {import.meta.env.DEV ? (
            <ExternalButtonLink
              href="/api/auth/dev"
              tone="ghost"
              size="sm"
              block
              className="mt-2"
            >
              Sign in as the test learner
            </ExternalButtonLink>
          ) : null}
        </div>

        {/* Says what signing in costs, in the absence of any terms to link to.
            Vaguer wording here would raise the question rather than settle it. */}
        <p className="mt-8 text-center text-xs leading-relaxed text-ink-faint">
          Signing in keeps your word list and your lessons on this account. We
          store your email address and nothing else about you.
        </p>
      </main>
    </div>
  )
}
