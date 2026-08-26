import { drizzle } from 'drizzle-orm/d1'
import { env, waitUntil as deferToRequest } from 'cloudflare:workers'

import * as schema from './schema.ts'

export function getDb() {
  return drizzle(env.DB, { schema })
}

export function getAudioBucket() {
  return env.AUDIO
}

export function getEnv() {
  return env
}

/**
 * Outside a request — a test, or a workflow step — there is no request to hang
 * the promise off. Falling back to letting it run keeps callers from having to
 * know which context they are in.
 */
export function waitUntil(promise: Promise<unknown>) {
  try {
    deferToRequest(promise)
  } catch {
    void promise
  }
}

