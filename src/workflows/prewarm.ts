import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'

import type { LessonEnv } from '#/lib/generate-lesson'
import {
  addTally,
  EMPTY_TALLY,
  prewarmBatch,
  prewarmPlan,
  type PrewarmTally,
} from '#/lib/prewarm'
import { CEFR_LEVELS, type CefrLevel } from '#/lib/settings'

export type PrewarmWorkflowParams = {
  /** Defaults to every level in the pool. */
  levels?: CefrLevel[]
  /** Set false to fill in definitions only and skip the TTS bill. */
  speak?: boolean
  /** Set false to skip the Workers AI pass that writes the cards. */
  describe?: boolean
}

/**
 * Define, speak and describe the vocabulary pool, one batch per step.
 *
 * Triggered by hand rather than on a schedule — the pool changes when someone
 * rebuilds it, which is a decision, not an event:
 *
 *   pnpm exec wrangler workflows trigger vocabulary-prewarm
 *
 * Steps are the unit of resumption, and each batch skips words that are
 * already done, so an interrupted run costs nothing to repeat.
 */
export class PrewarmWorkflow extends WorkflowEntrypoint<
  LessonEnv,
  PrewarmWorkflowParams
> {
  async run(event: WorkflowEvent<PrewarmWorkflowParams>, step: WorkflowStep) {
    const levels = event.payload?.levels?.length
      ? event.payload.levels.filter((level) => CEFR_LEVELS.includes(level))
      : [...CEFR_LEVELS]
    const speak = event.payload?.speak ?? true
    const describe = event.payload?.describe ?? true

    let total: PrewarmTally = EMPTY_TALLY
    let done = 0

    for (const batch of prewarmPlan(levels)) {
      const tally = await step.do(
        `warm-${batch.level}-${batch.offset}`,
        // The failures worth repeating are a provider hiccup or a database
        // that needs a moment, and every finished word is skipped on the way
        // back through, so a retry is cheap.
        { retries: { limit: 3, delay: '15 seconds', backoff: 'exponential' } },
        () => prewarmBatch(this.env, batch.words, { speak, describe }),
      )
      total = addTally(total, tally)
      done += 1

      /*
       * A word costs around ten subrequests — dictionary, model, speech, R2,
       * and the database either side — and a Worker invocation is allowed a
       * thousand. Left alone, a few batches in a row exhaust the budget and
       * every query after that fails until the invocation rotates, which is
       * exactly how the first full run died. Sleeping suspends the workflow,
       * so the next batch resumes with a fresh allowance.
       */
      if (done % 3 === 0) await step.sleep(`breathe-${done}`, '2 seconds')
    }

    console.info(JSON.stringify({ prewarm: true, ...total }))
    return total
  }
}
