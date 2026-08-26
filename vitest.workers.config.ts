import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

/*
 * Tests that touch the database run inside workerd against a real D1, because
 * the failures worth catching here are D1's own limits rather than anything
 * TypeScript can see.
 */
const migrations = await readD1Migrations('./drizzle')

const startEntryStub = new URL('./vitest.workers.stub.ts', import.meta.url)
  .pathname

export default defineConfig({
  resolve: {
    alias: {
      '#tanstack-router-entry': startEntryStub,
      '#tanstack-start-entry': startEntryStub,
      '#tanstack-start-plugin-adapters': startEntryStub,
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ['src/**/*.worker.test.ts'],
    setupFiles: ['./vitest.workers.setup.ts'],
  },
})
