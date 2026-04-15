import { NormalizedMessage, LanguageBreakdown } from '@/types/conversation'

// Unicode ranges
const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g
const LATIN_RE = /[A-Za-z]/g
const HIRAGANA_KATAKANA_RE = /[\u3040-\u30FF]/g
// CJK unified (shared between Chinese/Japanese/Korean context)
const CJK_RE = /[\u4E00-\u9FFF]/g

export function detectTextLanguage(text: string): LanguageBreakdown {
  const hangul = (text.match(HANGUL_RE) ?? []).length
  const latin = (text.match(LATIN_RE) ?? []).length
  const hiraganaKatakana = (text.match(HIRAGANA_KATAKANA_RE) ?? []).length
  const cjk = (text.match(CJK_RE) ?? []).length

  // Heuristic: CJK shared ideographs — assign to JA if hiragana/katakana present, else KO
  const jaScore = hiraganaKatakana + (hiraganaKatakana > 0 ? cjk * 0.7 : 0)
  const koScore = hangul + (hiraganaKatakana === 0 ? cjk * 0.3 : 0)
  const enScore = latin

  const total = koScore + enScore + jaScore
  if (total === 0) return { ko: 0, en: 0, ja: 0 }

  return {
    ko: koScore / total,
    en: enScore / total,
    ja: jaScore / total,
  }
}

export function detectLanguage(messages: NormalizedMessage[]): LanguageBreakdown {
  const combined = messages.map(m => m.text).join(' ')
  return detectTextLanguage(combined)
}

export function detectDominantLanguage(
  breakdown: LanguageBreakdown,
  threshold = 0.7
): 'KO' | 'EN' | 'JA' | null {
  if (breakdown.ko >= threshold) return 'KO'
  if (breakdown.en >= threshold) return 'EN'
  if (breakdown.ja >= threshold) return 'JA'
  return null
}
