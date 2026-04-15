export interface AnonymizeResult {
  text: string
  redactions: { type: RedactionType; original: string; replacement: string }[]
}

export type RedactionType = 'NAME' | 'PHONE' | 'LOCATION' | 'ID'

// ── Patterns ──────────────────────────────────────────────────────────────────

const PATTERNS: { type: RedactionType; re: RegExp; label: string }[] = [
  // Phone numbers (Korean formats)
  { type: 'PHONE', re: /(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g, label: '[전화번호]' },

  // Resident/foreign registration numbers  123456-1234567
  { type: 'ID', re: /\b\d{6}[-\s]?[1-8]\d{6}\b/g, label: '[주민번호]' },

  // Korean location patterns (city/district/street/number sequences)
  {
    type: 'LOCATION',
    re: /[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)\s*[가-힣\d\s]*(?:읍|면|동|리|로|길|대로|avenue)[\s\d\-~호동층]+/g,
    label: '[주소]',
  },

  // Korean names appearing next to honorifics or common name markers
  {
    type: 'NAME',
    re: /(?<=[^가-힣])([가-힣]{2,4})(?=\s*(?:님|씨|군|양|씨의|이가|아|야|에게|한테|의|이|가|을|를|은|는)(?!\w))/g,
    label: '[이름]',
  },
]

// ── Core ──────────────────────────────────────────────────────────────────────

export function anonymize(input: string): AnonymizeResult {
  const redactions: AnonymizeResult['redactions'] = []
  let text = input

  for (const { type, re, label } of PATTERNS) {
    // Reset lastIndex for global regexes
    re.lastIndex = 0
    text = text.replace(re, (match) => {
      redactions.push({ type, original: match, replacement: label })
      return label
    })
  }

  return { text, redactions }
}

export function anonymizeMessages<T extends { text: string }>(messages: T[]): T[] {
  return messages.map(m => ({ ...m, text: anonymize(m.text).text }))
}
