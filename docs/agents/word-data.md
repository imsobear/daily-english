# How a word is built

Everything lexical about a word — how it sounds, what it means, how it is used —
belongs to the language rather than to whoever saved it, so `dictionary_entries`
holds one row per normalized headword and every learner reads the same one. A
learner's row in `words` keeps only their own progress and points at it.

## What a row is made of

Here is the row for "risk", with `detail` held back for a moment. The three list
columns are `TEXT` holding JSON, read through `entrySenses`,
`entryExamples` and `entryDetail` in `src/lib/entries.ts`, which return empty
rather than throwing on anything malformed:

```json
{
  "normalized": "risk",
  "headword": "risk",
  "ipa": "/ɹɪsk/",
  "definitions": [
    { "partOfSpeech": "noun", "definition": "the chance that something bad will happen" },
    { "partOfSpeech": "verb", "definition": "to expose yourself or something to danger or loss" }
  ],
  "examples": ["There is a high risk of flooding after the heavy rain."],
  "sense_source": "model",
  "audio_key": "word-audio/marin/risk.mp3",
  "updated_at": "2026-08-26T20:41:02.000Z"
}
```

**`normalized`** is the primary key and the only thing anything joins on —
lowercased and whitespace-collapsed by `normalizeHeadword`, so "Risk", "risk"
and " risk " are one row. **`headword`** is the spelling to print, which is why
both exist: a learner who typed "Risk" still sees the canonical form.

**`ipa`** — `/ɹɪsk/` — is the pronunciation printed under the headword on the
word page. It is display only; the speaker button does not use it.

**`definitions`** is the fallback set of senses, shown on a card or word page
only when there is no `detail`. It has a second job that has nothing to do with
display: lesson generation builds the article's glossary from the first sense of
each word (`generate-lesson.ts`), and the tap-a-word gloss sheet in a lesson
shows the first sense too. An empty one is also what puts "Looking this one up…"
on a feed card, since `browse.ts` calls a card pending when it has no senses.

**`examples`** — `["There is a high risk of flooding after the heavy rain."]` —
is the sentence supply for everything that needs one line rather than a whole
card: the gloss sheet, the quiz questions in a lesson, and the article prompt.
Cards without a `detail` show up to two of them.

**`sense_source`** — `model` here — is a ladder of three values that nothing
displays. `pending` means the row was reserved when a word was saved and never
filled in, `legacy` means the senses came from the dictionary's historical
ordering and are worth redoing, and `model` means DeepSeek ordered them by how
common they are today, so every lookup path leaves the row alone from then on.

**`audio_key`** — `word-audio/marin/risk.mp3` — points at the clip in R2. The
voice is part of the path on purpose: changing `TTS_VOICE` changes the key, the
old object stops matching, and the endpoint speaks the word again rather than
serving a voice the rest of the app has moved on from.

**`detail`** is the card, and the only column Workers AI writes. Abridged here;
the stored row carries both senses and six collocations:

```json
{
  "usage": {
    "pattern": "risk doing something",
    "example": "He decided to risk moving to a new city."
  },
  "senses": [
    {
      "pos": "noun",
      "definition": "the chance that something bad will happen",
      "example": "There is a high risk of flooding after the heavy rain.",
      "zh": "可能发生的坏事的可能性"
    }
  ],
  "collocations": ["risk of", "risk factor", "risk assessment", "high risk"],
  "family": [
    { "word": "risky", "pos": "adjective" },
    { "word": "riskiness", "pos": "noun" }
  ]
}
```

`senses` is what both surfaces show when it exists, one box per sense, and `zh`
is what the 中文 button reveals under each definition. `collocations` is the
"Goes with" row of chips on the word page and `family` is "Same family" below
it. `usage` is generated but displayed nowhere at the moment: it was on the card
and on the word page, and both were taken off again. It is kept because the pool
has not been described yet, so keeping it costs a few tokens now and putting it
back later would cost a regeneration.

The sources play to their strengths. The free dictionary is the only one that
gives reliable IPA, and its own senses are a last resort because of that
historical ordering — it is what once defined "despite" as a noun meaning
disdain. Workers AI writes the card, and `src/lib/word-detail.ts` throws out the
parts of its answer that came back wrong: a definition written in Chinese, a
gloss that translates the example rather than the definition, a pattern in
grammar shorthand.

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
The first three are answered by
[one shape for a word](../superpowers/specs/2026-08-26-one-shape-for-a-word.md),
which is agreed but not yet built.

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
