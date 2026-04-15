import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from 'react'
import clsx from 'clsx'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950'

export const primaryButtonClass = [
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[14px] px-4 py-2 text-sm font-medium',
  'bg-slate-950 text-white shadow-[0_14px_34px_rgba(15,23,42,0.14)] transition-all duration-200',
  'hover:-translate-y-px hover:bg-slate-900 hover:shadow-[0_18px_42px_rgba(15,23,42,0.18)]',
  'disabled:cursor-not-allowed disabled:opacity-40',
  'dark:bg-sky-500 dark:text-slate-950 dark:shadow-[0_16px_40px_rgba(56,189,248,0.2)] dark:hover:bg-sky-400',
  focusRing,
].join(' ')

export const secondaryButtonClass = [
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[14px] border px-4 py-2 text-sm font-medium transition-colors duration-200',
  'border-slate-200 bg-white/80 text-slate-700 hover:border-slate-300 hover:bg-white hover:text-slate-950',
  'disabled:cursor-not-allowed disabled:opacity-40',
  'dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-white/20 dark:hover:bg-white/[0.05] dark:hover:text-white',
  focusRing,
].join(' ')

export const ghostButtonClass = [
  'inline-flex min-h-[36px] items-center justify-center gap-2 rounded-[12px] px-3 py-2 text-sm font-medium transition-colors duration-200',
  'text-slate-500 hover:bg-slate-100/90 hover:text-slate-900',
  'dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-white',
  'focus-visible:outline-none',
].join(' ')

type AppShellProps = PropsWithChildren<{ className?: string }>

export function AppShell({ children, className }: AppShellProps) {
  return (
    <div
      className={clsx(
        'relative min-h-screen overflow-hidden bg-[#f5f7fb] text-slate-950 dark:bg-[#060b16] dark:text-slate-50',
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.88),rgba(245,247,251,0.96))] dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_32%),linear-gradient(180deg,rgba(8,12,24,0.96),rgba(3,7,18,1))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/70 to-transparent dark:via-white/12" />
      <div className="relative">{children}</div>
    </div>
  )
}

type PageContainerProps = PropsWithChildren<
  HTMLAttributes<HTMLDivElement> & { size?: 'default' | 'wide' }
>

export function PageContainer({
  children,
  className,
  size = 'default',
  ...props
}: PageContainerProps) {
  return (
    <div
      className={clsx(
        'mx-auto w-full px-4 sm:px-6',
        size === 'default' && 'max-w-6xl py-8 sm:py-10',
        size === 'wide' && 'max-w-7xl py-8 sm:py-10 lg:py-12',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function StickyColumn({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={clsx('space-y-4 xl:sticky xl:top-8', className)} {...props}>
      {children}
    </div>
  )
}

type SurfaceCardProps = PropsWithChildren<
  HTMLAttributes<HTMLDivElement> & {
    tone?: 'default' | 'soft' | 'glass' | 'crimson' | 'gold'
  }
>

const toneClassMap: Record<NonNullable<SurfaceCardProps['tone']>, string> = {
  default:
    'border-slate-200/80 bg-white/88 shadow-[0_24px_60px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[0_30px_72px_rgba(2,6,23,0.34)]',
  soft:
    'border-slate-200/70 bg-slate-50/92 shadow-[0_20px_50px_rgba(15,23,42,0.05)] dark:border-white/8 dark:bg-slate-950/72 dark:shadow-[0_24px_56px_rgba(2,6,23,0.3)]',
  glass:
    'border-white/70 bg-white/74 backdrop-blur-xl shadow-[0_26px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[0_28px_72px_rgba(2,6,23,0.34)]',
  crimson:
    'border-rose-200/80 bg-rose-50/88 shadow-[0_20px_48px_rgba(244,63,94,0.08)] dark:border-rose-400/15 dark:bg-rose-500/[0.06] dark:shadow-[0_24px_54px_rgba(76,5,25,0.28)]',
  gold:
    'border-sky-200/80 bg-sky-50/88 shadow-[0_20px_48px_rgba(14,165,233,0.08)] dark:border-sky-400/15 dark:bg-sky-500/[0.06] dark:shadow-[0_24px_54px_rgba(8,47,73,0.28)]',
}

export function SurfaceCard({
  children,
  className,
  tone = 'default',
  ...props
}: SurfaceCardProps) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-[28px] border',
        toneClassMap[tone],
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function Eyebrow({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-[10px] font-semibold tracking-[0.2em] text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400',
        className
      )}
    >
      {children}
    </span>
  )
}

export function GoldEyebrow({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border border-sky-200/80 bg-sky-50/90 px-3 py-1 text-[10px] font-semibold tracking-[0.2em] text-sky-600 dark:border-sky-400/20 dark:bg-sky-500/[0.08] dark:text-sky-300',
        className
      )}
    >
      {children}
    </span>
  )
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={clsx(
        'flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between',
        className
      )}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold tracking-[-0.01em] text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function MetricTile({
  label,
  value,
  hint,
  accent = false,
  className,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
  className?: string
}) {
  return (
    <div
      className={clsx(
        'min-h-[96px] rounded-[24px] border px-4 py-4 transition-colors duration-200',
        'border-slate-200/80 bg-white/82 hover:border-slate-300/80',
        'dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/15',
        accent &&
          'border-sky-200/90 bg-sky-50/92 dark:border-sky-400/18 dark:bg-sky-500/[0.06]',
        className
      )}
    >
      <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p
        className={clsx(
          'mt-2 text-xl font-semibold tracking-[-0.03em]',
          accent
            ? 'text-slate-950 dark:text-sky-300'
            : 'text-slate-900 dark:text-slate-100'
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[10px] leading-4 text-slate-400 dark:text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  className,
}: {
  icon?: ReactNode
  title: string
  description: string
  className?: string
}) {
  return (
    <div
      className={clsx(
        'rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center dark:border-white/10 dark:bg-white/[0.025]',
        className
      )}
    >
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[14px] border border-slate-200 bg-white text-slate-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-500">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
  )
}

export function ActionButton({
  children,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={clsx(primaryButtonClass, className)} {...props}>
      {children}
    </button>
  )
}

export function SecondaryButton({
  children,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={clsx(secondaryButtonClass, className)} {...props}>
      {children}
    </button>
  )
}
