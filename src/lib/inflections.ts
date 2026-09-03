import type { PartOfSpeech } from '#/lib/vocabulary'

/**
 * The forms of a word that are still the same word.
 *
 * Two jobs, both about telling a word from its relatives. A card's examples
 * have to contain the word they illustrate — the model will happily show
 * "eliminate" with a sentence about an elimination round — and a word's family
 * should list the words built from it rather than its own inflections, which
 * are grammar the learner already has.
 *
 * Regular endings are generated, since the rules are short and the cost of
 * being generous is only that a check lets something through. Irregular verbs
 * and plurals cannot be generated at all, so the common ones are listed: they
 * are a closed class, and leaving them out would strip the examples off
 * "give", "tell" and "swear", which are exactly the words worth showing.
 */
const IRREGULAR: Record<string, string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  begin: ['began', 'begun'],
  bet: ['bet'],
  bind: ['bound'],
  bite: ['bit', 'bitten'],
  bleed: ['bled'],
  blow: ['blew', 'blown'],
  break: ['broke', 'broken'],
  bring: ['brought'],
  build: ['built'],
  burn: ['burnt'],
  burst: ['burst'],
  buy: ['bought'],
  catch: ['caught'],
  choose: ['chose', 'chosen'],
  come: ['came'],
  cost: ['cost'],
  cut: ['cut'],
  deal: ['dealt'],
  dig: ['dug'],
  do: ['does', 'did', 'done'],
  draw: ['drew', 'drawn'],
  drink: ['drank', 'drunk'],
  drive: ['drove', 'driven'],
  eat: ['ate', 'eaten'],
  fall: ['fell', 'fallen'],
  feed: ['fed'],
  feel: ['felt'],
  fight: ['fought'],
  find: ['found'],
  fly: ['flew', 'flown'],
  forget: ['forgot', 'forgotten'],
  forgive: ['forgave', 'forgiven'],
  freeze: ['froze', 'frozen'],
  get: ['got', 'gotten'],
  give: ['gave', 'given'],
  go: ['goes', 'went', 'gone'],
  grow: ['grew', 'grown'],
  hang: ['hung'],
  have: ['has', 'had'],
  hear: ['heard'],
  hide: ['hid', 'hidden'],
  hit: ['hit'],
  hold: ['held'],
  hurt: ['hurt'],
  keep: ['kept'],
  know: ['knew', 'known'],
  lay: ['laid'],
  lead: ['led'],
  learn: ['learnt'],
  leave: ['left'],
  lend: ['lent'],
  let: ['let'],
  lie: ['lay', 'lain'],
  light: ['lit'],
  lose: ['lost'],
  make: ['made'],
  mean: ['meant'],
  meet: ['met'],
  pay: ['paid'],
  put: ['put'],
  quit: ['quit'],
  read: ['read'],
  ride: ['rode', 'ridden'],
  ring: ['rang', 'rung'],
  rise: ['rose', 'risen'],
  rid: ['rid'],
  run: ['ran'],
  say: ['said'],
  see: ['saw', 'seen'],
  seek: ['sought'],
  sell: ['sold'],
  send: ['sent'],
  set: ['set'],
  shake: ['shook', 'shaken'],
  shine: ['shone'],
  shoot: ['shot'],
  show: ['shown'],
  shut: ['shut'],
  sing: ['sang', 'sung'],
  sink: ['sank', 'sunk'],
  sit: ['sat'],
  sleep: ['slept'],
  speak: ['spoke', 'spoken'],
  spend: ['spent'],
  split: ['split'],
  spread: ['spread'],
  stand: ['stood'],
  steal: ['stole', 'stolen'],
  stick: ['stuck'],
  strike: ['struck'],
  swear: ['swore', 'sworn'],
  sweep: ['swept'],
  swim: ['swam', 'swum'],
  take: ['took', 'taken'],
  teach: ['taught'],
  tear: ['tore', 'torn'],
  tell: ['told'],
  think: ['thought'],
  throw: ['threw', 'thrown'],
  understand: ['understood'],
  wake: ['woke', 'woken'],
  wear: ['wore', 'worn'],
  win: ['won'],
  write: ['wrote', 'written'],

  analysis: ['analyses'],
  basis: ['bases'],
  child: ['children'],
  crisis: ['crises'],
  criterion: ['criteria'],
  foot: ['feet'],
  half: ['halves'],
  knife: ['knives'],
  leaf: ['leaves'],
  life: ['lives'],
  man: ['men'],
  medium: ['media'],
  mouse: ['mice'],
  person: ['people'],
  phenomenon: ['phenomena'],
  self: ['selves'],
  shelf: ['shelves'],
  thesis: ['theses'],
  thief: ['thieves'],
  tooth: ['teeth'],
  wife: ['wives'],
  woman: ['women'],
}

/**
 * Every spelling of one word: the regular endings and the irregular ones.
 *
 * `-er` and `-est` are two endings doing two jobs. On an adjective they are
 * the comparative, which is grammar; on a verb the `-er` is a different word
 * with a different part of speech — a writer is not a tense of "write". Ask
 * without them where that matters and the family keeps its nouns.
 */
export function formsOf(base: string, { comparative = true } = {}) {
  const word = base.toLowerCase()
  const endings = comparative
    ? ['ed', 'ing', 'er', 'est']
    : ['ed', 'ing']
  const forms = new Set<string>([
    word,
    `${word}s`,
    `${word}es`,
    `${word}d`,
    ...endings.map((ending) => word + ending),
  ])
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1)
    for (const ending of endings) forms.add(stem + ending)
  }
  if (word.endsWith('y')) {
    const stem = `${word.slice(0, -1)}i`
    // Not "-ly": riskily is an adverb the learner does not already know how to
    // build, so it stays a relative rather than becoming a form.
    for (const ending of ['es', ...endings]) forms.add(stem + ending)
  }
  const last = word.at(-1) ?? ''
  const vowel = word.at(-2) ?? ''
  if (last && !'aeiou'.includes(last) && 'aeiou'.includes(vowel)) {
    for (const ending of endings) forms.add(word + last + ending)
  }
  for (const irregular of IRREGULAR[word] ?? []) forms.add(irregular)
  return forms
}

/** Undo one ending, every way it could have been added. */
function stemsOf(word: string, ending: string) {
  const cut = word.slice(0, -ending.length)
  const stems = [cut, `${cut}e`]
  if (cut.length > 2 && cut.at(-1) === cut.at(-2)) stems.push(cut.slice(0, -1))
  if (cut.endsWith('i')) stems.push(`${cut.slice(0, -1)}y`)
  return stems
}

/**
 * The word this one is only a form of, if there is one.
 *
 * A headword that is a form of another word must not be described as that
 * other word: the card for "building" is the thing on the corner and the card
 * for "cleaner" is the person, however loudly the dictionary lists "build" and
 * "more clean" under the same spelling. A headword that merely has two jobs —
 * "squash", "book" — is a different case and needs both of them.
 *
 * Two questions separate them, and the ending alone answers neither. Whether
 * the shorter string is a word at all: "spring" keeps its verb because "spr"
 * is nothing. And what part of speech that word is, because an ending means
 * different things on different stems — `-ing` and `-ed` are only inflections
 * on a verb, `-er` and `-est` only on an adjective, which is what tells the
 * comparative "cleaner" from the person "manager" and "letter" from "let".
 */
export function baseForm(
  headword: string,
  partsOf: (word: string) => readonly PartOfSpeech[],
) {
  const word = headword.toLowerCase()

  const pick = (
    stems: string[],
    { least = 3, is }: { least?: number; is: PartOfSpeech[] },
  ) =>
    stems.find(
      (stem) =>
        stem.length >= least &&
        stem !== word &&
        partsOf(stem).some((pos) => is.includes(pos)),
    ) ?? null

  if (word.endsWith('ing')) return pick(stemsOf(word, 'ing'), { is: ['v'] })
  if (word.endsWith('ed')) {
    return pick([...stemsOf(word, 'ed'), word.slice(0, -1)], { is: ['v'] })
  }
  // Four letters, because the three-letter words the profiles happen to call
  // adjectives are the ones nobody compares: "off" is an adjective in "the
  // milk is off", and it made "offer" a comparative of it.
  const comparative = { least: 4, is: ['adj'] as PartOfSpeech[] }
  if (word.endsWith('est')) return pick(stemsOf(word, 'est'), comparative)
  if (word.endsWith('er')) return pick(stemsOf(word, 'er'), comparative)
  if (word.endsWith('ies')) {
    return pick([`${word.slice(0, -3)}y`], { is: ['n', 'v'] })
  }
  if (word.endsWith('es')) return pick([word.slice(0, -2)], { is: ['n', 'v'] })
  if (word.endsWith('s')) return pick([word.slice(0, -1)], { is: ['n', 'v'] })
  return null
}

/**
 * Whether a sentence really contains the word it is supposed to illustrate.
 *
 * A phrasal headword is checked on its verb alone — "point out" is written
 * "pointed the mistake out" as often as not, and a check that insisted on the
 * whole phrase would throw away the better sentence of the two.
 */
export function usesWord(sentence: string, headword: string) {
  const [first] = headword.toLowerCase().split(' ')
  const forms = formsOf(first)
  return sentence
    .toLowerCase()
    .split(/[^a-z0-9'-]+/)
    .some((token) => forms.has(token.replace(/^'+|'+$/g, '')))
}
