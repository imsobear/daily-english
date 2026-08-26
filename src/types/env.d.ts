/**
 * Secrets are not part of the generated `worker-configuration.d.ts`, because
 * `wrangler types` only sees bindings declared in wrangler.jsonc. Declare them
 * here so `getEnv()` stays typed.
 *
 * Set for real with:  pnpm exec wrangler secret put DEEPSEEK_API_KEY
 *                     pnpm exec wrangler secret put OPENAI_API_KEY
 * Locally, put them in `.dev.vars`.
 */
declare namespace Cloudflare {
  interface Env {
    DEEPSEEK_API_KEY?: string
    DEEPSEEK_MODEL?: string
    DEEPSEEK_BASE_URL?: string
    OPENAI_API_KEY?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    /**
     * Signs session cookies. Required in production; local runs fall back to a
     * fixed development key. Rotating it signs everyone out.
     */
    SESSION_SECRET?: string
    /** Local only. Set it and lesson audio comes from `pnpm mock:ai`. */
    TTS_MOCK_URL?: string
  }
}

interface Env extends Cloudflare.Env {}
