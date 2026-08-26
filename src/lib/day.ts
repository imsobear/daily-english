/**
 * The calendar date of whichever clock is running this code, as YYYY-MM-DD.
 *
 * Only meaningful in the browser. On a Worker the clock is UTC, so calling
 * this server-side rolls an evening session in the Americas onto tomorrow —
 * use `localDateIn` with the learner's zone instead.
 */
export function localToday(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Move a YYYY-MM-DD date by whole days, staying on the calendar. */
export function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/**
 * The calendar date in a named IANA zone, as YYYY-MM-DD.
 *
 * Throws `RangeError` if the zone is not recognised, so callers handling
 * untrusted input must catch.
 */
export function localDateIn(timeZone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
