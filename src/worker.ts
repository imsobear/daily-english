import handler from '@tanstack/react-start/server-entry'

export { LessonWorkflow } from './workflows/lesson'
export { PrewarmWorkflow } from './workflows/prewarm'

export default {
  fetch: handler.fetch.bind(handler),

  /**
   * A night's worth of word cards, and the only thing that writes one.
   *
   * The pool is thousands of words, so the pass is a habit rather than an
   * event: it writes `DESCRIBE_BUDGET` cards, saved words first, skips
   * everything already carded and reaches the rest tomorrow. The cron fires
   * just after 00:00 UTC because that is when the free Workers AI allowance
   * resets, so a night that runs over it starts from a full one.
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
