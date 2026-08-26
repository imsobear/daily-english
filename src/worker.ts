import handler from '@tanstack/react-start/server-entry'

export { LessonWorkflow } from './workflows/lesson'
export { PrewarmWorkflow } from './workflows/prewarm'

export default {
  fetch: handler.fetch.bind(handler),
}
