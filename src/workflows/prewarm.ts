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
}

/**
 * Define and speak the vocabulary pool, one batch per step.
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

    let total: PrewarmTally = EMPTY_TALLY

    for (const batch of prewarmPlan(levels)) {
      const tally = await step.do(
        `warm-${batch.level}-${batch.offset}`,
        // One retry: the failures worth repeating here are a timeout or a
        // provider hiccup, and every word is skipped on the way back through.
        { retries: { limit: 1, delay: '10 seconds', backoff: 'constant' } },
        () => prewarmBatch(this.env, batch.words, { speak }),
      )
      total = addTally(total, tally)
    }

    console.info(JSON.stringify({ prewarm: true, ...total }))
    return total
  }
}
