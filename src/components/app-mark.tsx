import { cn } from '#/lib/utils'

/**
 * The app icon, drawn inline.
 *
 * Same artwork as public/icon.svg, repeated here rather than loaded as an
 * image so it inherits the page's own rendering and never flashes in late on
 * the one screen that has nothing else on it.
 */
export function AppMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn('size-12', className)}
      role="img"
      aria-label="Daily English"
    >
      <defs>
        <linearGradient id="app-mark-warm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8a3d" />
          <stop offset="1" stopColor="#ea5808" />
        </linearGradient>
      </defs>
      {/* iOS's squircle radius, so the mark matches the installed icon. */}
      <rect width="512" height="512" rx="115" fill="url(#app-mark-warm)" />
      <g
        transform="translate(256 264) scale(.88) translate(-256 -256)"
        fill="#fff8f2"
      >
        <path d="M96 150C150 118 205 122 246 148v226c-41-26-96-30-150 2z" />
        <path d="M416 150c-54-32-109-28-150-2v226c41-26 96-30 150 2z" />
      </g>
    </svg>
  )
}
