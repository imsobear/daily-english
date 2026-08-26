/**
 * Decide which candidate words are worth studying, once, and cache the answer.
 *
 *   node scripts/curate-vocabulary.mjs        # judge whatever is not cached
 *   node scripts/curate-vocabulary.mjs --all  # start again from nothing
 *
 * The vocabulary profiles know a word's level; they do not know whether an
 * adult learner wants it. Frequency cannot tell them apart either — "creek" is
 * a commoner word than "comply" — so the sorting is semantic, and a model does
 * it well. Doing it here rather than per request means the app makes no model
 * call to recommend a word, and the verdicts can be read and corrected by hand.
 *
 * Writes scripts/vocabulary-verdicts.json; run `pnpm vocab` afterwards to fold
 * the result into src/data/vocabulary.ts.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { candidates, readVerdicts, VERDICTS } from './build-vocabulary.mjs'

/** Big enough to be worth a call, small enough that nothing is skimmed. */
const BATCH = 50

/** Requests in flight. Workers AI is happy well past this; the account is. */
const PARALLEL = 6

/**
 * Judgement about vocabulary, not fluency, so the largest model here earns its
 * keep — and it is asked once per word ever rather than once per request.
 */
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

const ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID ?? '0c8c9a41f55c7f43aafb16c63932e723'

/** A token if one is exported, otherwise the one `wrangler login` left behind. */
async function readToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN
  const config = join(
    homedir(),
    'Library/Preferences/.wrangler/config/default.toml',
  )
  const fallback = join(homedir(), '.wrangler/config/default.toml')
  for (const path of [config, fallback]) {
    try {
      const text = await readFile(path, 'utf8')
      const token = /oauth_token\s*=\s*"([^"]+)"/.exec(text)?.[1]
      if (token) return token
    } catch {
      // try the next location
    }
  }
  throw new Error('No Cloudflare token: run `wrangler login` or export CLOUDFLARE_API_TOKEN')
}

function prompt(level, words) {
  return `You curate vocabulary for adult learners of English who read news, essays and fiction.

These words are all tagged ${level}. Return the ones NOT worth studying:
- words an educated adult learner at ${level} already knows
- concrete everyday objects, foods, plants, animals, clothes, body parts
- names, or words derived from names
- archaic, dialectal, regional or narrowly technical words
- crude or childish slang

Keep a word if it earns its place in writing or conversation about ideas, work, people and the news — whatever its part of speech, and including plain Anglo-Saxon words as well as formal ones.

Words: ${words.join(', ')}

Reply with JSON: {"drop": ["word", ...]}. Use only words from the list.`
}

async function judge(token, level, words) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt(level, words) }],
        // A batch where most words are rejected is the long answer, and a
        // truncated one is unparseable rather than partly useful.
        max_tokens: 2000,
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: {
            type: 'object',
            properties: { drop: { type: 'array', items: { type: 'string' } } },
            required: ['drop'],
          },
        },
      }),
    },
  )
  if (!response.ok) throw new Error(`ai/run → ${response.status}`)

  const payload = await response.json()
  const raw = payload.result?.response
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
  const asked = new Set(words)
  // Only the model's opinion about words it was shown counts; anything else it
  // returns is a hallucinated headword, not a verdict.
  return (parsed.drop ?? [])
    .map((word) => String(word).trim().toLowerCase())
    .filter((word) => asked.has(word))
}

async function main() {
  const all = process.argv.includes('--all')
  const token = await readToken()
  const byLevel = await candidates()
  const verdicts = all ? {} : await readVerdicts()

  const batches = []
  for (const [level, words] of Object.entries(byLevel)) {
    const pending = words
      .map((word) => word.headword)
      .filter((headword) => !verdicts[headword])
    for (let i = 0; i < pending.length; i += BATCH) {
      batches.push({ level, words: pending.slice(i, i + BATCH) })
    }
  }

  if (batches.length === 0) {
    console.log('every candidate already has a verdict')
    return
  }
  console.log(`${batches.length} batches to judge with ${MODEL}`)

  let done = 0
  let dropped = 0
  let failed = 0
  const workers = Array.from({ length: PARALLEL }, async () => {
    for (let batch = batches.pop(); batch; batch = batches.pop()) {
      try {
        const drop = new Set(await judge(token, batch.level, batch.words))
        for (const word of batch.words) {
          verdicts[word] = drop.has(word) ? 'drop' : 'keep'
        }
        dropped += drop.size
      } catch (error) {
        // Leave the batch unjudged: a rerun picks up whatever has no verdict.
        failed += 1
        console.error(`  ${batch.level} batch failed: ${error.message}`)
      }
      done += 1
      if (done % 10 === 0) console.log(`  ${done} batches, ${dropped} dropped`)
    }
  })
  await Promise.all(workers)

  // Sorted so the file reads as a word list and reviews as a small diff.
  const sorted = Object.fromEntries(
    Object.entries(verdicts).sort(([a], [b]) => a.localeCompare(b)),
  )
  await writeFile(VERDICTS, `${JSON.stringify(sorted, null, 0)}\n`)

  const kept = Object.values(sorted).filter((v) => v === 'keep').length
  console.log(
    `wrote ${Object.keys(sorted).length} verdicts — ${kept} kept, ${
      Object.keys(sorted).length - kept
    } dropped${failed ? `, ${failed} batches failed (rerun to finish)` : ''}`,
  )
}

await main()
