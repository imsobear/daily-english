import { Outlet, createFileRoute } from '@tanstack/react-router'

import { BottomNav } from '#/components/bottom-nav'
import { PlaylistProvider } from '#/components/playlist-player'

export const Route = createFileRoute('/_app')({
  component: AppLayout,
})

function AppLayout() {
  return (
    <PlaylistProvider>
      <div className="flex min-h-dvh flex-col">
        {/* Reserve the tab bar's height so page content is never trapped
            underneath it, since the bar is fixed rather than in flow. */}
        <div
          className="flex flex-1 flex-col"
          style={{ paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
        >
          <Outlet />
        </div>
        <BottomNav />
      </div>
    </PlaylistProvider>
  )
}
