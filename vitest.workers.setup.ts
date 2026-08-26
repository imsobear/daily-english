import { applyD1Migrations, env } from 'cloudflare:test'

/** Supplied by vitest.workers.config.ts; not part of the deployed bindings. */
const { TEST_MIGRATIONS } = env as unknown as {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]
}

await applyD1Migrations(env.DB, TEST_MIGRATIONS)
