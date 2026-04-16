'use client'

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  type SiteCopy,
  type SiteLocale,
  SITE_LOCALE_COOKIE,
  getSiteCopy,
  resolveSiteLocale,
} from '@/lib/ui/site-copy'

type SitePreferencesContextValue = {
  locale: SiteLocale
  setLocale: (locale: SiteLocale) => void
  copy: SiteCopy
}

const SitePreferencesContext = createContext<SitePreferencesContextValue | null>(null)

function persistLocale(locale: SiteLocale) {
  document.documentElement.lang = locale
  window.localStorage.setItem(SITE_LOCALE_COOKIE, locale)
  document.cookie = `${SITE_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
}

export function SitePreferencesProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  initialLocale: SiteLocale
}) {
  const router = useRouter()
  const [locale, setLocaleState] = useState<SiteLocale>(initialLocale)

  const setLocale = useCallback(
    (nextLocale: SiteLocale) => {
      setLocaleState((prev) => {
        if (nextLocale === prev) return prev
        persistLocale(nextLocale)
        startTransition(() => router.refresh())
        return nextLocale
      })
    },
    [router]
  )

  useEffect(() => {
    const stored = resolveSiteLocale(window.localStorage.getItem(SITE_LOCALE_COOKIE))

    if (stored !== locale) {
      setLocaleState(stored)
      persistLocale(stored)
      return
    }

    persistLocale(locale)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale])

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      copy: getSiteCopy(locale),
    }),
    [locale, setLocale]
  )

  return <SitePreferencesContext.Provider value={value}>{children}</SitePreferencesContext.Provider>
}

export function useSitePreferences() {
  const context = useContext(SitePreferencesContext)

  if (!context) {
    throw new Error('useSitePreferences must be used within SitePreferencesProvider')
  }

  return context
}
