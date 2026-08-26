import { getCookie } from '@tanstack/react-start/server'

import { localDateIn } from '#/lib/day'

/** Written by the browser before first paint. See TZ_BOOTSTRAP. */
export const TIMEZONE_COOKIE = 'tz'

/**
 * Today's date in the learner's own calendar.
 *
 * The server cannot work this out on its own: a Worker's clock is UTC, so a
 * lesson finished at 8pm in California is stamped by the browser as the 20th
 * while the server would read the 21st — enough to discount the lesson the
 * learner just did and tell them their streak is at risk. The browser reports
 * its zone in a cookie, and UTC is only the fallback for the very first
 * request, before that cookie exists.
 */
export function learnerDate(instant = new Date()): string {
  const zone = getCookie(TIMEZONE_COOKIE)
  if (zone) {
    try {
      return localDateIn(decodeURIComponent(zone), instant)
    } catch {
      // An unrecognised zone is not worth failing a page render over.
    }
  }
  return instant.toISOString().slice(0, 10)
}

export function learnerToday(): string {
  return learnerDate()
}
