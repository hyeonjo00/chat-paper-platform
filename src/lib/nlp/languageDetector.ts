export type Lang = 'ko' | 'en' | 'ja'

export interface LanguageScore {
  ko: number
  en: number
  ja: number
}

export interface DetectionResult {
  scores: LanguageScore
  dominant: Lang | null   // null when no language exceeds threshold
  isMixed: boolean
}

const THRESHOLD = 0.70

// Character scoring weights per script
function score(text: string): LanguageScore {
  let ko = 0, en = 0, hiraganaKatakana = 0, cjk = 0, total = 0

  for (const cp of text) {
    const c = cp.codePointAt(0)!
    if ((c >= 0xAC00 && c <= 0xD7A3) || (c >= 0x1100 && c <= 0x11FF) || (c >= 0x3130 && c <= 0x318F)) {
      ko++; total++
    } else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) {
      en++; total++
    } else if ((c >= 0x3040 && c <= 0x30FF)) {
      // Hiragana + Katakana — unambiguously Japanese
      hiraganaKatakana++; total++
    } else if (c >= 0x4E00 && c <= 0x9FFF) {
      // CJK unified ideographs shared by JA/ZH/KO context
      cjk++; total++
    }
  }

  if (total === 0) return { ko: 0, en: 0, ja: 0 }

  // CJK ideographs are assigned to JA when hiragana/katakana is present,
  // otherwise split conservatively toward KO (Korean texts often include hanja)
  const jaFromCjk = hiraganaKatakana > 0 ? cjk : 0
  const koFromCjk = hiraganaKatakana === 0 ? cjk * 0.4 : 0

  const rawKo = ko + koFromCjk
  const rawEn = en
  const rawJa = hiraganaKatakana + jaFromCjk

  const sum = rawKo + rawEn + rawJa || 1

  return {
    ko: rawKo / sum,
    en: rawEn / sum,
    ja: rawJa / sum,
  }
}

export function detectLanguage(text: string, threshold = THRESHOLD): DetectionResult {
  const scores = score(text)
  const dominant =
    scores.ko >= threshold ? 'ko' :
    scores.en >= threshold ? 'en' :
    scores.ja >= threshold ? 'ja' :
    null

  const isMixed = dominant === null && (scores.ko + scores.en + scores.ja) > 0

  return { scores, dominant, isMixed }
}

export function detectFromMessages(messages: { text: string }[], threshold = THRESHOLD): DetectionResult {
  return detectLanguage(messages.map(m => m.text).join(' '), threshold)
}
