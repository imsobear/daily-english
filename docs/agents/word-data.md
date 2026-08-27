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
      "zh": "风险；危险",
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

**`senses`** is the word. The feed card, the word page and the sheet that opens
on a tapped word all render it the same way — one box per sense, up to three,
`zh` in bold ahead of the definition it belongs to, the first example in italics
underneath — so a word looks the same wherever it is met. `zh` is the word itself
in Chinese — 风险；危险, what a paper dictionary prints opposite the entry — and not
the English definition translated. That is why it is in plain sight rather than
behind a button: two characters cost a card no room and stop nobody reading the
English, where a translated sentence would be read instead of it. `examples` is
a list so a sense can grow a second sentence without a migration. The quiz reads
a single line out of it, the first sense and its first example, and an empty list
is what puts "Looking this one up…" on a feed card.

**`collocations`** is the "Goes with" row of chips on the word page and
**`family`** is "Same family" below it. Neither appears on the feed card — a
card is glanced at, and the definitions want that second to themselves.

**`source`** is a ladder of three values that nothing displays: `pending` for a
row reserved when a word was saved, `dictionary` for senses good enough to show
while something better is written, `model` for the card. Nothing moves back
down, and two predicates read it: request paths ask `needsSenses` — is there
anything at all to show — and the nightly pass asks `needsCard` — is this still
below `model`.

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
a definition written in Chinese, a gloss that runs to a sentence instead of
giving the word, an inflection offered as a family member.

DeepSeek used to define words too, and no longer does: the card replaced it
outright. DeepSeek now writes articles and nothing else.

## One flow

Every way a word arrives — saved from the list, tapped in an article, dealt by
the Explore feed, looked up again from its own page — runs `ensureEntry` in
`src/lib/entries.ts`, which reads the shared row and, only if there is nothing
to show, spends up to three seconds on the dictionary.

There is no second step. Nothing a request touches calls the model: a card is
half a minute of it and a share of a daily allowance, so the nightly pass writes
every one of them, and until it reaches a word the dictionary senses are what
the app shows. Lessons are the same — `fillMissingSenses` looks up a word with
no senses and takes whatever ordering it gets.

What differs between the doors is only whether the learner waits. Saving writes
a stub row in the request so the word appears instantly and looks it up after
the response; a feed page looks up its first six new words afterwards too.
Tapping a word in an article is the one lookup anybody waits on, and it usually
costs a single read, because every word in an article was either seeded from
someone's list or looked up by whoever tapped it first.

## Ahead of time

The pass in `src/lib/prewarm.ts` writes every card there is, nightly on a cron
and by hand when a word should not wait. It walks two lists in this order:

1. **Saved words** — `demandedWords`, up to five hundred, oldest first. Somebody
   chose these, and a word typed in by hand is not in the pool, so nothing else
   would ever card it.
2. **The pool** — `src/data/vocabulary.ts`, level by level, so the Explore feed
   deals words that already read properly.

Three phases per batch of twenty — define, speak, describe — each skipping words
that already have that piece, which makes a repeat run nearly free. The nightly
run skips speaking, and describes only until its budget runs out; the schedule,
the budget and what they cost are in
[data and deploys](data-deploy.md#warming-words).

Nothing is written twice. `source` is a ladder and `saveDictionary` will not
write over `model` — its conflict update carries `where source != 'model'` — so
a lookup arriving late cannot replace a card with a stopgap.

## Rough edges

These are known and unfixed, listed so nobody rediscovers them the hard way.

**A new word waits a night for its card.** Until the pass reaches it, a word has
dictionary senses: historical ordering, no Chinese, no collocations. That is
what a learner sees, and what the article writer is given — the ordering that
once produced "the manage of the shop". "Look up again" does not shorten the
wait; it refetches the dictionary. Triggering the pass by hand does. This is the
trade for never making anyone wait half a minute and never spending the
allowance by accident.

**The pool is never spoken by itself.** The cron passes `speak: false`, so a
pool word has no audio until somebody plays it or a human triggers the pass by
hand. That is a dollar of TTS deferred, not saved.

**A card is written once and never revisited.** `describeWordTwice` retries
within a single call and that is the whole of the automatic second chance:
improving the prompt does nothing for words already described, and a card whose
Chinese was rejected by the parsing looks identical to a good one afterwards.
Putting words back in the queue is a hand-written `UPDATE` — `source` is what
the pass reads, so

```sql
UPDATE dictionary_entries SET source = 'dictionary' WHERE source = 'model';
```

makes every carded word eligible again while leaving the card it has on screen
until a better one lands. The next runs then re-describe them at the nightly
budget, saved words first, and pay for each one over again.

**A pending card in the feed never resolves on its own.** The lookup that would
fix it runs after the response, but the client neither polls nor invalidates, so
"Looking this one up…" stays on screen until the learner loads another page.

**The dictionary API is a single point of failure.** It is now the only thing
a request can learn a word from, and the only source of IPA. When
`api.dictionaryapi.dev` is down or slow a new word shows "Looking this one
up…" until the pass reaches it; `ensureIpa` in the pass goes back for missing
pronunciations, and nothing goes back for missing senses beyond the next run.

**Old columns are still on the table.** `definitions`, `examples`,
`sense_source` and `detail` are backfilled into the new shape by
`drizzle/0014_word_senses.sql` and read by nothing; they are dropped in a
follow-up migration, once the Worker reading them is no longer deployed.
