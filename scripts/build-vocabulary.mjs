/**
 * Rebuild src/data/vocabulary.ts from published vocabulary profiles.
 *
 *   node scripts/build-vocabulary.mjs
 *
 * The result is committed, so this only runs when the sources change or the
 * bands below are retuned. Nothing fetches at runtime.
 *
 * Words rejected by `curate-vocabulary.mjs` are left out. That file is the
 * judgement half of this list — which of these words is worth a learner's
 * attention — and it is cached rather than recomputed here.
 */
import { readFile, writeFile } from 'node:fs/promises'

const SOURCES = [
  {
    name: 'CEFR-J Vocabulary Profile 1.5',
    url: 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv',
  },
  {
    name: 'Octanove Vocabulary Profile C1/C2 1.0',
    url: 'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv',
  },
]

/** Word frequencies over a web corpus, used to rank and to trim both tails. */
const FREQUENCY_URL = 'https://norvig.com/ngrams/count_1w.txt'

const POS = new Map([
  ['noun', 'n'],
  ['verb', 'v'],
  ['adjective', 'adj'],
  ['adverb', 'adv'],
])

/**
 * The frequency window each level keeps, as a rank into the corpus above.
 *
 * The floor drops words a learner at that level has met a thousand times
 * ("major", "cause"); the ceiling drops words they will never meet again
 * ("armful", "beguilingly"). Both loosen as the level rises, because an
 * advanced learner is exactly the person who should be shown a rarer word.
 */
const BANDS = {
  A2: [300, 10_000],
  B1: [800, 20_000],
  B2: [1_500, 40_000],
  C1: [2_000, 80_000],
  C2: [2_500, 120_000],
}

/**
 * Corpus-frequent enough to survive the bands, still no use in a lesson.
 *
 * The second group is the point of keeping this by hand: the profiles were
 * written when "retard" and "queer" were ordinary B2 vocabulary, and a
 * learning app should not be the thing that teaches someone to use them.
 */
const BLOCKED = new Set([
  'barf',
  'boob',
  'crap',
  'fart',
  'pee',
  'poo',
  'poop',
  'puke',
  'snot',

  // Tagged as adverbs by the profiles and so not caught by the part-of-speech
  // filter, but nobody needs a card for "too". The discourse adverbs a learner
  // does have to be taught — however, instead, therefore — are kept.
  'again',
  'almost',
  'already',
  'always',
  'anyway',
  'anywhere',
  'else',
  'ever',
  'everywhere',
  'maybe',
  'never',
  'often',
  'once',
  'perhaps',
  'quite',
  'rather',
  'really',
  'soon',
  'sometimes',
  'somewhere',
  'still',
  'together',
  'tomorrow',
  'tonight',
  'too',
  'usually',
  'why',
  'yet',

  'cripple',
  'idiot',
  'imbecile',
  'lame',
  'midget',
  'moron',
  'negro',
  'oriental',
  'queer',
  'retard',
  'retarded',
  'spastic',
])

export const VERDICTS = new URL('./vocabulary-verdicts.json', import.meta.url)

const fetched = new Map()

async function fetchText(url) {
  if (!fetched.has(url)) {
    fetched.set(
      url,
      fetch(url).then((response) => {
        if (!response.ok) throw new Error(`${url} → ${response.status}`)
        return response.text()
      }),
    )
  }
  return fetched.get(url)
}

/** Both profiles, as rows, before anything is decided about them. */
async function profileRows() {
  const rows = []
  for (const source of SOURCES) {
    rows.push(...parseCsv(await fetchText(source.url)))
  }
  return rows
}

/** `{ headword: 'keep' | 'drop' }`, or empty before the first curation run. */
export async function readVerdicts() {
  try {
    return JSON.parse(await readFile(VERDICTS, 'utf8'))
  } catch {
    return {}
  }
}

/** The profiles are plain comma-separated with a header row. */
function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/)
  const columns = header.split(',').map((name) => name.trim())
  return lines.map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? '']))
  })
}

/**
 * Every word the profiles offer for each level, most useful first, before any
 * judgement about whether it is worth learning.
 */
export async function candidates() {
  const rows = await profileRows()

  const ranks = new Map()
  const frequencies = await fetchText(FREQUENCY_URL)
  frequencies.split('\n').forEach((line, index) => {
    const word = line.split('\t')[0]
    if (word && !ranks.has(word)) ranks.set(word, index)
  })

  // A word introduced at A2 and reused at C1 is an A2 word: taking the lowest
  // level keeps "cause" out of the advanced sets.
  const entries = new Map()
  for (const row of rows) {
    const headword = String(row.headword ?? '')
      .trim()
      .toLowerCase()
    const pos = POS.get(String(row.pos ?? '').trim().toLowerCase())
    let level = String(row.CEFR ?? '')
      .trim()
      .toUpperCase()
    if (level === 'A1') level = 'A2'

    if (!pos || !BANDS[level]) continue
    if (BLOCKED.has(headword)) continue
    if (!/^[a-z][a-z-]{2,19}$/.test(headword)) continue

    const current = entries.get(headword)
    if (!current || level < current.level) entries.set(headword, { level, pos })
  }

  const byLevel = Object.fromEntries(Object.keys(BANDS).map((l) => [l, []]))
  for (const [headword, { level, pos }] of entries) {
    const [floor, ceiling] = BANDS[level]
    const rank = ranks.get(headword) ?? Number.MAX_SAFE_INTEGER
    if (rank < floor || rank >= ceiling) continue
    byLevel[level].push({ headword, pos, rank })
  }

  // Sorting by rank lets the runtime read usefulness off the index and skip
  // storing the number: earlier means more likely to be worth learning.
  for (const words of Object.values(byLevel)) {
    words.sort((a, b) => a.rank - b.rank)
  }
  return byLevel
}

/**
 * Every word the profiles know, with every part of speech they give it.
 *
 * Not the same list as the pool and not a subset of it. The pool is words
 * worth a card, so it drops both ends of the frequency curve, and what it
 * drops off the common end — "use", "read", "dance" — is exactly the set of
 * words that other words are built out of. Telling "building" from "spring"
 * means asking whether "build" and "spr" are words, and only this list can
 * answer that.
 */
export async function lexicon() {
  const words = new Map()
  for (const row of await profileRows()) {
    const headword = String(row.headword ?? '')
      .trim()
      .toLowerCase()
    const pos = POS.get(String(row.pos ?? '').trim().toLowerCase())
    if (!pos || !/^[a-z][a-z-]{1,19}$/.test(headword)) continue
    words.set(headword, (words.get(headword) ?? new Set()).add(pos))
  }
  return words
}

async function main() {
  const byLevel = await candidates()
  const verdicts = await readVerdicts()
  const words = await lexicon()

  const lines = []
  const counts = []
  for (const [level, all] of Object.entries(byLevel)) {
    const words = all.filter((word) => verdicts[word.headword] !== 'drop')
    counts.push(`${level} ${words.length}`)
    lines.push(
      `  ${level}:\n    '${words.map((w) => `${w.headword}:${w.pos}`).join(',')}',`,
    )
  }
  const summary = counts.join(', ')

  const file = `import type { CefrLevel } from '#/lib/settings'

/**
 * Words worth offering a learner, by level, most useful first.
 *
 * Generated by \`node scripts/build-vocabulary.mjs\` — edit that, not this.
 * Each entry is \`headword:pos\` with pos one of n, v, adj, adv. ${summary}.
 *
 * Derived from the CEFR-J Vocabulary Profile (A1–B2) and the Octanove
 * Vocabulary Profile C1/C2, both by the Open Language Profiles project and
 * licensed CC BY-SA 4.0, trimmed by web-corpus frequency and by the judgement
 * cached in scripts/vocabulary-verdicts.json.
 */
export const VOCABULARY: Record<CefrLevel, string> = {
${lines.join('\n')}
}
`

  await writeFile(new URL('../src/data/vocabulary.ts', import.meta.url), file)
  console.log(`wrote src/data/vocabulary.ts — ${summary}`)

  const entries = [...words]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([word, pos]) => `${word}:${[...pos].sort().join('|')}`)
  const lexiconFile = `/**
 * Every word the CEFR-J and Octanove profiles know, with its parts of speech.
 *
 * Generated by \`node scripts/build-vocabulary.mjs\` — edit that, not this.
 * Each entry is \`headword:pos\`, several separated by "|", pos one of n, v,
 * adj, adv. ${entries.length} words.
 *
 * This is a lexicon, not a syllabus: it answers whether a string is a word and
 * what part of speech it can be, which is what reading "building" as a form of
 * "build" depends on. VOCABULARY answers a different question and leaves out
 * the commonest words, which are the ones asked about here.
 */
export const LEXICON =
  '${entries.join(',')}'
`
  await writeFile(new URL('../src/data/lexicon.ts', import.meta.url), lexiconFile)
  console.log(`wrote src/data/lexicon.ts — ${entries.length} words`)
}

// Importable by the curation script without rebuilding anything.
if (import.meta.url === `file://${process.argv[1]}`) await main()
