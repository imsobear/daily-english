<p align="center">
  <img src="public/icon.svg" width="72" height="72" alt="Daily English">
</p>

<h1 align="center">Daily English</h1>

<p align="center">
  <strong>One article a day, built from the words you are learning.</strong><br>
  Save the words you meet. Hear them in a story. Read, then recall.
</p>

<p align="center">
  <a href="https://english.readish.app">english.readish.app</a>
  ·
  <a href="#development">Development</a>
  ·
  <a href="#self-hosting">Self-hosting</a>
  ·
  <a href="#license">MIT</a>
</p>

<table>
  <tr>
    <td align="center" valign="top" width="33%">
      <img src="public/showcase/showcase-1.png" alt="Today — pick up today's lesson" width="280">
      <br><sub>Today</sub>
    </td>
    <td align="center" valign="top" width="33%">
      <img src="public/showcase/showcase-2.png" alt="A lesson — read with highlighted words" width="280">
      <br><sub>Lesson</sub>
    </td>
    <td align="center" valign="top" width="33%">
      <img src="public/showcase/showcase-3.png" alt="You — level, topics, and words per lesson" width="280">
      <br><sub>You</sub>
    </td>
  </tr>
</table>

## What it is

Daily English is a mobile-first PWA for learners who already collect vocabulary and need somewhere to *use* it. Each lesson is one short article written from the words on your list, read aloud in General American, then checked with a quick recall round. Five minutes, once a day.

Live at [english.readish.app](https://english.readish.app). Sign in with Google.

## A lesson

1. **Listen** — hear the article in parts, without reading first.
2. **Read** — follow the text, tap a word for a gloss, tap a sentence to hear it again.
3. **Listen again** — the whole article, straight through, now that you know what it says.
4. **Recall** — a short quiz on the language that actually appeared.

Playback is 0.75× / 1× / 1.25×. Articles stay on your account; you can restart a lesson without rewriting it.

## Stack

| Piece | Choice |
| --- | --- |
| App | [TanStack Start](https://tanstack.com/start) (React 19) on [Cloudflare Workers](https://developers.cloudflare.com/workers/) |
| Data | D1 (SQLite) via Drizzle, R2 for audio |
| Writing | DeepSeek |
| Speech | OpenAI `gpt-4o-mini-tts` |
| Words | A CEFR-tagged pool in-repo, plus a Chrome extension to save from any page |

The Chrome extension lives in `packages/chrome-extension`. It adds a selected word to the same list the site uses.

## Development

**pnpm only.** Node 22.

```bash
pnpm install
cp .dev.vars.example .dev.vars   # then fill in keys you actually need
pnpm mock:ai                     # http://127.0.0.1:8799 — keep this running
pnpm dev                         # http://localhost:3000
```

`pnpm mock:ai` stands in for DeepSeek and OpenAI speech so a local run does not spend API credit. The mock writes placeholder prose on purpose. On the login screen, **Sign in as the test learner** exists only in development.

```bash
pnpm check   # typecheck, tests, production build — this is what CI runs
```

More detail: [local development](docs/agents/local-dev.md), [testing](docs/agents/testing.md).

## Self-hosting

`wrangler.jsonc` in this repository is wired to the live account (custom domain, D1 id, R2 bucket). To run your own copy:

1. Create a Cloudflare account, a D1 database, and an R2 bucket.
2. Replace `database_id`, `database_name`, `bucket_name`, and the `routes` entry in `wrangler.jsonc`.
3. Put secrets with `pnpm exec wrangler secret put NAME` for every name in `.dev.vars.example` (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`).
4. Point the Google OAuth redirect at `https://your-domain/api/auth/google/callback`.
5. Apply migrations, then deploy:

```bash
pnpm exec wrangler d1 migrations apply english-lessons --remote
pnpm deploy
```

Schema changes need a specific order when they drop columns — see [data and deploys](docs/agents/data-deploy.md).

## Vocabulary data

`src/data/vocabulary.ts` is generated from the [CEFR-J](https://www.cefr-j.org/) and Octanove vocabulary profiles ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), via Open Language Profiles) plus a web-frequency list. Rebuild with `pnpm vocab`. Do not hand-edit the output.

## License

[MIT](LICENSE).
