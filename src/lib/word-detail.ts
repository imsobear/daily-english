import type { CefrLevel } from '#/lib/settings'

/**
 * What a word card says beyond its definition.
 *
 * A definition is enough to recognise a word and not nearly enough to use one:
 * knowing that risk is "the chance something bad happens" leaves you no closer
 * to writing "risk factor" or "at risk of". So the model is asked for the
 * things a dictionary buries — the pattern the word lives in, the phrases it
 * keeps company with, the rest of its family — and the answer is kept in the
 * shared entry, written once and read by everyone.
 *
 * Every field is optional in practice. A word the pass has not reached yet, or
 * one the model half answered, falls back to the definition and example the
 * entry already had.
 */
export type WordUsage = {
  /** The pattern with its slots showing: "at risk of something". */
  pattern: string
  example: string
}

export type WordSense = {
  pos: string
  definition: string
  example: string | null
}

export type WordRelative = {
  word: string
  pos: string
}

export type WordDetail = {
  usage: WordUsage | null
  senses: WordSense[]
  collocations: string[]
  family: WordRelative[]
  /** A few words of Chinese, hidden until asked for. */
  zh: string | null
}

/**
 * Bigger than the model that writes the articles, and worth it.
 *
 * This is lexicography rather than fluency — which pattern matters most,
 * whether two near-synonyms really differ — and the smaller models answer it
 * plausibly rather than correctly. It is also paid for once per word ever, so
 * the price of the best model available is a few dollars for the whole pool.
 */
export const WORD_DETAIL_MODEL = '@cf/openai/gpt-oss-120b'

/**
 * Room for three senses with examples, and then some.
 *
 * A truncated answer is not a shorter card, it is unparseable JSON and a call
 * paid for twice, while headroom nobody uses costs nothing — output tokens are
 * billed as they are written. The reasoning models spend some of this budget
 * thinking before they answer, which is what made 1500 too tight.
 */
const MAX_TOKENS = 2500

const MAX_SENSES = 3
const MAX_COLLOCATIONS = 6
const MAX_FAMILY = 4

export function wordDetailPrompt(headword: string, level: CefrLevel) {
  return `You write vocabulary cards for adult Chinese speakers learning English, tagged CEFR ${level}. They read news, essays and fiction, and they are trying to learn to *use* the word, not just recognise it.

Write the card for "${headword}".

usage — the single most useful pattern this word appears in, written as a phrase a learner could read aloud. Ordinary words in the slots: "something", "somebody", "doing something". No plus signs, no blanks, and no grammar shorthand like "V-ing", "sth" or "N". Write "risk doing something", "at risk of something", "comply with something", "tell somebody about something". For an adjective, show the nouns it goes in front of: "a bleak outlook/future/picture". Give one natural sentence using exactly that pattern. This is the line on the front of the card, so pick the pattern a learner most needs.

senses — up to ${MAX_SENSES}, most frequent first, each with its own example. Plain English a ${level} learner reads without a dictionary; never define the word with itself or with a rarer word. Examples should sound like real modern writing or speech, each in a different context from the others and from the usage sentence.

collocations — the partner words this one really appears with, most frequent first, three to six of them. Real two- or three-word phrases, not single words.

family — other words built from the same stem: different parts of speech, not different forms of the same word. "risky" and "riskiness" belong; "risked", "risking", "riskier" do not. Leave the list empty rather than inventing a form nobody writes.

zh — a short Chinese gloss, a few words covering the main senses, not a sentence.

Reply with JSON only:
{"usage":{"pattern":"...","example":"..."},"senses":[{"pos":"noun","definition":"...","example":"..."}],"collocations":["..."],"family":[{"word":"...","pos":"..."}],"zh":"..."}`
}

/** The shape of the model call, kept here so the tests can read it. */
export function wordDetailRequest(headword: string, level: CefrLevel) {
  return {
    messages: [
      { role: 'user' as const, content: wordDetailPrompt(headword, level) },
    ],
    max_tokens: MAX_TOKENS,
    // Low, but not zero: this is writing, and the examples read better with a
    // little room than with none.
    temperature: 0.3,
  }
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed && trimmed.length <= limit ? trimmed : null
}

/**
 * The forms of a word that are the same word.
 *
 * Asked for a word family, a model reliably offers "riskier" alongside "risky"
 * and "thrived" alongside "thrive". Neither teaches anything: they are the
 * grammar the learner already has, taking up the room a real derivative wants.
 * Generating the plausible inflections of each base and rejecting matches is
 * cruder than a stemmer and much easier to be sure of — it can only ever
 * remove a word that some other word in the same list already implies.
 */
function inflectionsOf(base: string) {
  const forms = new Set<string>([
    `${base}s`,
    `${base}es`,
    `${base}ed`,
    `${base}d`,
    `${base}ing`,
    `${base}er`,
    `${base}est`,
  ])
  if (base.endsWith('e')) {
    const stem = base.slice(0, -1)
    for (const suffix of ['ed', 'ing', 'er', 'est']) forms.add(stem + suffix)
  }
  if (base.endsWith('y')) {
    const stem = `${base.slice(0, -1)}i`
    // Not "-ly": riskily is an adverb the learner does not already know how to
    // build, so it stays.
    for (const suffix of ['es', 'ed', 'er', 'est']) forms.add(stem + suffix)
  }
  const last = base.at(-1) ?? ''
  const vowel = base.at(-2) ?? ''
  if (last && !'aeiou'.includes(last) && 'aeiou'.includes(vowel)) {
    for (const suffix of ['ed', 'ing', 'er', 'est']) {
      forms.add(base + last + suffix)
    }
  }
  return forms
}

/**
 * Grammar notation, where a phrase was asked for.
 *
 * Told twice over to write "risk doing something" rather than "risk + V-ing",
 * the model still reaches for the shorthand every tenth word or so — and a
 * dictionary convention nobody taught the learner is worse than no pattern at
 * all, so the card goes out without one and keeps everything else.
 */
function isShorthand(pattern: string) {
  return /\+|\.\.\.|…|_|\[|\bV-ing\b|\bsth\b|\bsb\b|\bN\b/i.test(pattern)
}

function keepFamily(headword: string, family: WordRelative[]) {
  const bases = [headword.toLowerCase(), ...family.map((item) => item.word)]
  return family.filter((item) => {
    if (item.word === headword.toLowerCase()) return false
    return !bases.some(
      (base) => base !== item.word && inflectionsOf(base).has(item.word),
    )
  })
}

/**
 * Read a model's answer, keeping only the parts of it that are usable.
 *
 * Anything malformed is dropped rather than repaired, and a card left with no
 * senses is no card at all — returning null there means the word keeps whatever
 * the dictionary gave it and the next pass can try again.
 */
export function parseWordDetail(
  headword: string,
  raw: unknown,
): WordDetail | null {
  const source =
    typeof raw === 'string' ? tryParse(raw) : ((raw ?? null) as Record<
      string,
      unknown
    > | null)
  if (!source || typeof source !== 'object') return null

  const senses = asArray(source.senses)
    .flatMap((item) => {
      const sense = item as Record<string, unknown>
      const definition = text(sense?.definition, 200)
      const pos = text(sense?.pos, 24)
      return definition ? [{ pos: pos ?? '', definition, example: text(sense?.example, 240) }] : []
    })
    .slice(0, MAX_SENSES)
  if (senses.length === 0) return null

  const rawUsage = source.usage as Record<string, unknown> | undefined
  const candidate = text(rawUsage?.pattern, 80)
  const pattern = candidate && !isShorthand(candidate) ? candidate : null
  const example = text(rawUsage?.example, 240)

  const family = keepFamily(
    headword,
    asArray(source.family)
      .flatMap((item) => {
        const relative = item as Record<string, unknown>
        const word = text(relative?.word, 40)?.toLowerCase()
        return word ? [{ word, pos: text(relative?.pos, 24) ?? '' }] : []
      })
      .slice(0, MAX_FAMILY * 2),
  ).slice(0, MAX_FAMILY)

  return {
    usage: pattern && example ? { pattern, example } : null,
    senses,
    collocations: [
      ...new Set(
        asArray(source.collocations).flatMap((item) => {
          const phrase = text(item, 48)?.toLowerCase()
          // A single word is not a collocation, it is the word again — and a
          // phrase the pattern above already shows is a line of the card spent
          // saying the same thing twice.
          if (!phrase || !phrase.includes(' ')) return []
          return phrase === pattern?.toLowerCase() ? [] : [phrase]
        }),
      ),
    ].slice(0, MAX_COLLOCATIONS),
    family,
    zh: text(source.zh, 40),
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function tryParse(raw: string) {
  // Models wrap JSON in prose and fences however firmly they are asked not to.
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Ask Workers AI for one word's card.
 *
 * Over REST with a token rather than through the `AI` binding: the binding has
 * no local implementation, so merely declaring it makes every test open an
 * authenticated session to Cloudflare. HTTP is also how DeepSeek and OpenAI are
 * reached here, mock URL and all, so local runs stay free.
 *
 * Returns null when nothing is configured, when the call fails, or when the
 * answer is unusable — all of which mean the same thing to the caller: this
 * word keeps the definition it had, and the next pass can try again.
 */
export async function describeWord(input: {
  headword: string
  level: CefrLevel
  accountId: string | null
  apiKey: string | null
  mockUrl: string | null
}): Promise<WordDetail | null> {
  const url = input.mockUrl
    ? input.mockUrl
    : input.accountId && input.apiKey
      ? `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/ai/run/${WORD_DETAIL_MODEL}`
      : null
  if (!url) return null

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.apiKey && !input.mockUrl
        ? { Authorization: `Bearer ${input.apiKey}` }
        : {}),
    },
    body: JSON.stringify(wordDetailRequest(input.headword, input.level)),
  })
  if (!response.ok) {
    throw new Error(`Workers AI ${response.status}: ${await response.text()}`)
  }

  const body = (await response.json()) as { result?: unknown }
  return parseWordDetail(input.headword, modelText(body.result ?? body))
}

export function readWorkersAi(env: {
  CLOUDFLARE_ACCOUNT_ID?: string
  WORKERS_AI_API_TOKEN?: string
  WORKERS_AI_MOCK_URL?: string
}) {
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim() || null,
    apiKey: env.WORKERS_AI_API_TOKEN?.trim() || null,
    mockUrl: env.WORKERS_AI_MOCK_URL?.trim() || null,
  }
}

/** Pull the text out of whichever envelope the model on duty replies in. */
export function modelText(result: unknown): string {
  const body = result as {
    response?: unknown
    choices?: { message?: { content?: unknown } }[]
  }
  if (typeof body?.response === 'string') return body.response
  const content = body?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

export function serializeWordDetail(detail: WordDetail) {
  return JSON.stringify(detail)
}

export function readWordDetail(raw: string | null | undefined) {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as WordDetail
    return value && Array.isArray(value.senses) ? value : null
  } catch {
    return null
  }
}
