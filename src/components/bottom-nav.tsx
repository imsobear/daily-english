import { Link } from '@tanstack/react-router'
import { BookOpen, Home, Layers, Settings } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'

const tabs = [
  { to: '/', label: 'Today', icon: Home },
  { to: '/browse', label: 'Browse', icon: Layers },
  { to: '/words', label: 'Words', icon: BookOpen },
  { to: '/settings', label: 'You', icon: Settings },
] as const

export function BottomNav() {
  return (
    <nav
      // Named so a page transition captures the tab bar separately and leaves
      // it standing still while the screen behind it slides.
      className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[26rem] border-t border-hairline bg-surface/92 backdrop-blur-xl [view-transition-name:tab-bar]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-4">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <Link
              to={tab.to}
              className="group relative flex min-h-14 flex-col items-center justify-center"
              /*
               * The colour has to live in these two rather than alongside the
               * layout classes: an active link keeps its base className too, and
               * two text-colour utilities on one element are settled by their
               * order in the stylesheet, not by which one was added last.
               */
              activeProps={{ className: 'text-brand-600' }}
              inactiveProps={{ className: 'text-ink-faint' }}
              activeOptions={{ exact: tab.to === '/' }}
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'grid size-7 place-items-center rounded-xl transition-colors',
                      isActive && 'bg-brand-50',
                    )}
                  >
                    <tab.icon
                      className="size-[1.35rem]"
                      strokeWidth={isActive ? 2.6 : 2}
                    />
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 text-[0.6875rem] leading-none font-bold',
                      isActive && 'font-extrabold',
                    )}
                  >
                    {tab.label}
                  </span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function PageHeader({
  title,
  description,
  trailing,
}: {
  title: string
  description?: string
  trailing?: ReactNode
}) {
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-hairline bg-page/85 px-4 pb-2.5 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-black tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-0.5 text-sm text-ink-soft">{description}</p>
          ) : null}
        </div>
        {trailing ? <div className="shrink-0 pt-1">{trailing}</div> : null}
      </div>
    </header>
  )
}
