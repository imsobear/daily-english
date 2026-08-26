import { applyD1Migrations, env } from 'cloudflare:test'

/** Supplied by vitest.workers.config.ts; not part of the deployed bindings. */
const { TEST_MIGRATIONS } = env as unknown as {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]
}

await applyD1Migrations(env.DB, TEST_MIGRATIONS)

/*
 * No test reaches the internet, and nothing it does reaches a console.
 *
 * Server functions finish a word off after they have answered — a dictionary
 * lookup, then the model — and outside a request `waitUntil` has nothing to
 * hang that on, so the work runs loose and outlives the test. Allowed out, it
 * spends seconds timing out against dictionaryapi.dev and then logs into a
 * worker vitest has already torn down, which is how this suite failed in CI
 * while passing on a machine with a fast answer.
 *
 * So both calls are answered here instead, in microseconds: a 404, which is
 * what the dictionary says about a word it does not have, and a card with a
 * sense in it, since an empty answer is an error worth logging. Tests that
 * want a particular answer stub `fetch` themselves.
 */
const CARD = {
  senses: [
    {
      pos: 'noun',
      definition: 'a test sense',
      zh: '测试',
      example: 'A sentence.',
    },
  ],
  collocations: [],
  family: [],
}

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('word-card') || url.includes('/ai/run/')) {
    return Response.json({ result: { response: JSON.stringify(CARD) } })
  }
  return new Response('Not found', { status: 404 })
}) as typeof fetch
