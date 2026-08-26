# Agent instructions

Daily English is a mobile-first PWA that writes a short article from the words a
learner has saved, reads it aloud, and quizzes them on it — TanStack Start on
Cloudflare Workers (D1, R2, Workers AI), live at
[english.readish.app](https://english.readish.app).

- **pnpm only.** Never `npm`/`npx`, and never install anything globally.
- **Respond in English**, whatever language the request is written in.
  See [language](docs/agents/language.md).
- **Start `pnpm mock:ai` before `pnpm dev`.** Local runs and tests must never
  spend real Workers AI or DeepSeek credit.
  See [local development](docs/agents/local-dev.md).
- `pnpm check` runs typecheck, every test suite and the build. It is what CI
  runs, so run it before saying work is done.
- **Do not deploy the live app, and do not push to `main`, from a fork.** The
  production site at english.readish.app is operated by the maintainer.
  Contributors open a pull request. See [data and deploys](docs/agents/data-deploy.md).

| Topic                                       | Read when                                      |
| ------------------------------------------- | ---------------------------------------------- |
| [Local development](docs/agents/local-dev.md) | Running the app, mock AI, ports, dev-server D1 |
| [Testing](docs/agents/testing.md)             | Adding or running tests                        |
| [Data and deploys](docs/agents/data-deploy.md) | Schema changes, migrations, shipping to prod  |
| [UI conventions](docs/agents/ui.md)           | Building or restyling components               |
| [TanStack skills](docs/agents/tanstack.md)    | Router or Start behaviour you would guess at   |
