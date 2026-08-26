import {
  HeadContent,
  Scripts,
  createRootRoute,
  redirect,
} from '@tanstack/react-router'

import { NativeShell } from '#/components/native-shell'
import {
  LAUNCH_SCREENS,
  launchScreenFile,
  launchScreenMedia,
} from '#/lib/launch-screens'
import { getSession } from '#/server/auth'

import appCss from '../styles.css?url'

/**
 * Applied before first paint so a dark-mode user never sees a white flash.
 * Kept inline and dependency-free for that reason.
 */
const THEME_BOOTSTRAP = `(()=>{try{var s=localStorage.getItem('theme');var d=s==='dark'||(!s&&matchMedia('(prefers-color-scheme:dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',d?'#16120f':'#fff8f2')}catch(_){}})()`

/**
 * Tells the server which calendar day the learner is living in.
 *
 * Streaks are counted in local time, but a Worker only knows UTC, so without
 * this an evening lesson in the Americas lands on tomorrow and the day looks
 * unfinished. Written before first paint so the next render is already right.
 */
const TZ_BOOTSTRAP = `(()=>{try{var t=Intl.DateTimeFormat().resolvedOptions().timeZone;if(t)document.cookie='tz='+encodeURIComponent(t)+';path=/;max-age=31536000;samesite=lax'}catch(_){}})()`

/**
 * Marks the document when the app is running from the home screen.
 *
 * Behaviour that belongs to the installed app and not to a browser tab keys
 * off this — suppressing overscroll, for one, which in a tab would take the
 * browser's pull-to-refresh with it. Inline so the first paint is already
 * correct. Mirrors isStandalone() in NativeShell.
 */
const STANDALONE_BOOTSTRAP = `(()=>{try{if(matchMedia('(display-mode: standalone)').matches||navigator.standalone===true)document.documentElement.dataset.standalone=''}catch(_){}})()`

/**
 * Keeps an opened lesson playable without a connection. Registered after load
 * so it never competes with the first render, and only in a real deployment —
 * a worker that caches assets would fight the dev server's hot reloads.
 */
const SW_BOOTSTRAP = import.meta.env.PROD
  ? `(()=>{if('serviceWorker'in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})})()`
  : ''

/** The only screen a visitor without a session is allowed to see. */
const PUBLIC = ['/login']

/**
 * Where the share card and its picture live.
 *
 * Hard-coded rather than derived from the request: link previews are fetched
 * by a crawler that will not follow a relative path, and a preview deployment
 * pointing at the production artwork is better than one pointing at nothing.
 */
const SITE = 'https://english.readish.app'
const TITLE = 'Daily English'
const DESCRIPTION =
  'Save the words you meet. Every morning they come back as a short article you listen to, read, and then have to remember.'

export const Route = createRootRoute({
  /**
   * One gate for the whole app.
   *
   * Server functions each call `requireUser`, which is what actually protects
   * anything; this runs first so an unauthenticated request is answered with
   * the sign-in page rather than a rendered shell that redirects itself a
   * moment later. Onboarding hangs off the same check, so there is a single
   * answer to "where does this person belong".
   */
  beforeLoad: async ({ location }) => {
    if (PUBLIC.includes(location.pathname)) return

    const session = await getSession()
    if (!session.signedIn) {
      // Home is where sign-in lands anyway, so only a deep link is worth
      // carrying through the round trip to Google.
      const next = location.href === '/' ? undefined : location.href
      throw redirect({ to: '/login', search: { next } })
    }
    if (!session.onboarded && location.pathname !== '/welcome') {
      throw redirect({ to: '/welcome' })
    }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content:
          // resizes-content keeps the on-screen keyboard from covering sticky
          // footers and the input the learner is typing into.
          'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, interactive-widget=resizes-content',
      },
      { name: 'theme-color', content: '#fff8f2' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      { name: 'apple-mobile-web-app-title', content: 'English' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },

      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: TITLE },
      { property: 'og:title', content: 'One article a day, built from your words' },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: `${SITE}/` },
      { property: 'og:locale', content: 'en' },
      // Dimensions let a chat client reserve the right box before the image
      // has downloaded, which is the difference between a card that appears
      // and one that jumps.
      { property: 'og:image', content: `${SITE}/og.png` },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      {
        property: 'og:image:alt',
        content:
          'Daily English: one article a day, built from your words, shown beside a lesson with two highlighted words.',
      },

      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'One article a day, built from your words' },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: `${SITE}/og.png` },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
      // iOS only reads PNG here. Given an SVG it silently falls back to a
      // screenshot of the page for the home screen icon.
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: '' },
      ...LAUNCH_SCREENS.flatMap((screen) =>
        (['dark', 'light'] as const).map((scheme) => ({
          rel: 'apple-touch-startup-image',
          href: launchScreenFile(screen, scheme),
          media: launchScreenMedia(screen, scheme),
        })),
      ),
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="text-5xl font-black">404</p>
        <p className="mt-2 text-ink-soft">We could not find that page.</p>
      </div>
    </div>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <script dangerouslySetInnerHTML={{ __html: TZ_BOOTSTRAP }} />
        <script dangerouslySetInnerHTML={{ __html: STANDALONE_BOOTSTRAP }} />
        {SW_BOOTSTRAP ? (
          <script dangerouslySetInnerHTML={{ __html: SW_BOOTSTRAP }} />
        ) : null}
      </head>
      <body>
        <NativeShell>{children}</NativeShell>
        <Scripts />
      </body>
    </html>
  )
}
