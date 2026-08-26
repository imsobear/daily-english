export const CEFR_LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'] as const
export type CefrLevel = (typeof CEFR_LEVELS)[number]

export const TOPIC_PRESETS = [
  'daily',
  'work',
  'travel',
  'tech',
  'science',
  'health',
  'food',
  'business',
  'culture',
  'nature',
  'news',
] as const

/**
 * Themes for an article that has no target words to shape it.
 *
 * Without them a learner with an empty list gets "everyday life" every day,
 * and one temperature-0.7 prompt repeated daily converges on the same article.
 * Phrases rather than the single-word topic presets, because this is the only
 * steer the writer gets.
 */
export const ARTICLE_THEMES = [
  'a small habit that changes a day',
  'how something ordinary is made',
  'a place most visitors walk past',
  'a job that is rarely noticed',
  'food, and where it comes from',
  'a hobby that takes years to learn',
  'weather, and the people it inconveniences',
  'an old object still in daily use',
  'a machine that quietly does its work',
  'how a neighbourhood changes over time',
  'sleep, rest and the trouble with both',
  'money and the small decisions around it',
  'a mistake that turned out useful',
  'animals living alongside a city',
  'the last mile of a long journey',
] as const

/** A theme this learner has not just had. */
export function pickTheme(recent: string[], random = Math.random): string {
  const fresh = ARTICLE_THEMES.filter((theme) => !recent.includes(theme))
  const choices = fresh.length > 0 ? fresh : ARTICLE_THEMES
  return choices[Math.floor(random() * choices.length)] ?? choices[0]
}

export type Settings = {
  cefrLevel: CefrLevel
  topics: string[]
  wordsPerLesson: number
}

export const defaultSettings: Settings = {
  cefrLevel: 'B1',
  topics: [],
  wordsPerLesson: 10,
}
