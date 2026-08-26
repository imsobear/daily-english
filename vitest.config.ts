import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Anything ending .worker.test.ts needs D1 — see vitest.workers.config.ts.
    exclude: ['src/**/*.worker.test.ts'],
    environment: 'node',
  },
})
