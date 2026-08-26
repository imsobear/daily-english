/*
 * The Start request handler resolves its router and plugin entries through
 * subpath imports that only exist while the Start Vite plugin is running.
 * Server-function modules pull that handler in even when a test only wants the
 * database code underneath, so those specifiers point here instead.
 */
export default {}
