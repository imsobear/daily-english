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
      "examples": [
        "There is a high risk of flooding after the heavy rain.",
        "She took the risk and moved to a new city."
      ]
    }
  ],
  "dictionary_senses": [
    { "pos": "noun", "definition": "A possible adverse event", "zh": null, "examples": [] }
  ],
  "collocations": ["risk of", "risk factor", "high risk"],
  "family": [{ "word": "risky", "pos": "adjective" }],
  "source": "model",
  "card_version": 2,
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
English, where a translated sentence would be read instead of it. `examples`
holds two sentences: one shows the word, two show that the first was not a
fluke, and the first of them uses one of the collocations, so what is on display
is the pattern rather than the word on its own. Only the word page prints both —
the feed card and the sheet over an article have room for one. The quiz reads a
single line out, the first sense and its first example, and an empty list is
what puts "Looking this one up…" on a feed card.

**`dictionary_senses`** is what the free dictionary said, written once by
`saveDictionary` and never overwritten, and shown to nobody. It is what the
model is given to work from. Keeping it is the difference between a rewrite and
a fresh invention: by the time one happens, `senses` holds the model's own
words, which is no grounding at all. It holds the whole entry, while the
stopgap in `senses` holds the first three — the same list cut two ways, because
what a learner should be shown before the card arrives is short and what the
model needs is everything.

**`collocations`** is the "Goes with" row of chips on the word page and
**`family`** is "Same family" below it. Neither appears on the feed card — a
card is glanced at, and the definitions want that second to themselves.

**`source`** is a ladder of three values that nothing displays: `pending` for a
row reserved when a word was saved, `dictionary` for senses good enough to show
while something better is written, `model` for the card. Nothing moves back
down, and request paths ask `needsSenses` of it — is there anything at all to
show.

**`card_version`** is which recipe wrote the card, against `CARD_VERSION` in
`src/lib/word-card.ts`. Provenance says where a card came from and cannot say
whether it is still the card we would write today; this can, and `needsCard`
reads both. Bumping the constant is the whole of rolling a better prompt out to
words that already have a card — the nightly pass finds them and rewrites them
over the following nights, saved words first.

**`audio_key`** — `word-audio/marin/risk.mp3` — points at the clip in R2. The
voice is part of the path on purpose: changing `TTS_VOICE` changes the key, the
old object stops matching, and the endpoint speaks the word again rather than
serving a voice the rest of the app has moved on from.

## Where it comes from

Two sources, and one feeds the other. `api.dictionaryapi.dev` is free, instant
and the only reliable source of IPA; its senses are ordered historically, which
is what once defined "despite" as a noun meaning disdain, so they are a stopgap
and never the finished card. Workers AI (`@cf/openai/gpt-oss-120b`) writes the
card — senses in modern frequency order, each with its Chinese and two examples,
plus collocations and family — and takes half a minute to do it.

The model is not asked cold. It gets the dictionary's senses and, when the word
is in the pool, the part of speech the pool teaches it as, and it is told to
choose and rewrite rather than invent. Asked with only a headword it invents the
entry, and an inflected word is where that shows: the card for "dancing" came
back describing the verb "dance", the one for "cleaner" the comparative of
"clean". It is also told to keep facts out of the examples — no real people, no
science, no dates — because a learner reads an example as true and cannot tell
when it is not, and "Einstein's law of relativity" is what that costs.

The pool's part of speech is where the card starts and not usually where it
ends. It was a wall once, which is right for a word that is only a form of
another one and wrong for a word that is simply two words: the pool carries
"squash" as a noun, and the card came back a sport, a drink and a cramped space
with no mention of crushing anything. `baseForm` in `src/lib/inflections.ts`
tells the two apart by asking whether the shorter string is a word and what
part of speech it is — `-ing` and `-ed` are inflections only on a verb, `-er`
and `-est` only on an adjective, which is what separates the comparative
"cleaner" from the person "manager", and "building" from "spring". Only when it
finds one does the wall go up, and then the prompt names the word underneath so
the model can skip the half of the dictionary entry that belongs to it.

That lookup needs a dictionary of its own, because the pool is a syllabus
rather than a word list and leaves out the commonest words — which are exactly
the ones other words are built from. `src/data/lexicon.ts` is the profiles
before any of that filtering, 8,000-odd words with their parts of speech,
written by the same generator.

`src/lib/word-card.ts` then throws out the parts of the answer that came back
wrong: a definition written in Chinese, a gloss that runs to a sentence instead
of giving the word, an adverb glossed as an adjective, a second sense that is
the first one reworded, an example that illustrates a relative of the word
rather than the word, a collocation that is a fragment. Each of those is a
defect found in a real card. What was dropped is handed to a second attempt in
`describeWordTwice`, and the fuller of the two answers is the one stored.

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

1. **Saved words** — `demandedWords`, up to five hundred, oldest first: the ones
   with no card and the ones whose card is behind `CARD_VERSION`. Somebody chose
   these, and a word typed in by hand is not in the pool, so nothing else would
   ever card it.
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

**A better prompt costs the pool over again.** Bumping `CARD_VERSION` queues
every carded word for a rewrite, which is the point of it, but the rewrite is a
model call per word: about five dollars and, at the nightly budget of two
thousand, three nights. Saved words go first and every word keeps the card it
has until a better one lands, so it is a cost rather than an outage — but there
is no way to fix a prompt for the words it was already wrong about without
paying for them again.

**A pending card in the feed never resolves on its own.** The lookup that would
fix it runs after the response, but the client neither polls nor invalidates, so
"Looking this one up…" stays on screen until the learner loads another page.

**The dictionary API is a single point of failure.** It is the only thing a
request can learn a word from, the only source of IPA, and now the model's
grounding as well. It fails by dropping every request that misses its edge
cache, for hours at a time, so a "slow" word and a word it has never heard of
look alike from here. When it is down a new word shows "Looking this one up…"
until the pass reaches it; `ensureIpa` goes back for missing pronunciations,
and a rewrite of a word whose `dictionary_senses` are empty is postponed rather
than done ungrounded — spending the call would lose the grounding and stamp the
word as current.

**A night is capped at `DESCRIBE_BUDGET`, and that is on purpose.** Two thousand
cards is most of a rewrite and about two dollars; the cap exists for the day
something marks every word stale by mistake, which uncapped is the whole pool
rewritten nightly and a bill to find out by. A one-off run that should ignore
it passes `'{"describe":5000}'`.
