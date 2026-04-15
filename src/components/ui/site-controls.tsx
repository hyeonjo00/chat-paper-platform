'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { SITE_LOCALES, type SiteLocale } from '@/lib/ui/site-copy'
import { useSitePreferences } from '@/components/ui/site-preferences-provider'

export default function SiteControls() {
  const { setTheme, theme } = useTheme()
  const { locale, setLocale, copy } = useSitePreferences()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  const labels = copy.controls

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex justify-center sm:inset-x-auto sm:right-5 sm:justify-end">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/74 px-1.5 py-1.5 shadow-[0_18px_44px_rgba(15,23,42,0.1)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/68 dark:shadow-[0_20px_48px_rgba(2,6,23,0.34)]">
        <div className="flex items-center gap-1 rounded-full bg-slate-100/80 p-1 dark:bg-white/[0.04]">
          <IconButton
            active={theme === 'light'}
            label={labels.themeLabels.light}
            onClick={() => setTheme('light')}
          >
            <SunIcon />
          </IconButton>
          <IconButton
            active={theme === 'dark'}
            label={labels.themeLabels.dark}
            onClick={() => setTheme('dark')}
          >
            <MoonIcon />
          </IconButton>
          <TextButton active={theme === 'system'} onClick={() => setTheme('system')}>
            {labels.themeLabels.system}
          </TextButton>
        </div>

        <div className="h-4 w-px bg-slate-200 dark:bg-white/10" />

        <div className="flex items-center gap-1 rounded-full bg-slate-100/80 p-1 dark:bg-white/[0.04]">
          {SITE_LOCALES.map((item) => (
            <TextButton
              key={item}
              active={locale === item}
              onClick={() => setLocale(item as SiteLocale)}
            >
              {labels.localeShort[item]}
            </TextButton>
          ))}
        </div>
      </div>
    </div>
  )
}

function IconButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={[
        'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150',
        active
          ? 'bg-slate-950 text-white dark:bg-sky-500 dark:text-slate-950'
          : 'text-slate-500 hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function TextButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex min-h-[30px] min-w-[38px] items-center justify-center rounded-full px-2.5 text-[10px] font-semibold tracking-[0.08em] transition-colors duration-150',
        active
          ? 'bg-slate-950 text-white dark:bg-sky-500 dark:text-slate-950'
          : 'text-slate-500 hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function SunIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75v1.5m0 13.5v1.5m8.25-8.25h-1.5M5.25 12h-1.5m12.584 6.334l-1.06-1.06M7.226 7.226l-1.06-1.06m10.118 0l-1.06 1.06M7.226 16.774l-1.06 1.06M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3a7.5 7.5 0 009.79 9.79z" />
    </svg>
  )
}
