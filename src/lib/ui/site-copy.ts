import { enCopy } from '@/lib/ui/site-copy.en'
import { jaCopy } from '@/lib/ui/site-copy.ja'
import { koCopy } from '@/lib/ui/site-copy.ko'

export const SITE_LOCALE_COOKIE = 'site-locale'
export const SITE_LOCALES = ['ko', 'ja', 'en'] as const

export type SiteLocale = (typeof SITE_LOCALES)[number]

export function resolveSiteLocale(value?: string | null): SiteLocale {
  if (value === 'ja' || value === 'en' || value === 'ko') return value
  return 'ko'
}

export const siteCopy = {
  ko: koCopy,
  ja: jaCopy,
  en: enCopy,
} as const

export type SiteCopy = (typeof siteCopy)[SiteLocale]

export function getSiteCopy(locale: SiteLocale) {
  return siteCopy[locale]
}
