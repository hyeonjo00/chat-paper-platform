import type { ReactNode } from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import {
  AppShell,
  Eyebrow,
  PageContainer,
  SurfaceCard,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui/surface'
import { SITE_LOCALE_COOKIE, getSiteCopy, resolveSiteLocale } from '@/lib/ui/site-copy'

export default function Home() {
  const locale = resolveSiteLocale(cookies().get(SITE_LOCALE_COOKIE)?.value)
  const copy = getSiteCopy(locale)

  return (
    <AppShell>
      <PageContainer size="wide" className="pt-24 sm:pt-28">
        <div className="space-y-6">
          <SurfaceCard tone="glass" className="px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
                  {copy.home.heroTitle}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {copy.home.brandDescription}
                </p>
              </div>

              <nav className="flex flex-wrap items-center gap-2">
                <HeaderLink href="/">{copy.home.nav.home}</HeaderLink>
                <HeaderLink href="/upload">{copy.home.nav.upload}</HeaderLink>
                <HeaderLink href="#overview">{copy.home.nav.overview}</HeaderLink>
              </nav>
            </div>
          </SurfaceCard>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <SurfaceCard className="p-6 sm:p-8 lg:p-10">
              <Eyebrow>{copy.home.heroKicker}</Eyebrow>
              <div className="mt-8 max-w-2xl">
                <h1 className="text-[clamp(2.7rem,8vw,5.6rem)] font-semibold leading-[0.94] tracking-[-0.06em] text-slate-950 dark:text-slate-50">
                  {copy.home.heroLeadTop}
                  <br />
                  <span className="text-sky-600 dark:text-sky-300">
                    {copy.home.heroLeadBottom}
                  </span>
                </h1>
                <p className="mt-6 max-w-xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                  {copy.home.heroDescription}
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/upload" className={primaryButtonClass}>
                    {copy.home.primaryCta}
                  </Link>
                  <Link href="/upload" className={secondaryButtonClass}>
                    {copy.home.secondaryCta}
                  </Link>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard tone="soft" className="p-5 sm:p-6">
              <p className="text-[11px] font-semibold tracking-[0.24em] text-sky-600 dark:text-sky-300">
                {copy.home.plannedFlow}
              </p>
              <div className="mt-5 space-y-3">
                {copy.home.modules.map((module) => (
                  <div
                    key={module}
                    className="rounded-[18px] border border-slate-200/80 bg-white/86 px-4 py-3 text-sm font-medium text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
                  >
                    {module}
                  </div>
                ))}
              </div>
            </SurfaceCard>
          </div>

          <div id="overview" className="grid gap-4 md:grid-cols-3">
            {copy.home.features.map((feature) => (
              <SurfaceCard key={feature.title} tone="soft" className="p-5 sm:p-6">
                <div className="h-10 w-10 rounded-[16px] border border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-white/[0.04]" />
                <p className="mt-5 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
                  {feature.title}
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
                  {feature.body}
                </p>
              </SurfaceCard>
            ))}
          </div>
        </div>
      </PageContainer>
    </AppShell>
  )
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[38px] items-center rounded-full border border-transparent px-4 text-sm font-medium text-slate-500 transition-colors hover:border-slate-200 hover:bg-white/80 hover:text-slate-950 dark:text-slate-400 dark:hover:border-white/10 dark:hover:bg-white/[0.04] dark:hover:text-white"
    >
      {children}
    </Link>
  )
}
