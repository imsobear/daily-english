import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { RoutePending } from './components/route-pending'
import { claimSwipeBack } from './lib/swipe-back'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  /**
   * Index of the history entry the last navigation landed on.
   *
   * The router's own `fromLocation` cannot be used for this: on a pop it still
   * reports the entry from before the push, so a back navigation looks like it
   * is going from index 1 to index 1. The history entry itself has already been
   * updated to the destination by the time the transition starts, so comparing
   * against the previous one is what actually tells push from pop. Held in the
   * closure rather than at module scope so a server render cannot share it.
   */
  let lastIndex: number | null = null

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Acknowledge the tap quickly, but never flash a skeleton for one frame.
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
    /**
     * Screens slide the way the stack moved. The history index is the only
     * honest signal: path depth says nothing about a sideways move between
     * tabs, and the browser's back button has to read as a pop as well.
     */
    defaultViewTransition: {
      types: () => {
        const index: number =
          (globalThis as { history?: History }).history?.state?.__TSR_index ?? 0
        const back = lastIndex !== null && index < lastIndex
        lastIndex = index
        if (!back) return ['forward']
        // A swipe has already carried the screen off, so sliding the pop here
        // as well would play it twice. False skips the transition outright.
        return claimSwipeBack() ? false : ['back']
      },
    },
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
