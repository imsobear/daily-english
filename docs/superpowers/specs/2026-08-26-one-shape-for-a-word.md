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
| Senses | One column, `senses`: `[{pos, definition, zh, example}]`. Replaces `definitions`, `examples` and `detail.senses`. |
| Examples | One per sense, none at word level. Everything that wants "an example" takes the first sense's, which is what it already does. |
| Chinese | Per sense, `zh`, revealed by the 中文 button. Kept. |
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
      "example": "There is a high risk of flooding after the heavy rain."
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

## Who writes it, and when

| Moment | What happens | When |
|---|---|---|
| Saves a word | Stub row | In the request |
| " | Dictionary: IPA and stopgap senses | After the response |
| " | Workers AI: the real card | After the response, seconds later |
| Taps an unknown word in an article | Dictionary, so the sheet has an answer in ~300ms | In the request |
| " | Workers AI | After the response |
| Explore feed | Dictionary only, up to six words | After the response |
| Pre-warm pass | Dictionary, TTS, then Workers AI over the pool | Workflow |

The feed stops short of describing because its words are pool words, which the
pass covers in bulk; a page turn should not queue six twenty-second calls. Words
a learner saved or tapped are exactly the ones the pass will never reach, so
they get described where they appear.

`source` is what stops repeats: at `model` nothing re-runs, at `dictionary` the
next opportunity upgrades it, at `pending` there is nothing yet.

## Migration

Destructive changes are split, per [data and deploys](../../agents/data-deploy.md):

1. **Additive.** Add `senses`, `collocations`, `family`, `source`. Backfill in
   the same migration: `senses` from `detail.senses` where a card exists, else
   from `definitions` with the first example attached to the first sense and
   `zh` null; `collocations` and `family` from `detail`; `source` as `model`
   only where a card existed, `dictionary` where there were senses of any other
   origin, `pending` where there were none. Ship with the code that reads the
   new columns.
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
- `src/lib/entries.ts` — one accessor, one `saveSenses`, `ensureEntry` = stopgap plus a queued describe
- `src/lib/prewarm.ts`, `src/workflows/prewarm.ts` — the describe phase writes the new columns
- `src/server/words.ts`, `gloss.ts`, `browse.ts` — queue the describe in `waitUntil`
- `src/server/lessons.ts`, `src/lib/generate-lesson.ts` — read the one accessor
- `src/routes/_app/explore.tsx`, `words/$wordId.tsx` — drop the fallback fork
- `scripts/mock-ai.mjs`, the four test suites, and `docs/agents/word-data.md`

## What this closes

Three of the rough edges in [how a word is built](../../agents/word-data.md): a
word outside the pool can now get a card, a card can be rewritten because the
request paths write one too, and "Looking this one up…" nearly disappears
because the dictionary answers in milliseconds. Cost is one Workers AI call per
newly saved word, around 75 neurons — the free daily allocation covers roughly
130 of them.

## Out of scope

Triggering the pre-warm pass automatically, and refetching a card in the client
when the background describe lands. Both are worth doing; neither is this
change.
