/**
 * Shown while a route's loader is still running.
 *
 * Without it a tap on a slow link leaves the previous screen frozen with no
 * acknowledgement, which is the clearest tell that something is a web page.
 * The shapes are deliberately generic — every screen in the app is a title
 * followed by cards.
 */
export function RoutePending() {
  return (
    <div className="flex-1 space-y-3 p-3.5" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div className="skeleton h-6 w-2/5" />
      <div className="card-soft space-y-2.5 p-3.5">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-4 w-1/2" />
      </div>
      <div className="card-soft space-y-2.5 p-3.5">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-4 w-5/6" />
      </div>
    </div>
  )
}
