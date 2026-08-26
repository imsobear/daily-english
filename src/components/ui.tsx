import { createLink, type LinkComponent } from '@tanstack/react-router'
import { cva, type VariantProps } from 'class-variance-authority'
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentProps,
  ReactNode,
} from 'react'

import { cn } from '#/lib/utils'

const button = cva(
  'btn-3d inline-flex items-center justify-center gap-2 rounded-2xl font-extrabold tracking-tight select-none disabled:cursor-not-allowed',
  {
    variants: {
      tone: {
        brand: 'bg-brand-500 text-white border-brand-700',
        grass: 'bg-grass-500 text-white border-grass-600',
        indigo: 'bg-indigo-500 text-white border-indigo-600',
        neutral: 'bg-surface text-ink border-hairline ring-1 ring-inset ring-hairline',
        ghost: 'border-transparent bg-transparent text-ink-soft',
      },
      // Floor of 2.75rem keeps every size at the 44px tap target.
      size: {
        sm: 'min-h-10 px-3 text-sm',
        md: 'min-h-11 px-4 text-[0.9375rem]',
        lg: 'min-h-12 px-5 text-base',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { tone: 'brand', size: 'md', block: false },
  },
)

type ButtonVariants = VariantProps<typeof button>

export function Button({
  tone,
  size,
  block,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariants) {
  return (
    <button
      type="button"
      className={cn(button({ tone, size, block }), className)}
      {...props}
    />
  )
}

/**
 * Anchor styled as a button. Built with `createLink` rather than by wrapping
 * `Link` directly, which is what preserves inference on `to`, `params` and
 * `search`.
 */
function StyledAnchor({
  tone,
  size,
  block,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & ButtonVariants) {
  return <a className={cn(button({ tone, size, block }), className)} {...props} />
}

const CreatedButtonLink = createLink(StyledAnchor)

export const ButtonLink: LinkComponent<typeof StyledAnchor> = (props) => (
  <CreatedButtonLink preload="intent" {...props} />
)

export function ExternalButtonLink({
  tone,
  size,
  block,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & ButtonVariants) {
  return (
    <a className={cn(button({ tone, size, block }), className)} {...props} />
  )
}

export function Card({
  className,
  children,
  ...props
}: ComponentProps<'section'>) {
  return (
    <section className={cn('card-soft p-3.5', className)} {...props}>
      {children}
    </section>
  )
}

const chip = cva(
  'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition-colors disabled:opacity-45',
  {
    variants: {
      tone: {
        default: 'bg-surface text-ink ring-1 ring-inset ring-hairline-strong',
        brand: 'bg-brand-500 text-white ring-0',
        soft: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100',
        dashed:
          'bg-transparent text-ink ring-1 ring-inset ring-hairline-strong [border-style:dashed]',
      },
    },
    defaultVariants: { tone: 'default' },
  },
)

export function Chip({
  tone,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof chip>) {
  return (
    <button
      type="button"
      className={cn(chip({ tone }), className)}
      {...props}
    />
  )
}

/** Circular progress meter used for the daily goal and lesson completion. */
export function ProgressRing({
  value,
  max,
  size = 68,
  stroke = 8,
  children,
  tone = 'brand',
}: {
  value: number
  max: number
  size?: number
  stroke?: number
  children?: ReactNode
  tone?: 'brand' | 'grass'
}) {
  const safeMax = Math.max(1, max)
  const ratio = Math.max(0, Math.min(1, value / safeMax))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const color = tone === 'grass' ? 'var(--grass-500)' : 'var(--brand-500)'

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${value} of ${safeMax}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-sunk)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        {children}
      </div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline-strong px-4 py-6 text-center">
      {icon ? (
        <div className="mx-auto mb-2.5 grid size-11 place-items-center rounded-full bg-surface-sunk text-ink-soft">
          {icon}
        </div>
      ) : null}
      <p className="font-extrabold">{title}</p>
      {body ? <p className="mt-1 text-sm text-ink-soft">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      aria-hidden
    />
  )
}
