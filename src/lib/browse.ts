import type { PartOfSpeech } from '#/lib/vocabulary'

/** Where the browse feed draws its cards from. */
export const BROWSE_SOURCES = ['mine', 'mix', 'new'] as const
export type BrowseSource = (typeof BROWSE_SOURCES)[number]

export function asBrowseSource(value: unknown): BrowseSource {
  return BROWSE_SOURCES.includes(value as BrowseSource)
    ? (value as BrowseSource)
    : 'mix'
}

/** One saved word every fourth card, when the feed is mixing both. */
export const MIX_EVERY = 4

/**
 * Lay a page out with the learner's own words spaced through the new ones.
 *
 * Every fourth card is one of theirs, which is often enough that an old word
 * resurfaces while scrolling and rare enough that the feed still feels like
 * discovery. Either side running out is normal — a learner with four words has
 * almost nothing to revisit, and an exhausted level has nothing new — so
 * whichever list still has cards fills the rest.
 */
export function weave<T>(fresh: T[], mine: T[], every = MIX_EVERY): T[] {
  const out: T[] = []
  let f = 0
  let m = 0
  while (f < fresh.length || m < mine.length) {
    const wantsMine = (out.length + 1) % every === 0
    if (wantsMine && m < mine.length) out.push(mine[m++])
    else if (f < fresh.length) out.push(fresh[f++])
    else if (m < mine.length) out.push(mine[m++])
  }
  return out
}

/** How many of a page of `size` cards should come from the learner's list. */
export function mineShare(size: number, every = MIX_EVERY) {
  return Math.floor(size / every)
}

/**
 * A seed for one pass through the feed.
 *
 * The learner's own words are a fixed list, so something has to decide their
 * order, and the two things wanted of it pull opposite ways: different every
 * time they open the tab, identical for every page of the same visit, or page
 * two hands back words page one already showed. A seed travelling with the page
 * settles both — the server shuffles from it, the client returns it when asking
 * for more.
 */
export function makeSeed(random: () => number = Math.random) {
  return Math.floor(random() * 0x7ffffffe) + 1
}

/** Mulberry32: a few lines, and the same sequence for the same seed. */
export function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const POS_NAMES: Record<PartOfSpeech, string> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
}

/** The pool stores parts of speech abbreviated; cards show them in full. */
export function expandPos(pos: PartOfSpeech | null | undefined) {
  return pos ? POS_NAMES[pos] : null
}
