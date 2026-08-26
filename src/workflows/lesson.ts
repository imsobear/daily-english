import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'

import { AiError } from '#/lib/deepseek'
import {
  markLessonFailed,
  persistArticle,
  speakArticle,
  writeArticle,
  type LessonEnv,
} from '#/lib/generate-lesson'
import { splitSentences } from '#/lib/text'

export type LessonWorkflowParams = {
  lessonId: string
}

export class LessonWorkflow extends WorkflowEntrypoint<
  LessonEnv,
  LessonWorkflowParams
> {
  /**
   * Run one step, recording the reason for any hopeless failure before it
   * leaves this frame.
   *
   * Error identity does not survive the workflow boundary — by the time the
   * outer catch sees it, an AiError has been flattened into an opaque value
   * and the learner-facing message is gone. Retrying a quota or auth failure
   * also can only reproduce it, so those are converted to NonRetryableError
   * instead of burning ~84 seconds of backoff first.
   */
  private async guard<T>(lessonId: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof AiError && !error.retryable) {
        await markLessonFailed(this.env, lessonId, error)
        throw new NonRetryableError(`${error.kind}: ${error.message}`)
      }
      throw error
    }
  }

  async run(event: WorkflowEvent<LessonWorkflowParams>, step: WorkflowStep) {
    const lessonId = event.payload.lessonId

    try {
      const written = await step.do(
        'write-article',
        { retries: { limit: 2, delay: '8 seconds', backoff: 'exponential' } },
        () => this.guard(lessonId, () => writeArticle(this.env, lessonId)),
      )

      const sentences = splitSentences(written.draft.body)

      // Speech never fails the lesson: a reading-only article still teaches.
      const spoken = await step.do(
        'speak-article',
        { retries: { limit: 1, delay: '5 seconds', backoff: 'constant' } },
        () =>
          speakArticle(this.env, {
            userId: written.job.userId,
            lessonId,
            draft: written.draft,
            sentences,
          }),
      )

      await step.do('save-article', async () => {
        await persistArticle(
          this.env,
          lessonId,
          written.draft,
          sentences,
          spoken,
        )
      })
    } catch (error) {
      await step.do('mark-failed', async () => {
        await markLessonFailed(this.env, lessonId, error)
      })
      throw error
    }
  }
}
