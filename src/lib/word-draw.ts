/** What the draw needs to know about a saved word. */
export type Drawable = {
  id: string
  /** Epoch seconds, or null for a word no review has scheduled yet. */
  dueAt: number | null
  familiarity: number
  /** ISO timestamp of the day the learner saved it. */
  createdAt: string
}

const DAY = 86_400_000

/** A word saved this recently still counts as one the learner just met. */
const FRESH_DAYS = 7

/**
 * Shares of a lesson reserved for review and for new saves. The rest goes to
 * words no lesson has taught, which in a collection that grows faster than it
 * is taught is where nearly every word ends up waiting.
 */
const REVIEW_SHARE = 0.3
const FRESH_SHARE = 0.3

/** Days over which a new save's head start halves. */
const FRESH_HALF_LIFE = 3

/**
 * Words wanted per reserved new-save slot. A learner who saves twenty in one
 * sitting would otherwise crowd those slots until being new stopped meaning
 * anything, so only the last day or two of saves competes for them.
 */
const FRESH_CROWD = 4

/** Days a waiting word takes to double its pull, so nothing waits forever. */
const BACKLOG_DRIFT = 30

type Weighted<T> = { word: T; weight: number; days: number }

/** A word saved today outpulls one from the end of the fresh window five to one. */
const freshWeight = (days: number) => 2 ** (-days / FRESH_HALF_LIFE)

/** Longer waited, heavier, so the untaught drain oldest-first on average. */
const waitWeight = (days: number) => 1 + days / BACKLOG_DRIFT

/**
 * Draw without replacement, each remaining word weighted by its pull.
 *
 * Empties what it picks out of the pool it is given, so whatever the caller
 * still holds afterwards is the part that was passed over and can be offered to
 * a bucket that came up short.
 */
function take<T>(
  pool: Weighted<T>[],
  want: number,
  random: () => number,
): Weighted<T>[] {
  const picks: Weighted<T>[] = []
  while (picks.length < want && pool.length > 0) {
    let total = 0
    for (const item of pool) total += item.weight
    let ticket = random() * total
    let index = pool.length - 1
    for (let i = 0; i < pool.length; i++) {
      ticket -= pool[i].weight
      if (ticket <= 0) {
        index = i
        break
      }
    }
    picks.push(pool[index])
    pool.splice(index, 1)
  }
  return picks
}

/**
 * The most recent saves, cut on a day boundary.
 *
 * Whole days, because words saved in one sitting have to compete or wait
 * together: nothing about the order the rows went in should decide which of
 * them the learner meets first. One big day can therefore overrun the room
 * asked for, and should — twenty words saved this morning are all equally new,
 * and thinning them is the rest of the draw's job, not this cut's.
 */
function newestSaves<T>(pool: Weighted<T>[], room: number): Weighted<T>[] {
  const sorted = [...pool].sort((a, b) => a.days - b.days)
  let cut = 0
  while (cut < sorted.length && cut < room) {
    const day = Math.floor(sorted[cut].days)
    while (cut < sorted.length && Math.floor(sorted[cut].days) === day) cut++
  }
  return sorted.slice(0, cut)
}

/**
 * Choose the words one lesson teaches.
 *
 * The job pulls three ways. A word saved this morning should turn up while the
 * learner still remembers meeting it; a word the schedule says is due has to
 * come round or the review loop means nothing; and neither may bury the rest of
 * the collection, which is the failure this replaced. Ranking by due date and
 * familiarity leaves most of a real collection tied on both keys, and a tie
 * handed to a stable sort is settled by whatever order the database returned,
 * which is to say by an index nobody chose — so the same words came back for
 * weeks while hundreds waited behind them and never arrived.
 *
 * So the slots are split rather than ranked. Review and the newest saves each
 * get a reserved share; everything untaught, new saves included, then competes
 * for what is left, weighted by how long it has waited. Sharing that second
 * draw is what keeps the fresh window from being a cliff: a word that turns
 * eight days old loses its reserved slot but keeps the seniority it has been
 * building, rather than being promoted into a bigger pool for aging out.
 *
 * The pick inside every bucket is random, because a deterministic order run
 * once a day against a slowly changing collection is a queue, and a queue with
 * more words in it than there are days is a wall.
 */
export function drawWords<T extends Drawable>(input: {
  collection: readonly T[]
  /** Every word that has ever been a lesson target. */
  taught: ReadonlySet<string>
  /** Targets of the last few lessons, which a new one should step around. */
  recent: ReadonlySet<string>
  count: number
  /** Epoch milliseconds. */
  now?: number
  random?: () => number
}): T[] {
  const {
    collection,
    taught,
    recent,
    count,
    now = Date.now(),
    random = Math.random,
  } = input
  if (count <= 0) return []

  const review: Weighted<T>[] = []
  const untaught: Weighted<T>[] = []
  const rest: Weighted<T>[] = []
  const cooling: Weighted<T>[] = []

  for (const word of collection) {
    const saved = Date.parse(word.createdAt)
    // An unreadable date only decides which bucket a word waits in, so treat it
    // as old rather than refuse to teach the word at all.
    const days = Number.isFinite(saved)
      ? Math.max(0, (now - saved) / DAY)
      : FRESH_DAYS + 1
    // Only a word with a schedule can be behind it. The rest have never been
    // reviewed, and are waiting rather than due.
    const due = word.dueAt != null && word.dueAt * 1000 <= now

    let pool = rest
    let weight = 1
    if (due) {
      pool = review
      // A shaky word is worth more of a review than one nearly learned.
      weight = 2 - word.familiarity
    } else if (!taught.has(word.id)) {
      pool = untaught
      weight = waitWeight(days)
    }
    // A word from the last few lessons keeps its weight but waits outside the
    // buckets, so a reserved slot cannot hand it straight back. Lowering its
    // odds instead would do nothing whenever it is the only candidate its
    // bucket has, which is exactly the case worth guarding against.
    ;(recent.has(word.id) ? cooling : pool).push({ word, weight, days })
  }

  const reviewSlots = Math.round(count * REVIEW_SHARE)
  const freshSlots = Math.round(count * FRESH_SHARE)

  // The reserved new-save slots, contested by the newest saves alone and
  // weighted so this morning's outpull the ones from the start of the week.
  const fresh = newestSaves(
    untaught.filter((item) => item.days <= FRESH_DAYS),
    freshSlots * FRESH_CROWD,
  ).map((item) => ({ ...item, weight: freshWeight(item.days) }))

  const picked = [
    ...take(review, reviewSlots, random),
    ...take(fresh, freshSlots, random),
  ]
  // Whatever review and the new saves leave unclaimed goes to the rest of the
  // untaught, because a learner with nothing due and nothing saved this week
  // has the most to gain from the words that have been waiting longest.
  const spent = new Set(picked.map((item) => item.word.id))
  const waiting = untaught.filter((item) => !spent.has(item.word.id))
  picked.push(...take(waiting, count - picked.length, random))

  // A small collection empties every bucket long before the lesson is full, and
  // then it is worth teaching a word again rather than shipping a short lesson.
  // The words cooling off are asked last, which is what makes it a cooldown and
  // not a ban: a learner with four words still gets a lesson of four.
  for (const pool of [waiting, review, rest, cooling]) {
    if (picked.length >= count) break
    picked.push(...take(pool, count - picked.length, random))
  }
  return picked.map((item) => item.word)
}
