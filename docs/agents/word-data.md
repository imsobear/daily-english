# How a word is built

Everything lexical about a word — how it sounds, what it means, how it is used —
belongs to the language rather than to whoever saved it, so `dictionary_entries`
holds one row per normalized headword and every learner reads the same one. A
learner's row in `words` keeps only their own progress and points at it.

## What a row is made of

| Column                    | Filled by                        | Read as                              |
| ------------------------- | -------------------------------- | ------------------------------------ |
| `ipa`                     | api.dictionaryapi.dev            | The pronunciation under a word       |
| `definitions`, `examples` | DeepSeek, dictionary as fallback | The senses, when there is no card    |
| `sense_source`            | whichever of the two won         | Nothing; it gates re-lookups         |
| `detail`                  | Workers AI, `gpt-oss-120b`       | The card: senses with their examples and Chinese, collocations, word family |
| `audio_key`               | OpenAI TTS, into R2              | The speaker button                   |

The four sources play to their strengths. The free dictionary is the only one
that gives reliable IPA, and its own senses are a last resort because they
arrive in historical order — that ordering is what once defined "despite" as a
noun meaning disdain. DeepSeek orders senses by how common they are today, which
is what `sense_source: 'model'` records. Workers AI writes the card, and
`src/lib/word-detail.ts` throws out the parts of its answer that came back
wrong: a definition written in Chinese, a gloss that translates the example
rather than the definition, a pattern in grammar shorthand.

Both surfaces prefer the card when there is one. `explore.tsx` and
`words/$wordId.tsx` fall back to `definitions` only for words the pre-warm pass
has not reached.

## Ahead of time

The pre-warm pass is where a pool word gets everything, and it is the **only**
thing that ever writes `detail`:

```bash
pnpm exec wrangler workflows trigger vocabulary-prewarm
```

Three phases per batch of twenty — define, speak, describe — each skipping words
that already have that piece, which makes a repeat run nearly free. It walks the
CEFR pool in `src/data/vocabulary.ts` and nothing else. See
[data and deploys](data-deploy.md) for cost and options.

## In the moment

Everything else happens around a request, and only ever fills in `definitions`,
`ipa` and audio — never the card.

| What the learner does     | What runs                              | When                   |
| ------------------------- | -------------------------------------- | ---------------------- |
| Saves a word              | `stubEntry`, so the list has a row     | In the request         |
| — and then                | `ensureEntry`: dictionary and DeepSeek | After the response     |
| Scrolls the Explore feed  | `ensureEntry` for up to six pool words | After the response     |
| Taps a word in an article | `ensureEntry` for that word            | In the request         |
| Plays a word              | TTS, then `audio_key`                  | In the request         |
| Taps "Look up again"      | `ensureEntry`                          | In the request         |
| Starts a lesson           | `healLegacySenses` over its words      | In the lesson workflow |

Saving is split deliberately: the stub row is written before the response so the
word appears complete and instant, and the lookup — a dictionary fetch plus a
model call, seconds rather than milliseconds — runs in `waitUntil` afterwards.
Tapping a word in an article is the one lookup a learner waits on, and it
usually costs a single read, because every word in an article was either seeded
from someone's list or looked up by whoever tapped it first.

Opening a word's page triggers nothing at all. `getWord` reads the row and
renders it; the "Look up again" button is there for the case where that row is
still empty.

## What stops it all happening twice

`sense_source` is a ladder — `pending`, then `legacy`, then `model` — and
`needsBetterSenses` is the one predicate every caller checks. Once a word reaches
`model`, `ensureEntry` returns it untouched, so the six background lookups a feed
page fires are almost always six reads.

The card is stricter still: the pre-warm pass writes `detail` only when the
column is null, and `saveEntry` deliberately leaves it out of its conflict
update, so a definition arriving late cannot throw away a card. Nothing
recomputes it.

## Rough edges

These are known and unfixed, listed so nobody rediscovers them the hard way.

**A word outside the pool never gets a card.** The describe phase only walks
`src/data/vocabulary.ts`, and no request path writes `detail`. The words a
learner typed in themselves — the ones they care most about — are exactly the
ones that stay on plain DeepSeek definitions, with no Chinese, no collocations
and no word family. `prewarmBatch` already accepts an arbitrary list of
headwords, so the missing piece is something that collects saved words the pool
does not carry and passes them in.

**Nothing triggers the pass.** There is no cron trigger, and although
`PREWARM_WORKFLOW` is bound in `wrangler.jsonc`, no code in `src/` creates an
instance. Words added by `pnpm vocab` stay blank until a human remembers to run
the command.

**A card is written once and never revisited.** Improving the prompt does
nothing for words already described, and a card whose Chinese was rejected by
the parsing has no way back — `describeWordTwice` retries within a single run,
but a poor card from an older run looks identical to a good one. There is no
"describe again" for a word, and no record of a describe having been attempted
and failed, because failure and never-tried are both `detail IS NULL`.

**A pending card in the feed never resolves on its own.** `pending` means the
entry has no definitions yet; the lookup that fixes it runs after the response,
but the client neither polls nor invalidates, so "Looking this one up…" stays on
screen until the learner loads another page. It is most visible when the
dictionary API is slow, since that six-second timeout is what leaves the row
empty in the first place.

**Two models describe the same word.** Now that the card supplies the senses a
learner reads, DeepSeek's definitions are shown only for words without one — yet
every pool word still pays for both. They are not dead weight: lesson generation
builds its glossary from `entrySenses`, and the pending state keys off that
column. Pointing the glossary at `detail.senses` would let the define phase skip
words that already have a card.

**The dictionary API is a single point of failure for IPA.** Neither model
supplies it reliably, so when `api.dictionaryapi.dev` is down or slow, words are
saved without pronunciation and nothing goes back for it later.
