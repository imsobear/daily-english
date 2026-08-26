import { VOCABULARY } from '#/data/vocabulary'
import { normalizeHeadword } from '#/lib/dictionary'
import { CEFR_LEVELS, type CefrLevel } from '#/lib/settings'

export type PartOfSpeech = 'n' | 'v' | 'adj' | 'adv'

export type RecommendedWord = {
  headword: string
  level: CefrLevel
  pos: PartOfSpeech
}

type PoolWord = RecommendedWord & {
  /**
   * 1 for the most useful word at this level, rising toward 2 for the least.
   * Multiplied into the draw so common words come up more often without the
   * rarer half of the level becoming unreachable.
   */
  ease: number
}

let parsed: Map<CefrLevel, PoolWord[]> | null = null

/** Split the generated file once per isolate rather than once per request. */
function pool() {
  if (parsed) return parsed
  parsed = new Map()
  for (const level of CEFR_LEVELS) {
    const entries = VOCABULARY[level].split(',').filter(Boolean)
    parsed.set(
      level,
      entries.map((entry, index) => {
        const [headword, pos] = entry.split(':')
        return {
          headword,
          level,
          pos: pos as PartOfSpeech,
          ease: 1 + index / entries.length,
        }
      }),
    )
  }
  return parsed
}

let index: Map<string, PoolWord> | null = null

/**
 * What the pool knows about a word, if it is in the pool at all.
 *
 * A learner's own list is full of words the pool never carried — anything they
 * typed in or tapped out of an article — so the caller has to cope with null
 * rather than assume every word has a level.
 */
export function poolEntry(headword: string): RecommendedWord | null {
  if (!index) {
    index = new Map()
    for (const level of CEFR_LEVELS) {
      for (const word of pool().get(level) ?? []) index.set(word.headword, word)
    }
  }
  const found = index.get(normalizeHeadword(headword))
  return found ? { headword: found.headword, level: found.level, pos: found.pos } : null
}

/** Every headword the pool carries at one level. Used by the pre-warm pass. */
export function poolLevel(level: CefrLevel): RecommendedWord[] {
  return (pool().get(level) ?? []).map((word) => ({
    headword: word.headword,
    level: word.level,
    pos: word.pos,
  }))
}

/**
 * A set of 24 reads as a vocabulary list rather than a pile of nouns only if
 * it is composed as one: the profiles are around 60% nouns, so an unweighted
 * draw is mostly things.
 */
const MIX: [PartOfSpeech, number][] = [
  ['n', 9],
  ['v', 6],
  ['adj', 6],
  ['adv', 3],
]

const MIX_TOTAL = MIX.reduce((sum, [, share]) => sum + share, 0)

/**
 * Words one level below still belong in the mix — the profiles place plenty of
 * words a level lower than the learner meets them — but they should lose most
 * draws against a word at the learner's own level.
 */
const EASIER_PENALTY = 2.2

/**
 * Order by an exponential race: each word draws a random key scaled by how
 * hard we want it to win. Cheap, needs no running total, and is stable to
 * test with a scripted `random`.
 */
function race(words: PoolWord[], random: () => number) {
  return words
    .map((word) => ({
      word,
      key: -Math.log(Math.max(random(), 1e-9)) * word.ease,
    }))
    .sort((a, b) => a.key - b.key)
    .map((item) => item.word)
}

function shuffle<T>(items: T[], random: () => number) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The learner's level plus the one below it, hardest first.
 *
 * `exact` drops the easier half. Filling a word list is served by a wider net
 * — plenty of useful words sit a level below where a learner meets them — but
 * a feed labels every card with its level, and a B1 learner scrolling past
 * A2 cards reads that as the app ignoring the setting.
 */
function window(level: CefrLevel, exact = false) {
  const rank = CEFR_LEVELS.indexOf(level)
  const levels: [CefrLevel, number][] = [[level, 1]]
  if (!exact && rank > 0) levels.push([CEFR_LEVELS[rank - 1], EASIER_PENALTY])
  return levels
}

/**
 * Words to offer a learner who is filling their list.
 *
 * Drawn from a few thousand candidates rather than asked for, because the
 * failure a learner notices is repetition: a model asked twice for words at
 * one level answers with its own canonical list twice, while a shuffle over
 * the level is different every time by construction. `offered` is what makes
 * that hold across visits — without it, every arrival at the screen is the
 * first one.
 */
export function pickRecommendations(input: {
  level: CefrLevel
  owned: Iterable<string>
  /** Already shown to this learner, oldest first. */
  offered?: Iterable<string>
  /** Draw from this level only, rather than this level and the one below. */
  exact?: boolean
  limit?: number
  random?: () => number
}): RecommendedWord[] {
  const limit = input.limit ?? 24
  const random = input.random ?? Math.random
  const owned = new Set([...input.owned].map(normalizeHeadword))
  const offered = [...(input.offered ?? [])].map(normalizeHeadword)
  const seen = new Set(offered)

  // One race over both levels, with the level's penalty folded into each
  // word, so the easier half is mixed through the set rather than appended
  // after it.
  const entries: PoolWord[] = []
  const known = new Map<string, PoolWord>()
  for (const [level, penalty] of window(input.level, input.exact)) {
    for (const word of pool().get(level) ?? []) {
      known.set(word.headword, word)
      if (owned.has(word.headword) || seen.has(word.headword)) continue
      entries.push({ ...word, ease: word.ease * penalty })
    }
  }
  const candidates = race(entries, random)

  const picked: PoolWord[] = []
  const taken = new Set<string>()
  const take = (word: PoolWord) => {
    if (taken.has(word.headword)) return
    taken.add(word.headword)
    picked.push(word)
  }

  for (const [pos, share] of MIX) {
    const target = Math.round((limit * share) / MIX_TOTAL)
    const wanted = candidates.filter((word) => word.pos === pos)
    for (const word of wanted.slice(0, target)) take(word)
  }

  // A part of speech can run out — C2 has few adverbs — and rounding the mix
  // rarely lands exactly on the limit. Either way the row should still be full.
  for (const word of candidates) {
    if (picked.length >= limit) break
    take(word)
  }

  // Everything at this level has been offered before. A word turned down a
  // month ago is a better offer than a short row, so recycle the oldest.
  for (const headword of offered) {
    if (picked.length >= limit) break
    const word = known.get(headword)
    if (word && !owned.has(headword)) take(word)
  }

  return shuffle(picked.slice(0, limit), random)
}

/**
 * The words a new learner starts with, before they have any of their own.
 *
 * Same draw as a recommendation with nothing to exclude yet, which keeps the
 * first list they see and every later one honest about the same level.
 */
export function starterWords(input: {
  level: CefrLevel
  count: number
  random?: () => number
}): string[] {
  return pickRecommendations({
    level: input.level,
    owned: [],
    limit: input.count,
    random: input.random,
  }).map((word) => word.headword)
}
