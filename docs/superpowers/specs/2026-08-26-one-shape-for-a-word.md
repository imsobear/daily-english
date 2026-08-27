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
| Senses | One column, `senses`: `[{pos, definition, zh, examples}]`, carrying the Chinese shown beside each definition. Replaces `definitions`, `examples` and `detail.senses`. |
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

## The row, the flow, the pass

Nine columns, each with one job, and one accessor per column: no surface forks
on shape again. What the row holds and how it is filled is
[how a word is built](../../agents/word-data.md), kept current there rather than
described twice.

Audio is not queued alongside a card, though the first draft of this said it
would be. It is the one thing in a word that costs real money per word rather
than a share of a free allowance, and it is already covered twice over: the
word-audio endpoint speaks a word the first time anyone plays it, and the pass
speaks the pool. A word nobody ever plays should not be paid for.

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

Everything below is built except the last line.

- `src/db/schema.ts`, `drizzle/0014_word_senses.sql` — the four columns and the backfill
- `src/lib/word-card.ts` (was `word-detail.ts`) — drop `usage`; the only writer of senses
- `src/lib/dictionary.ts` — `lookupDictionary` returns IPA and stopgap senses; `buildEntry` goes
- `src/lib/ai.ts` — `defineWord` deleted
- `src/lib/entries.ts` — one accessor each, `saveDictionary`, `ensureEntry`
- `src/lib/prewarm.ts`, `src/workflows/prewarm.ts` — the shared functions, `describeEntry`, `DESCRIBE_BUDGET`
- `src/server/words.ts`, `gloss.ts`, `browse.ts` — `ensureEntry`, and nothing else
- `src/server/lessons.ts`, `src/lib/generate-lesson.ts` — read the one accessor
- `src/routes/_app/explore.tsx`, `words/$wordId.tsx` — the fallback fork is gone
- `scripts/mock-ai.mjs`, the test suites, `docs/agents/word-data.md`, `data-deploy.md`
- **Still to come:** `0015_drop_word_legacy.sql`, once this is deployed

## What changed a day later

This spec had the request paths queue a card in `waitUntil`, and left a cron
"out of scope" on the grounds that the command is one line. Both were wrong way
round: a card in `waitUntil` meant an idle scroll could spend the day's
allowance while the learner who saved a word got nothing sooner for it, since
the card lands after they have moved on either way.

So the model left the request path entirely. The pass writes every card, a cron
starts it at 00:10 UTC, and it takes saved words before pool words — without
that a word typed in by hand would have no path to a card at all, which is the
rough edge this spec set out to close. What a request does now is read the row
and, at most, fetch the dictionary.

Still open: refetching a card in the client when one lands, which matters less
now that the dictionary fills the gap, and a second example per sense — the
shape allows it, the prompt does not ask for one yet.
