# How a word is built

Everything lexical about a word — how it sounds, what it means, how it is used —
belongs to the language rather than to whoever saved it, so `dictionary_entries`
holds one row per normalized headword and every learner reads the same one. A
learner's row in `words` keeps only their own progress and points at it.

## What a row is made of

Here is the row for "risk", abridged — the stored one carries two senses and six
collocations. The four list columns are `TEXT` holding JSON, read through
`entrySenses`, `entryCollocations` and `entryFamily` in `src/lib/entries.ts`,
which return empty rather than throwing on anything malformed:

```json
{
  "normalized": "risk",
  "headword": "risk",
  "ipa": "/ɹɪsk/",
  "senses": [
    {
      "pos": "noun",
      "definition": "the chance that something bad will happen",
      "zh": "可能发生的坏事的可能性",
      "examples": ["There is a high risk of flooding after the heavy rain."]
    }
  ],
  "collocations": ["risk of", "risk factor", "high risk"],
  "family": [{ "word": "risky", "pos": "adjective" }],
  "source": "model",
  "audio_key": "word-audio/marin/risk.mp3",
  "updated_at": "2026-08-26T20:41:02.000Z"
}
```

**`normalized`** is the primary key and the only thing anything joins on —
lowercased and whitespace-collapsed by `normalizeHeadword`, so "Risk", "risk"
and " risk " are one row. **`headword`** is the spelling to print, which is why
both exist: a learner who typed "Risk" still sees the canonical form.

**`ipa`** — `/ɹɪsk/` — is the pronunciation printed under the headword. It is
display only; the speaker button does not use it.

**`senses`** is the word. Both the feed card and the word page render it one box
per sense, `zh` is what the 中文 button reveals under each definition, and
`examples` is a list so a sense can grow a second sentence without a migration.
It is also what everything else reads a single line out of: the article glossary
and the quiz take the first sense and its first example, and an empty list is
what puts "Looking this one up…" on a feed card.

**`collocations`** is the "Goes with" row of chips on the word page and
**`family`** is "Same family" below it. Neither appears on the feed card — a
card is glanced at, and the definitions want that second to themselves.

**`source`** is a ladder of three values that nothing displays: `pending` for a
row reserved when a word was saved, `dictionary` for senses good enough to show
while something better is written, `model` for the card. Nothing moves back
down, and `needsCard` — true for anything below `model` — is the one predicate
every caller checks.

**`audio_key`** — `word-audio/marin/risk.mp3` — points at the clip in R2. The
voice is part of the path on purpose: changing `TTS_VOICE` changes the key, the
old object stops matching, and the endpoint speaks the word again rather than
serving a voice the rest of the app has moved on from.

## Where it comes from

Two sources, and they do not overlap. `api.dictionaryapi.dev` is free, instant
and the only reliable source of IPA; its senses are ordered historically, which
is what once defined "despite" as a noun meaning disdain, so they are a stopgap
and never the finished card. Workers AI (`@cf/openai/gpt-oss-120b`) writes the
card — senses in modern frequency order, each with its Chinese and an example,
plus collocations and family — and takes half a minute to do it.
`src/lib/word-card.ts` throws out the parts of its answer that came back wrong:
a definition written in Chinese, a gloss that translates the example rather than
the definition, an inflection offered as a family member.

DeepSeek used to define words too, and no longer does: the card replaced it
outright. DeepSeek now writes articles and nothing else.

## One flow

Every way a word arrives runs the same three steps, in `src/lib/entries.ts`:

1. **Read** the entry. Anything at `model` is finished, and that is the common
   case — the whole point of a shared table.
2. **Fetch and insert** if there is nothing to show. Up to three seconds on the
   dictionary, which is short because a learner is waiting on it.
3. **Complete in the background.** `fillEntry` in `waitUntil` writes the card
   after the response has gone.

| What the learner does     | What runs                             | When                   |
| ------------------------- | ------------------------------------- | ---------------------- |
| Saves a word              | `stubEntry`, so the list has a row    | In the request         |
| — and then                | `fillEntry`                           | After the response     |
| Taps a word in an article | `ensureEntry`, then `fillEntry`       | Request, then after    |
| Scrolls the Explore feed  | `fillEntry` for up to six pool words  | After the response     |
| Opens a word page         | Nothing                               | —                      |
| Taps "Look up again"      | `ensureEntry`, then `fillEntry`       | Request, then after    |
| Plays a word              | TTS, then `audio_key`                 | In the request         |
| Starts a lesson           | `healLegacySenses` over its words     | In the lesson workflow |

Saving is split deliberately: the stub row is written before the response so the
word appears instantly, and the lookup runs afterwards. Tapping a word in an
article is the one lookup a learner waits on, and it usually costs a single
read, because every word in an article was either seeded from someone's list or
looked up by whoever tapped it first.

## Ahead of time

The Explore feed deals words nobody has necessarily met, so waiting for the
model there would mean a screen of blank cards. The pre-warm pass fills the pool
in `src/data/vocabulary.ts` before anyone asks:

```bash
pnpm exec wrangler workflows trigger vocabulary-prewarm
```

Three phases per batch of twenty — define, speak, describe — each skipping words
that already have that piece, which makes a repeat run nearly free.

A cron fires the same pass nightly at 00:10 UTC — ten minutes after the Workers
AI allowance resets — from the `scheduled` handler in `src/worker.ts`. It asks
for senses and cards but not audio, which is OpenAI money rather than a free
allowance and is already synthesised on first play.

The describe phase is rationed. Workers AI gives away 10,000 Neurons a day and a
card costs roughly seventy of them, so a run writes `DESCRIBE_BUDGET` — a
hundred — cards and stops, leaving the rest of the day for the words learners
meet themselves. The next night picks up exactly where it left off, because a
carded word is skipped and the budget only moves when a card is actually
written. Pass `{"describe": 500}` to a manual trigger to spend past the free
allowance deliberately; a thousand cards is about a dollar. See
[data and deploys](data-deploy.md) for the rest of the cost picture.

## What stops it all happening twice

`source` is a ladder and `saveDictionary` will not write over `model` — its
conflict update carries `where source != 'model'` — so a lookup arriving late
cannot replace a card with a stopgap. Once a word reaches `model` it is read and
returned, which is why the six background fills a feed page queues are almost
always six reads.

## Rough edges

These are known and unfixed, listed so nobody rediscovers them the hard way.

**The pass cannot see what browsing has already spent.** The nightly hundred is
a guess at three quarters of the allowance, not a measurement of what is left
of it. A heavy day on the Explore feed and a full nightly run can together pass
10,000 Neurons, and the overage is billed rather than refused — at a tenth of a
cent per card, which is why nothing reads the meter.

**The pool is never spoken by itself.** The cron passes `speak: false`, so a
pool word has no audio until somebody plays it or a human triggers the pass by
hand. That is a dollar of TTS deferred, not saved.

**A card is written once and never revisited.** Improving the prompt does
nothing for words already described, and a card whose Chinese was rejected by
the parsing looks identical to a good one afterwards. `describeWordTwice`
retries within a single call and that is the whole of the second chance.

**A pending card in the feed never resolves on its own.** The fill that would
fix it runs after the response, but the client neither polls nor invalidates, so
"Looking this one up…" stays on screen until the learner loads another page.

**The dictionary API is a single point of failure for IPA.** The model does not
supply it reliably, so when `api.dictionaryapi.dev` is down or slow, words are
saved without pronunciation and nothing goes back for it later.

**Old columns are still on the table.** `definitions`, `examples`,
`sense_source` and `detail` are backfilled into the new shape by
`drizzle/0014_word_senses.sql` and read by nothing; they are dropped in a
follow-up migration, once the Worker reading them is no longer deployed.
