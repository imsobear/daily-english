import { formsOf, usesWord } from '#/lib/inflections'
import type { CefrLevel } from '#/lib/settings'
import type { PartOfSpeech } from '#/lib/vocabulary'

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
  /**
   * The word itself in Chinese for this sense — 乐观的, not the definition
   * translated. Revealed only when asked for.
   */
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
 * The recipe a card was written by: this prompt, these checks, this model.
 *
 * Bump it whenever a change here would produce a better card for a word that
 * already has one. The nightly pass takes anything behind the current number,
 * so the pool rewrites itself over the following nights and nobody has to run
 * an UPDATE against production to make that happen.
 *
 * 1 — grounded in the dictionary, two examples a sense, examples checked
 *     against the headword. Everything before it was written from the
 *     headword alone.
 * 2 — grounded in the whole dictionary entry rather than the first three
 *     senses of its first homograph, and free to leave the pool's part of
 *     speech where the word is a second word rather than a second form. The
 *     two together are what "squash" needed to be a verb as well as a sport.
 */
export const CARD_VERSION = 2

/** What the writer is told about a word before it writes anything. */
export type CardSubject = {
  headword: string
  level: CefrLevel
  /** What the free dictionary has. Empty when it had nothing to say. */
  dictionary: Sense[]
  /**
   * The part of speech the pool teaches this word as, when it is in the pool.
   * The card leads with it.
   */
  pos: PartOfSpeech | null
  /**
   * The word this one is a form of — `build` under `building` — when it is
   * only a form. That is the one case where the part of speech above is a
   * wall rather than a starting point, because the word underneath has a card
   * of its own and the dictionary files both under the same spelling.
   */
  formOf: string | null
}

const POS_NAMES: Record<PartOfSpeech, string> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
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

/**
 * One sentence shows the word; two show it is not a fluke.
 *
 * A definition tells you what a word means and a single example tells you one
 * place it goes. The second is where the pattern starts to be visible, and it
 * costs a line on the word page and nothing anywhere else — the feed card and
 * the sheet over an article still show the first and have no room for more.
 */
const EXAMPLES_PER_SENSE = 2

/**
 * What the dictionary already says, so the model has something true to work
 * from. Asked cold, it invents the entry, and an inflected headword is where
 * that shows: `dancing` came back as the verb `dance` and `cleaner` as the
 * comparative of `clean`, because nothing had told it otherwise.
 */
function dictionaryBrief(senses: Sense[]) {
  if (senses.length === 0) {
    return `The free dictionary has nothing for this word, so the card is yours alone. Give only meanings you are sure of: one certain meaning beats three with a guess among them.`
  }
  const lines = senses
    .slice(0, 8)
    .map((sense) => `  ${sense.pos || '?'} — ${sense.definition}`)
    .join('\n')
  return `A free dictionary has these meanings for it. The list may be out of order, incomplete, or written for a native speaker:
${lines}
Work from that list: keep the meanings a learner actually meets, drop the archaic and the narrowly technical, put them in the order they are met, and rewrite each one in plain English. Add a meaning only where the list has plainly missed a common one.`
}

/**
 * Which part of speech the card leads with, and which it must not wander into.
 *
 * The pool's tag was once a wall — every sense had to be that part of speech —
 * which is right for a word that is a form of another one and wrong for a word
 * that is simply two words. It cost "squash" the verb: the pool carries it as a
 * noun, so the card came back as a sport, a drink and a cramped space, and the
 * everyday sense of crushing something was nowhere. The wall now stands only
 * where `formOf` says the word underneath has a card of its own.
 */
function posRule(subject: CardSubject) {
  const { headword, pos, formOf } = subject
  if (!pos) return ''
  if (formOf) {
    return `\nThis card is for "${headword}" as a ${POS_NAMES[pos]} and nothing else — every sense must be that part of speech. "${headword}" is also a form of "${formOf}", which has a card of its own, and the dictionary files both under this spelling: skip everything in the list that belongs to "${formOf}" rather than to "${headword}". For "dancing" as a noun, describe the activity and never the verb "dance"; for "cleaner" as a noun, describe the person and the liquid and never the comparative of "clean".\n`
  }
  return `\nThe learner meets "${headword}" as a ${POS_NAMES[pos]}, so the first sense must be that part of speech. Another may follow it where the word is a second word in its own right — "book" is carried as a noun, and a card that never mentions booking a table has left out half of what the learner needs.\n`
}

function complaintRule(complaints: string[]) {
  if (complaints.length === 0) return ''
  return `\nYour last answer was thrown away in part. What was wrong with it:\n${complaints
    .map((complaint) => `  - ${complaint}`)
    .join('\n')}\nWrite the card again with those fixed.\n`
}

export function wordCardPrompt(subject: CardSubject, complaints: string[] = []) {
  const { headword, level } = subject
  return `You write vocabulary cards for adult Chinese speakers learning English, tagged CEFR ${level}. They read news, essays and fiction, and they are trying to learn to *use* the word, not just recognise it.

Write the card for "${headword}".

${dictionaryBrief(subject.dictionary)}
${posRule(subject)}${complaintRule(complaints)}
senses — up to ${MAX_SENSES}, most frequent first. Four fields each:
  "pos", in English: the part of speech, spelt out — noun, verb, adjective, adverb.
  "definition", in English: plain English a ${level} learner reads without a dictionary, never defining the word with itself or with a rarer word.
  "zh", in Chinese: what this sense of the word *is* — the one or two words a paper dictionary prints opposite it, separated by "；", no subject and no full stop. For "optimistic": "乐观的". For "risk" as a noun: "风险；危险". Never the English definition translated, and never the example translated: "对未来或情况持积极期待" describes the word instead of giving it, and is the commonest way to get this wrong. The gloss answers the definition standing beside it and leads where that definition leads: for "to crush something flat" the gloss is "压扁；挤压", and "镇压" belongs to a definition about putting a stop to something. For an adverb, give the adverb: "personally" is "就我个人而言", not "个人的".
  "examples", in English: ${EXAMPLES_PER_SENSE} sentences, both containing "${headword}" itself and using it in this sense and this part of speech. A word built from it will not do — "elimination" is not "eliminate" — and neither is the word doing a different job in the sentence. The first sentence must show one of the collocations you list below.
Two senses that differ only in wording are one sense; give the place to a meaning that is genuinely different.
Keep every example ordinary, the sort of thing anybody might say about everyday life. No real people, no real places, no history, no science, no numbers anyone could check. A learner reads an example as fact and cannot tell when it is wrong, so the safe sentence is the one that claims nothing.
The "zh" fields are the only Chinese anywhere in your answer. Writing a definition or an example in Chinese ruins the card.

collocations — the partner words this one really appears with, most frequent first, three to six of them. Each must contain "${headword}" and at least one other word that carries meaning: "get rid of", never "rid the".

family — other words built from the same stem: different parts of speech, not different forms of the same word. "risky" and "riskiness" belong; "risked", "risking", "riskier" do not. Leave the list empty rather than inventing a form nobody writes.

Reply with JSON only:
{"senses":[{"pos":"noun","definition":"...","zh":"...","examples":["...","..."]}],"collocations":["..."],"family":[{"word":"...","pos":"..."}]}`
}

/** The shape of the model call, kept here so the tests can read it. */
export function wordCardRequest(subject: CardSubject, complaints: string[] = []) {
  return {
    messages: [
      { role: 'user' as const, content: wordCardPrompt(subject, complaints) },
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
 * A word family is other words, not other endings.
 *
 * Asked for one, a model reliably offers "riskier" alongside "risky" and
 * "thrived" alongside "thrive". Neither teaches anything: they are the grammar
 * the learner already has, taking up the room a real derivative wants.
 */
function keepFamily(headword: string, family: WordRelative[]) {
  const bases = [headword.toLowerCase(), ...family.map((item) => item.word)]
  return family.filter((item) => {
    if (item.word === headword.toLowerCase()) return false
    // A noun in `-er` is the person who does it rather than more of it, and
    // is worth more room on the card than most of what the model offers.
    const comparative = !item.pos.startsWith('n')
    return !bases.some(
      (base) =>
        base !== item.word && formsOf(base, { comparative }).has(item.word),
    )
  })
}

/**
 * A card, and everything that had to be thrown away to get it.
 *
 * The complaints are what makes a second attempt worth paying for: the model
 * is told what went wrong rather than asked the same question again, and the
 * better of the two answers is the one kept.
 */
export type ReadCard = { card: WordCard; complaints: string[] }

/**
 * Read a model's answer, keeping only the parts of it that are usable.
 *
 * Anything malformed is dropped rather than repaired, and a card left with no
 * senses is no card at all — returning null there means the word keeps
 * whatever the dictionary gave it and the next pass can try again.
 *
 * The checks below are not style. Every one of them is a way a real card in
 * production went wrong: a sense illustrated with a different word, a second
 * sense that was the first one said again, an adverb glossed as an adjective,
 * "a fever is when your temperature is high" as the definition of "fever".
 */
export function parseWordCard(
  headword: string,
  raw: unknown,
  subject?: Pick<CardSubject, 'pos' | 'formOf'>,
): ReadCard | null {
  const source =
    typeof raw === 'string' ? tryParse(raw) : ((raw ?? null) as Record<
      string,
      unknown
    > | null)
  if (!source || typeof source !== 'object') return null

  const complaints: string[] = []
  const word = headword.toLowerCase()
  const seen = new Set<string>()
  const formOf = subject?.formOf ?? null
  const locked = formOf && subject?.pos ? POS_NAMES[subject.pos] : null

  const senses = asArray(source.senses)
    .flatMap((item) => {
      const sense = item as Record<string, unknown>
      const definition = text(sense?.definition, 200)
      // Asked for a card in English and a gloss in Chinese, the model
      // sometimes answers the whole sense in Chinese. A definition a learner
      // cannot read is worse than the plain dictionary one it would replace.
      if (!definition || CHINESE.test(definition)) {
        complaints.push('a definition came back in Chinese, or empty')
        return []
      }
      const pos = text(sense?.pos, 24) ?? ''
      // Grounded on a dictionary that files "build" under "building", the
      // model writes the verb out as a second sense and reads the list as
      // permission. It is the one word the card is not about.
      if (locked && pos && !pos.startsWith(locked)) {
        complaints.push(
          `"${headword}" as a ${pos} is really "${formOf}", which is not this card`,
        )
        return []
      }

      // Two dozen characters is several Chinese equivalents and nowhere near a
      // sentence, which is the failure this length is here to catch: asked
      // what the word is, a model will sometimes explain what it means.
      const written = text(sense?.zh, 24)
      // A gloss belongs beside the definition; a translated example sentence
      // beside it only confuses what is being defined. Told not to, the model
      // does it anyway often enough to be worth catching, and gives itself
      // away every time by ending like a sentence.
      let zh =
        written && CHINESE.test(written) && !/[。！？.!?]$/.test(written)
          ? written
          : null
      if (zh && pos.startsWith('adv') && zh.endsWith('的')) {
        complaints.push(
          `"${zh}" is the adjective, not the adverb this sense is`,
        )
        zh = null
      }

      // The same meaning twice, which is how a three-sense card ends up
      // teaching two things. Keyed on the Chinese because that is the shortest
      // statement of a sense and the hardest to reword by accident.
      const key = zh ?? definition.toLowerCase()
      if (seen.has(key)) {
        complaints.push(`two senses both mean "${key}"`)
        return []
      }
      seen.add(key)

      if (definition.toLowerCase().includes(word)) {
        complaints.push(`the definition of "${headword}" uses the word itself`)
      }

      const examples = readExamples(sense, headword, complaints)
      return [{ pos, definition, zh, examples }]
    })
    .slice(0, MAX_SENSES)
  if (senses.length === 0) return null

  if (!senses.some((sense) => sense.zh)) {
    complaints.push('no sense came back with its Chinese')
  }

  const family = keepFamily(
    headword,
    asArray(source.family)
      .flatMap((item) => {
        const relative = item as Record<string, unknown>
        const kin = text(relative?.word, 40)?.toLowerCase()
        return kin ? [{ word: kin, pos: text(relative?.pos, 24) ?? '' }] : []
      })
      .slice(0, MAX_FAMILY * 2),
  ).slice(0, MAX_FAMILY)

  return {
    card: {
      senses,
      collocations: readCollocations(source.collocations, headword, complaints),
      family,
    },
    complaints,
  }
}

function readExamples(
  sense: Record<string, unknown>,
  headword: string,
  complaints: string[],
) {
  const written = Array.isArray(sense?.examples)
    ? sense.examples
    : [sense?.example]

  const examples = written.flatMap((item) => {
    const sentence = text(item, 240)
    if (!sentence || CHINESE.test(sentence)) return []
    // The failure this is here for is subtle enough to read past: a sense of
    // "eliminate" illustrated with "the elimination round", which is a real
    // sentence about a different word. Anything that is only a relative of the
    // headword fails, and the sense keeps the example that did use it.
    if (!usesWord(sentence, headword)) {
      complaints.push(`"${sentence}" does not use "${headword}" itself`)
      return []
    }
    return [sentence]
  })

  if (examples.length === 0) {
    complaints.push(`no usable example for one sense of "${headword}"`)
  }
  return examples.slice(0, EXAMPLES_PER_SENSE)
}

/**
 * The phrases a word keeps company with, minus the fragments.
 *
 * "rid the" came back for "rid", which is grammar caught mid-sentence rather
 * than a phrase anyone would look up; the phrase that matters, "get rid of",
 * was missing. A collocation has to contain the word and say something beyond
 * it.
 */
function readCollocations(
  raw: unknown,
  headword: string,
  complaints: string[],
) {
  const phrases = new Set<string>()
  for (const item of asArray(raw)) {
    const phrase = text(item, 48)?.toLowerCase()
    // A single word is not a collocation, it is the word again.
    if (!phrase?.includes(' ')) continue
    if (!usesWord(phrase, headword)) continue
    if (/\b(a|an|the)$/.test(phrase)) {
      complaints.push(`"${phrase}" is a fragment, not a phrase`)
      continue
    }
    phrases.add(phrase)
  }
  return [...phrases].slice(0, MAX_COLLOCATIONS)
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
export type WorkersAi = {
  accountId: string | null
  apiKey: string | null
  mockUrl: string | null
}

export async function describeWord(
  subject: CardSubject,
  ai: WorkersAi,
  complaints: string[] = [],
): Promise<ReadCard | null> {
  const url = ai.mockUrl
    ? ai.mockUrl
    : ai.accountId && ai.apiKey
      ? `https://api.cloudflare.com/client/v4/accounts/${ai.accountId}/ai/run/${WORD_CARD_MODEL}`
      : null
  if (!url) return null

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ai.apiKey && !ai.mockUrl
        ? { Authorization: `Bearer ${ai.apiKey}` }
        : {}),
    },
    body: JSON.stringify(wordCardRequest(subject, complaints)),
  })
  if (!response.ok) {
    throw new Error(`Workers AI ${response.status}: ${await response.text()}`)
  }

  const body = (await response.json()) as { result?: unknown }
  return parseWordCard(
    subject.headword,
    modelText(body.result ?? body),
    subject,
  )
}

/**
 * A card, with one second go when the first one lost something on the way in.
 *
 * The checks throw away whole senses — one written in Chinese, one that is the
 * sense above said again, one illustrated with a different word — and a word
 * described today is not looked at again until the recipe changes, so a thin
 * card is a thin card for months. The second attempt is told exactly what was
 * dropped, which is the difference between asking again and asking better.
 * Twice unlucky is an answer too: the fuller of the two cards goes out.
 */
export async function describeWordTwice(subject: CardSubject, ai: WorkersAi) {
  const first = await describeWord(subject, ai)
  if (first && first.complaints.length === 0) return first.card

  const second = await describeWord(subject, ai, first?.complaints ?? [])
  if (second && second.complaints.length === 0) return second.card

  if (!first || !second) return (first ?? second)?.card ?? null
  return second.complaints.length < first.complaints.length
    ? second.card
    : first.card
}

export function readWorkersAi(env: {
  CLOUDFLARE_ACCOUNT_ID?: string
  WORKERS_AI_API_TOKEN?: string
  WORKERS_AI_MOCK_URL?: string
}): WorkersAi {
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
