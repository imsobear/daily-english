import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'

import type { LessonEnv } from '#/lib/generate-lesson'
import {
  addTally,
  demandedPlan,
  DESCRIBE_BUDGET,
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
  /** Cards to write this run. Defaults to a day of the free allowance. */
  describe?: number
}

/**
 * Define, speak and describe words, one batch per step.
 *
 * A cron runs this nightly, and it is the only thing in the app that asks the
 * model for a card, so it goes at the words learners have saved before the
 * pool: those are words somebody chose, and some of them are not in the pool
 * at all. Running it by hand does the same thing:
 *
 *   pnpm exec wrangler workflows trigger vocabulary-prewarm
 *
 * Steps are the unit of resumption, and each batch skips words that are
 * already done, so an interrupted run costs nothing to repeat — and so does
 * running it again tomorrow to spend another day of the card budget.
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
    let describeLeft = event.payload?.describe ?? DESCRIBE_BUDGET

    let total: PrewarmTally = EMPTY_TALLY
    let done = 0

    // Saved words are read once, up front, so the rest of the run is the same
    // list of steps whatever anyone saves while it is going.
    const demanded = await step.do('saved-words', () => demandedPlan(this.env))

    for (const batch of [...demanded, ...prewarmPlan(levels)]) {
      const tally = await step.do(
        `warm-${batch.level}-${batch.offset}`,
        // The failures worth repeating are a provider hiccup or a database
        // that needs a moment, and every finished word is skipped on the way
        // back through, so a retry is cheap.
        { retries: { limit: 3, delay: '15 seconds', backoff: 'exponential' } },
        () =>
          prewarmBatch(this.env, batch.words, {
            speak,
            describeLimit: describeLeft,
          }),
      )
      total = addTally(total, tally)
      // Words already carded cost nothing, so the budget only moves when a
      // card is actually written — a second run over a warm pool spends none
      // of it and still reaches the words the first run stopped short of.
      describeLeft -= tally.described
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
