# Testing

Two suites, split by whether the code needs a database.

| Command          | Runs                                        | Environment              |
| ---------------- | ------------------------------------------- | ------------------------ |
| `pnpm test:unit` | `src/**/*.test.ts`, excluding `.worker.test.ts` | Node                 |
| `pnpm test:db`   | `src/**/*.worker.test.ts`                   | workerd, real D1         |
| `pnpm test`      | both, plus the chrome-extension package     |                          |
| `pnpm check`     | typecheck, `pnpm test`, build — what CI runs |                         |

## Which suite a test belongs in

Pure logic — text splitting, quiz shuffling, date maths, suggestion ranking —
goes in a plain `.test.ts` and runs in Node. Anything touching Drizzle, D1 or
the Cloudflare bindings goes in a `.worker.test.ts`, which runs inside workerd
with the migrations from `./drizzle` applied to a fresh database.

The D1 suite is where constraints that TypeScript cannot see get caught: bound
variable limits, unique indexes, migration SQL that only fails on real SQLite.
That is its whole reason for existing, so prefer it over mocking the database.

## Isolation

The D1 instance is shared across a test file, so give each test its own owner:

```ts
beforeEach(async () => {
  user = crypto.randomUUID()
  await getDb().insert(users).values({ id: user, createdAt: new Date().toISOString() })
})
```

Reusing a fixed id across tests fails on `UNIQUE constraint failed: users.id`.

## Known noise

`pnpm test:db` prints "Tests closed successfully but something prevents Vite
server from exiting" after passing. It is a teardown quirk of the workers pool,
not a failure.
