# Data and deploys

## The vocabulary pool

The words offered on the add-words screen are sampled from
`src/data/vocabulary.ts` — around 4,600 headwords tagged by CEFR level and part
of speech, most useful first. It is generated, not edited:

```bash
pnpm vocab   # node scripts/build-vocabulary.mjs
```

The script downloads the CEFR-J and Octanove vocabulary profiles (CC BY-SA 4.0,
via Open Language Profiles) and a web-frequency list, keeps single-word lemmas
in each level's frequency band, drops anything blocked or rejected, and writes
the file. Retune the bands there rather than hand-editing the output.
Server-side only: `starterWords` moved behind a server function so the pool
never reaches the browser bundle.

Which of those words is worth studying is a separate, semantic question that
frequency cannot answer — "creek" is a commoner word than "comply". A model
answers it once, offline:

```bash
pnpm vocab:curate   # judges anything without a verdict, then rerun pnpm vocab
```

That fills `scripts/vocabulary-verdicts.json` (`keep` or `drop` per word) using
Workers AI, authenticated with the token from `wrangler login` or
`CLOUDFLARE_API_TOKEN`. It took about a minute and a few thousand neurons for
6,500 words. The verdicts are committed, so the app itself makes no model call
to recommend a word, and a wrong verdict can be corrected by editing the JSON.

Which words a learner has already been shown lives in `word_offers`, and is
what stops a shuffle from repeating itself between visits. The `verdict` column
separates a word that merely scrolled past in the Explore feed from one the
learner retired with "Know it", which never comes back.

## Warming the pool

The Explore feed shows pool words as full cards — senses with their Chinese and
examples, IPA, audio — but the pool file carries only headwords. Defining one
costs a dictionary fetch, speaking it costs TTS, and writing its card costs half
a minute of a large model. Done on demand that is a feed of blanks, so it is
done in advance:

```bash
pnpm exec wrangler workflows trigger vocabulary-prewarm                  # everything
pnpm exec wrangler workflows trigger vocabulary-prewarm '{"levels":["C1"]}'
pnpm exec wrangler workflows trigger vocabulary-prewarm '{"speak":false}'
pnpm exec wrangler workflows trigger vocabulary-prewarm '{"describe":0}'
```

Twenty words per step, skipping anything already defined, spoken and described,
which makes the run resumable and a repeat run nearly free. The whole pool is
around 230 steps and several hours, and a dollar or two of OpenAI for the audio.

The cards are rationed separately: a run writes a hundred of them and stops,
which is most of the free Workers AI allowance for a day and none of a bill. So
the pass wants running once a day for a while rather than once — each run picks
up where the last stopped. `'{"describe":500}'` spends past the allowance on
purpose, at roughly a dollar per thousand cards. Everything here is shared by
every learner, so it is paid once. Run it after `pnpm vocab` adds words.

The cards come from `@cf/openai/gpt-oss-120b` over the REST API rather than
through an `ai` binding. The binding has no local implementation, so declaring
it makes the test pool open an authenticated session to Cloudflare, and CI has
no token to open it with. The account id is a var in `wrangler.jsonc`, so production needs one secret:

```bash
pnpm exec wrangler secret put WORKERS_AI_API_TOKEN   # Workers AI read
```

[How a word is built](word-data.md) covers what each phase writes, and what the
app fills in by itself for a word the pass has never seen.

Without it the pass still defines and speaks; it just writes no cards.
Locally, `WORKERS_AI_MOCK_URL` points at `pnpm mock:ai` and nothing is spent.
Neurons are billed per token written, so a card is about 75 of them — the free
allocation of 10,000 a day covers roughly 130 words if you would rather drip
the pool through than pay for it.

## Writing a migration

Migrations are hand-written SQL in `drizzle/`, paired with an entry in
`drizzle/meta/_journal.json`. Update `src/db/schema.ts` to match. Statements are
separated by `--> statement-breakpoint`.

Hand-writing rather than generating is deliberate: several migrations need a
backfill between the create and the drop, which `drizzle-kit generate` will not
produce.

## D1 limits worth designing around

- **100 bound variables per statement.** Inserting rows in a loop of one is
  slow, and inserting them all at once fails. Chunk instead — `saveWordsForUser`
  inserts seven word rows at a time, `loadEntries` reads fifty headwords at a
  time.
- Window functions and `INSERT ... SELECT` do work, which is what makes
  backfills inside a migration possible.

## Shipping a change

Merging a pull request is the deploy. `main` is protected, so there is no other
way in — not for a fork, not for the maintainer:

```bash
pnpm check          # the same thing CI runs, so find out here rather than there
git switch -c feat/thing && git push -u origin HEAD
gh pr create --fill
gh pr merge --auto --squash   # lands and deploys itself once CI is green
```

The merge commit runs the workflow again, and its last step applies pending
migrations and puts the Worker live. Checking the merged result rather than
trusting the branch run costs forty seconds and is the whole point: what
deployed is what was tested.

A commit that only touched `*.md`, `docs/` or `LICENSE` skips the upload. The
test is one-sided on purpose — anything it does not recognise deploys — because
a needless deploy costs half a minute and a missed one is a bug hunt. `public/`
is not on the list; those files are served by the Worker.

Whatever happens next arrives by email, sent from `deploys@readish.app` through
Cloudflare Email Sending — the same account that just deployed, so there is no
third party holding a key. A successful one carries the commit, the Cloudflare
version id and the rollback command; a failed run says production was left
alone. Two repository secrets drive it: `DEPLOY_EMAIL_TO` for the recipient, and
the deploy token, which needs the **Email Sending** permission on top of
Workers and D1. Mail that will not send is logged and forgiven, because a
deploy that worked did not stop working when the news about it got lost.

Contributing from a fork, the deploy step is skipped twice over: it is fenced to
this repository and needs a token a fork cannot read.

Migrations run before the upload, so the deployed code never meets a schema
that is missing its columns. Additive ones are safe to apply ahead of the code
because the running Worker ignores them. Destructive ones are not; see below.

A deploy by hand is still there for an emergency — `pnpm deploy` builds and
uploads from your machine — but it skips the checks, so the next CI run is what
decides whether what you shipped was any good. To undo one, `wrangler rollback`
puts the previous version back immediately; the git revert can follow through a
pull request like everything else.

## Deploying a destructive change

`wrangler d1 migrations apply` runs **every** pending migration, so a single
migration that both creates and drops leaves a window where the running code
and the schema disagree. Split it:

1. An additive migration — create the table, backfill it. The deployed code
   ignores it.
2. Deploy the code that reads the new shape.
3. A destructive migration — catch up anything written in between, then drop
   the old columns.

Because the apply command takes everything pending, the three steps are three
pull requests rather than a sequence of commands: merge the additive migration
with the code that tolerates both shapes, let it deploy, then send the
destructive migration on its own.

`drizzle/0007_shared_dictionary_entries.sql` and `0008_words_drop_copied_columns.sql`
are a worked example of the pattern.

## Secrets

Local values live in `.dev.vars` (git-ignored). Production values are set with
`wrangler secret put NAME` — they are not in `wrangler.jsonc`, whose `vars` are
public. Types for anything not generated by `wrangler types` go in
`src/types/env.d.ts`.

## After deploying

Check the thing you changed against production rather than assuming: query the
remote database with `--remote`, and load the affected page. A transient
`code: 7403` from the D1 API usually means retry, not a permissions problem.
