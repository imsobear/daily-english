import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'

/** How close to the left edge a touch must start to count as a back swipe. */
const EDGE = 24
/** Movement before the gesture commits to being horizontal rather than a scroll. */
const SLOP = 8
/** Fraction of the screen that always commits, however slowly it was dragged. */
const COMMIT_RATIO = 0.3
/** A flick commits early: pixels per millisecond, past a minimum distance. */
const COMMIT_VELOCITY = 0.35
const COMMIT_DISTANCE = 48
const SLIDE_OUT_MS = 180
/** Time away from the app after which its data is assumed stale. */
const STALE_AFTER_MS = 60_000

function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS shipped home screen apps years before it supported display-mode.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

/**
 * Swipe from the left edge to go back.
 *
 * Installed to the home screen there is no browser chrome, which takes Safari's
 * back swipe with it — the one gesture people use without thinking. This puts
 * it back for standalone only, since in a browser tab it would fight the
 * system gesture it is imitating.
 */
function useEdgeSwipeBack(shellRef: React.RefObject<HTMLDivElement | null>) {
  const router = useRouter()

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !isStandalone()) return

    let startX = 0
    let startY = 0
    let startedAt = 0
    let tracking = false
    let horizontal = false
    let distance = 0

    const clear = () => {
      shell.style.transition = ''
      shell.style.transform = ''
      shell.style.willChange = ''
    }

    const settle = () => {
      shell.style.transition = `transform 200ms cubic-bezier(0.16, 1, 0.3, 1)`
      shell.style.transform = 'translate3d(0,0,0)'
      window.setTimeout(clear, 200)
    }

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      if (touch.clientX > EDGE) return
      if (!router.history.canGoBack()) return

      startX = touch.clientX
      startY = touch.clientY
      startedAt = performance.now()
      tracking = true
      horizontal = false
      distance = 0
    }

    const onMove = (event: TouchEvent) => {
      if (!tracking) return
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!horizontal) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // A mostly vertical start is someone scrolling, so let it go.
        if (Math.abs(dy) > Math.abs(dx)) {
          tracking = false
          return
        }
        horizontal = true
        shell.style.transition = 'none'
        shell.style.willChange = 'transform'
      }

      distance = Math.max(0, dx)
      // Keeping the page pinned to the finger is the whole point, so the scroll
      // that would otherwise happen underneath has to be suppressed.
      event.preventDefault()
      shell.style.transform = `translate3d(${distance}px,0,0)`
    }

    const onEnd = () => {
      if (!tracking) return
      tracking = false
      if (!horizontal) return

      const width = window.innerWidth || 1
      const velocity = distance / Math.max(1, performance.now() - startedAt)
      const commit =
        distance > width * COMMIT_RATIO ||
        (velocity > COMMIT_VELOCITY && distance > COMMIT_DISTANCE)

      if (!commit) {
        settle()
        return
      }

      shell.style.transition = `transform ${SLIDE_OUT_MS}ms ease-out`
      shell.style.transform = `translate3d(${width}px,0,0)`
      window.setTimeout(() => {
        router.history.back()
        // Held off-screen until the frame after the pop, so the previous screen
        // appears at rest instead of sliding in from the wrong side.
        requestAnimationFrame(clear)
      }, SLIDE_OUT_MS)
    }

    // Non-passive: the move handler has to be able to cancel the scroll.
    const moveOptions: AddEventListenerOptions = { passive: false }
    shell.addEventListener('touchstart', onStart, { passive: true })
    shell.addEventListener('touchmove', onMove, moveOptions)
    shell.addEventListener('touchend', onEnd, { passive: true })
    shell.addEventListener('touchcancel', onEnd, { passive: true })

    return () => {
      shell.removeEventListener('touchstart', onStart)
      shell.removeEventListener('touchmove', onMove, moveOptions)
      shell.removeEventListener('touchend', onEnd)
      shell.removeEventListener('touchcancel', onEnd)
      clear()
    }
  }, [router, shellRef])
}

/**
 * Refresh route data when the app comes back to the foreground.
 *
 * A home screen app is resumed rather than reloaded, so without this an app
 * left open overnight still shows yesterday's streak and lesson. Native apps
 * refresh on resume; the minute of grace keeps a quick trip to another app
 * from refetching everything.
 */
function useRevalidateOnResume() {
  const router = useRouter()

  useEffect(() => {
    let hiddenAt: number | null = null

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > STALE_AFTER_MS) {
        void router.invalidate()
      }
      hiddenAt = null
    }

    // Coming back from the iOS app switcher can restore the page from the
    // back/forward cache instead of resuming it, and that path does not always
    // report a visibility change. Clearing hiddenAt keeps the handler above
    // from refetching a second time.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      hiddenAt = null
      void router.invalidate()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [router])
}

/** The app frame, plus the behaviour that only matters once it is installed. */
export function NativeShell({ children }: { children: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null)

  useEdgeSwipeBack(shellRef)
  useRevalidateOnResume()

  return (
    <div
      ref={shellRef}
      className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col bg-page"
    >
      {children}
    </div>
  )
}
