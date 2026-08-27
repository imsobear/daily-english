import handler from '@tanstack/react-start/server-entry'

export { LessonWorkflow } from './workflows/lesson'
export { PrewarmWorkflow } from './workflows/prewarm'

export default {
  fetch: handler.fetch.bind(handler),

  /**
   * A day's worth of word cards, every night.
   *
   * The pool is thousands of words and the free Workers AI allowance is a
   * hundred-odd cards a day, so the pass is a habit rather than an event: it
   * writes what a day affords, skips everything already carded, and reaches
   * the next words tomorrow. The cron fires just after 00:00 UTC because that
   * is when the allowance resets, which leaves the rest of the day's neurons
   * for the words a learner actually meets — those are filled in on demand and
   * matter more than any word the pass has not reached yet.
   *
   * Audio is left out. It is OpenAI rather than the allowance, a word is
   * spoken once and kept forever, and the word-audio endpoint already speaks
   * whatever is played before the pass gets to it. Speaking the pool is a
   * decision to spend a dollar, so it stays a manual trigger.
   */
  async scheduled(
    _event: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(env.PREWARM_WORKFLOW.create({ params: { speak: false } }))
  },
}
