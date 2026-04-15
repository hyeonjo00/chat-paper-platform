import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import SiteControls from '@/components/ui/site-controls'
import { SitePreferencesProvider } from '@/components/ui/site-preferences-provider'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { SITE_LOCALE_COOKIE, resolveSiteLocale } from '@/lib/ui/site-copy'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Chat Paper | 대화를 논문으로 정리하는 한국어 AI',
    template: '%s | Chat Paper',
  },
  description:
    '카카오톡과 AI 대화를 업로드하면 한국어 중심의 학술 초안과 연구형 대시보드를 생성하는 AI 플랫폼입니다.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = resolveSiteLocale(cookies().get(SITE_LOCALE_COOKIE)?.value)

  return (
    <html lang={locale} suppressHydrationWarning className="h-full scroll-smooth">
      <body className="min-h-full bg-background text-foreground antialiased selection:bg-sky-500/20 selection:text-sky-200 dark:selection:bg-sky-500/30 dark:selection:text-sky-100">
        <ThemeProvider>
          <SitePreferencesProvider initialLocale={locale}>
            <SiteControls />
            {children}
          </SitePreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
