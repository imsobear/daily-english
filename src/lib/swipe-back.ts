/**
 * Whether a back swipe is carrying the pop that is about to happen.
 *
 * A swipe already slides the screen away — ours when the app is installed, the
 * browser's own in a tab — so the router's pop transition would play that same
 * move a second time. That is the flicker people notice on the gesture and
 * never on a back button, which nothing else animates.
 *
 * The touch handler arms it, the router claims it as it decides how to
 * animate. Only ever written from a touch handler, so a server render can
 * never find it armed.
 */

/**
 * Long enough to cover a slow drag and the pop that follows it, short enough
 * that a swipe someone thought better of does not swallow the next back. The
 * browser stops sending touches once it takes the gesture, so this has to be
 * measured from where the finger landed rather than where it let go.
 */
const WINDOW_MS = 2000

let armedAt = 0

export function armSwipeBack(now = Date.now()) {
  armedAt = now
}

/** True for the one pop the swipe caused, and only while it is still fresh. */
export function claimSwipeBack(now = Date.now()) {
  const armed = armedAt > 0 && now - armedAt < WINDOW_MS
  armedAt = 0
  return armed
}
