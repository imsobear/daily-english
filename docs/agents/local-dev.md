# Local development

## Always start the mock AI first

```bash
pnpm mock:ai   # http://127.0.0.1:8799 — DeepSeek /v1, TTS /tts
pnpm dev       # http://localhost:4000
```

`.dev.vars` points `DEEPSEEK_BASE_URL` and `TTS_MOCK_URL` at that server, so
lesson generation and speech cost nothing locally. Word suggestions need no
mock: they are sampled from `src/data/vocabulary.ts` rather than generated.
Without the mock every generated lesson bills real OpenAI speech and
DeepSeek tokens. The mock returns placeholder prose ("To adapt, in the usual
modern sense.") — text that looks wrong in a screenshot but proves the
pipeline end to end.

Both ports are fixed: `.dev.vars` hard-codes 8799, and Vite offered a free port
instead of 4000 is a second server nobody is looking at. Kill whatever holds
them rather than moving:

```bash
lsof -ti :8799 :4000 | xargs kill -9
```

## The dev server owns the local database

`predev` applies pending migrations to the local D1 before Vite starts, so a
plain `pnpm dev` is usually enough. Both Vite and `wrangler d1` write to
`.wrangler/state`, so stop the dev server before running `pnpm db:migrate`
by hand — two processes on the same SQLite file will contend.

```bash
pnpm db:migrate    # wrangler d1 migrations apply english-lessons --local
```

## Inspecting local data

```bash
pnpm exec wrangler d1 execute english-lessons --local --command "select ..."
```

Add `--json` when you want to read the rows rather than the pretty table.
