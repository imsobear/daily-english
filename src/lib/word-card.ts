import type { CefrLevel } from '#/lib/settings'

/**
 * Everything the app knows about a word, in one shape.
 *
 * A definition is enough to recognise a word and not nearly enough to use one:
 * knowing that risk is "the chance something bad happens" leaves you no closer
 * to writing "risk factor" or "at risk of". So a sense carries its own example
 * and its own Chinese, and the word carries the phrases it keeps company with
 * and the rest of its family.
 *
 * The free dictionary fills the same shape with what little it has — senses
 * with no Chinese — so nothing downstream has to ask where a word came from.
 */
export type Sense = {
  pos: string
  definition: string
  /** The same definition in Chinese, revealed only when asked for. */
  zh: string | null
  /** One today. Plural so a second needs no migration. */
  examples: string[]
}

export type WordRelative = {
  word: string
  pos: string
}

export type WordCard = {
  senses: Sense[]
  collocations: string[]
  family: WordRelative[]
}

/**
 * Bigger than the model that writes the articles, and worth it.
 *
 * This is lexicography rather than fluency — which pattern matters most,
 * whether two near-synonyms really differ — and the smaller models answer it
 * plausibly rather than correctly. It is also paid for once per word ever, so
 * the price of the best model available is a few dollars for the whole pool.
 */
export const WORD_CARD_MODEL = '@cf/openai/gpt-oss-120b'

/**
 * Room for three senses with examples, and then some.
 *
 * A truncated answer is not a shorter card, it is unparseable JSON and a call
 * paid for twice, while headroom nobody uses costs nothing — output tokens are
 * billed as they are written. The reasoning models spend some of this budget
 * thinking before they answer, which is what made 1500 too tight.
 */
const MAX_TOKENS = 2500

const CHINESE = /[\u3400-\u9fff\uf900-\ufaff]/

const MAX_SENSES = 3
const MAX_COLLOCATIONS = 6
const MAX_FAMILY = 4

export function wordCardPrompt(headword: string, level: CefrLevel) {
  return `You write vocabulary cards for adult Chinese speakers learning English, tagged CEFR ${level}. They read news, essays and fiction, and they are trying to learn to *use* the word, not just recognise it.

Write the card for "${headword}".

senses — up to ${MAX_SENSES}, most frequent first. Three fields each:
  "definition", in English: plain English a ${level} learner reads without a dictionary, never defining the word with itself or with a rarer word.
  "example", in English: one sentence that sounds like real modern writing or speech, in a different context from the other senses.
  "zh", in Chinese: that same definition again, as a dictionary gloss — a phrase, no subject, no full stop. For "risk": "风险，可能发生的坏事". Not a translation of the example, and not word by word off the English.
The "zh" fields are the only Chinese anywhere in your answer. Writing a definition or an example in Chinese ruins the card.

collocations — the partner words this one really appears with, most frequent first, three to six of them. Real two- or three-word phrases, not single words.

family — other words built from the same stem: different parts of speech, not different forms of the same word. "risky" and "riskiness" belong; "risked", "risking", "riskier" do not. Leave the list empty rather than inventing a form nobody writes.

Reply with JSON only:
{"senses":[{"pos":"noun","definition":"...","example":"...","zh":"..."}],"collocations":["..."],"family":[{"word":"...","pos":"..."}]}`
}

/** The shape of the model call, kept here so the tests can read it. */
export function wordCardRequest(headword: string, level: CefrLevel) {
  return {
    messages: [
      { role: 'user' as const, content: wordCardPrompt(headword, level) },
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
export function parseWordCard(
  headword: string,
  raw: unknown,
): WordCard | null {
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
      // Asked for a card in English and a gloss in Chinese, the model
      // sometimes answers the whole sense in Chinese. A definition a learner
      // cannot read is worse than the plain dictionary one it would replace.
      if (!definition || CHINESE.test(definition)) return []
      const example = text(sense?.example, 240)
      const zh = text(sense?.zh, 80)
      return [
        {
          pos: text(sense?.pos, 24) ?? '',
          definition,
          // A gloss belongs beside the definition; a translated example
          // sentence beside it only confuses what is being defined. Told not
          // to, the model does it anyway often enough to be worth catching,
          // and gives itself away every time by ending like a sentence.
          zh: zh && CHINESE.test(zh) && !/[。！？.!?]$/.test(zh) ? zh : null,
          examples: example && !CHINESE.test(example) ? [example] : [],
        },
      ]
    })
    .slice(0, MAX_SENSES)
  if (senses.length === 0) return null

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
    senses,
    collocations: [
      ...new Set(
        asArray(source.collocations).flatMap((item) => {
          const phrase = text(item, 48)?.toLowerCase()
          // A single word is not a collocation, it is the word again.
          return phrase?.includes(' ') ? [phrase] : []
        }),
      ),
    ].slice(0, MAX_COLLOCATIONS),
    family,
  }
}

/** Whether there is any Chinese to offer, and so any button to offer it with. */
export function hasChinese(senses: Sense[]) {
  return senses.some((sense) => sense.zh)
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
}): Promise<WordCard | null> {
  const url = input.mockUrl
    ? input.mockUrl
    : input.accountId && input.apiKey
      ? `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/ai/run/${WORD_CARD_MODEL}`
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
    body: JSON.stringify(wordCardRequest(input.headword, input.level)),
  })
  if (!response.ok) {
    throw new Error(`Workers AI ${response.status}: ${await response.text()}`)
  }

  const body = (await response.json()) as { result?: unknown }
  return parseWordCard(input.headword, modelText(body.result ?? body))
}

/**
 * A card, with one second go if little of the first one survived.
 *
 * Some words send the model into Chinese for a whole sense, or into
 * translating the example instead of the definition, and the parsing throws
 * that away — leaving a thin card, or none. The pass skips whatever already
 * has a card, so there is no later run to make it good. Asking twice costs a
 * second call for a minority of words and settles it; twice unlucky is an
 * answer too, and that card goes out in English.
 */
export async function describeWordTwice(input: {
  headword: string
  level: CefrLevel
  accountId: string | null
  apiKey: string | null
  mockUrl: string | null
}) {
  const first = await describeWord(input)
  if (first && hasChinese(first.senses)) return first
  const second = await describeWord(input)
  if (second && hasChinese(second.senses)) return second
  return first ?? second
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

/**
 * Read one of the JSON list columns, giving back an empty list rather than
 * throwing on anything malformed. A word with a broken column should look like
 * a word nobody has described yet, not a page that will not render.
 */
export function readList<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}
