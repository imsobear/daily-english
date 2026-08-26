# One shape for a word

Date: 2026-08-26

## Problem

A word's senses are stored twice, in two shapes, written by two models.
`definitions` holds `{partOfSpeech, definition}` from DeepSeek; `detail.senses`
holds `{pos, definition, example, zh}` from Workers AI; `examples` holds a
word-level list that every consumer reads `[0]` from. Every read path forks on
which of them exists, both surfaces carry a `detail ? … : …`, and a word a
learner typed can never get the better shape at all, because only the offline
pass writes `detail` and it walks the pool alone.

## Locked decisions

| Topic | Decision |
|---|---|
| Senses | One column, `senses`: `[{pos, definition, zh, examples}]`, carrying the Chinese the 中文 button reveals. Replaces `definitions`, `examples` and `detail.senses`. |
| Examples | A list per sense, none at word level. The model writes one to begin with; the shape is plural so a sense can grow a second without another migration. Everything that wants "an example" takes the first of the first sense, which is what it already does. |
| Collocations, family | Kept, as two flat columns. They are the word page's "Goes with" and "Same family". |
| `usage` | Dropped — from the column, the type, the prompt and the parser. It has been displayed nowhere since the card and the word page both dropped it. |
| Writer | One: `@cf/openai/gpt-oss-120b`. `defineWord` and the DeepSeek path for word data are deleted. DeepSeek keeps writing articles. |
| Stopgap | The free dictionary answers instantly while the card generates, and is overwritten when it lands. |
| IPA | Still the dictionary API, which the stopgap request fetches anyway. |
| `source` | `pending` → `dictionary` → `model`, replacing `sense_source`. |

## Why one model and no fast tier

Three Workers AI models, same prompt, the words *risk*, *comply* and *bleak*:

| Model | Time | Result |
|---|---|---|
| `@cf/openai/gpt-oss-120b` | 5.8s, 20.4s, 18.3s | Complete every time: part of speech, Chinese, collocations, family |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 3.7s, 6.2s, 3.7s | One of three unparseable, no part of speech on any sense, collocations and family often empty |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | ~6s | All three unparseable |

A second prompt tuned for a weaker model is the complexity this change exists to
remove, so there is one model and the ten to twenty seconds it costs are spent
in the background.

## The row

```json
{
  "normalized": "risk",
  "headword": "risk",
  "ipa": "/ɹɪsk/",
  "audio_key": "word-audio/marin/risk.mp3",
  "senses": [
    {
      "pos": "noun",
      "definition": "the chance that something bad will happen",
      "zh": "风险，可能发生的坏事",
      "examples": ["There is a high risk of flooding after the heavy rain."]
    }
  ],
  "collocations": ["risk of", "risk factor", "high risk"],
  "family": [{ "word": "risky", "pos": "adjective" }],
  "source": "model",
  "updated_at": "..."
}
```

Nine columns, each with one job. `entrySenses`, `entryExamples` and
`entryDetail` collapse into one accessor, and no surface forks on shape again.

## One flow, three doors

Saving a word, tapping an unknown word in an article and scrolling the Explore
feed are the same question — *what do we know about this word?* — so they run
the same function, `ensureEntry`, in the same three steps:

1. **Read the store.** A word anyone has met before is already there, and this
   is where it usually ends: one query, nothing else runs.
2. **Miss: fetch and insert.** The free dictionary answers in about 300ms with
   IPA and senses good enough to read, and that row is written before the caller
   is answered. The wait is bounded — two seconds rather than the six it is
   given today — because a save that hangs on a third party is worse than a save
   that shows its senses a moment later. On a timeout the row stays `pending`
   and step 3 finishes the job.
3. **Then complete it in the background.** The same call queues the rest —
   Workers AI for the real senses with their Chinese, collocations and family,
   and TTS for the audio — in `waitUntil`. Ten to twenty seconds later the row
   is upgraded in place.

Each step is skipped when the row already carries what it would write, which is
what `source` records: `model` is complete and nothing re-runs, `dictionary` is
readable and waiting to be upgraded, `pending` is a reserved row with nothing in
it yet. Audio is governed the same way by `audio_key`, keyed on the voice.

The doors differ in two ways only, both of them the caller's business rather
than the function's. Saving and a gloss tap ask about one word and wait for step
2, because there is a person looking at the answer. A feed page asks about up to
six and waits for none of them: twelve cards should not be held behind six
lookups, and the words are pool words that usually have everything already.

## The offline pass

The same steps in bulk over the pool, and after this change the pass and the
request paths call the same functions rather than reimplementing each other.
Its job is to get ahead of the feed, so that scrolling is reading rather than
waiting.

Dictionary lookups and audio can run through the whole pool in one go: both are
cheap, both are already skipped for any word that has them, and audio in
particular is never regenerated — the key contains the voice, so a word is
spoken once per voice and never again.

Workers AI is the part with a budget. A card is around 75 neurons and the free
allocation is 10,000 a day, so the describe phase takes a word limit per run and
stops when it hits it, resuming where it left off next time. At roughly 130
words a day the 4,600-word pool takes about five weeks of daily runs — free but
slow. Paying for it is a one-off of about $4 and a few hours, so the limit is a
parameter rather than a policy:

```bash
pnpm exec wrangler workflows trigger vocabulary-prewarm '{"describeLimit":130}'
pnpm exec wrangler workflows trigger vocabulary-prewarm '{"describeLimit":0}'    # dictionary and audio only
```

## Migration

Destructive changes are split, per [data and deploys](../../agents/data-deploy.md):

1. **Additive.** Add `senses`, `collocations`, `family`, `source`. Backfill in
   the same migration: `senses` from `detail.senses` where a card exists, its
   `example` becoming a one-item `examples`, else from `definitions` with the
   word's first example attached to the first sense and `zh` null;
   `collocations` and `family` from `detail`; `source` as `model` only where a
   card existed, `dictionary` where there were senses of any other origin,
   `pending` where there were none. Ship with the code that reads the new
   columns.
2. **Destructive.** A separate pull request afterwards: drop `definitions`,
   `examples`, `detail`, `sense_source`.

Nothing valuable is lost. The pool has never been described, so the only rows
carrying a card are the eleven local test words, and everything backfilled as
`dictionary` is re-described by the next pass anyway.

## Work

- `src/db/schema.ts`, `drizzle/0014_word_senses.sql`, then `0015_drop_word_legacy.sql`
- `src/lib/word-detail.ts` — drop `usage`; this becomes the only writer of senses
- `src/lib/dictionary.ts` — `buildEntry` returns IPA and stopgap senses; the DeepSeek branch goes
- `src/lib/ai.ts` — delete `defineWord`
- `src/lib/entries.ts` — one accessor, one `saveSenses`, `ensureEntry` = the three steps above
- `src/lib/prewarm.ts`, `src/workflows/prewarm.ts` — call the same functions; add `describeLimit`
- `src/server/words.ts`, `gloss.ts`, `browse.ts` — all three call `ensureEntry` and hand it `waitUntil`
- `src/server/lessons.ts`, `src/lib/generate-lesson.ts` — read the one accessor
- `src/routes/_app/explore.tsx`, `words/$wordId.tsx` — drop the fallback fork
- `scripts/mock-ai.mjs`, the four test suites, and `docs/agents/word-data.md`

## What this closes

Three of the rough edges in [how a word is built](../../agents/word-data.md): a
word outside the pool can now get a card, a card can be rewritten because the
request paths write one too, and "Looking this one up…" nearly disappears
because the dictionary answers in milliseconds.

Enrichment also becomes demand-led rather than pool-led. Whatever a learner
saves, taps or scrolls past is described within seconds of being seen, and the
offline pass is left doing what a pass is good at: getting ahead of the words
nobody has reached yet, at whatever rate the budget allows.

## Out of scope

A cron trigger for the daily run — the limit makes daily runs sensible, but
scheduling them is a separate change and the command is one line. Refetching a
card in the client when the background describe lands, which matters less now
that the dictionary fills the gap. A second example per sense: the shape allows
it, the prompt does not ask for one yet.
