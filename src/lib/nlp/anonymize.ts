import { NormalizedMessage } from '@/types/conversation'

const PHONE_RE = /0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/g
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const URL_RE = /https?:\/\/[^\s]+/g
const ADDRESS_RE = /[가-힣]+(?:시|도|군|구|읍|면|동|리|로|길)\s*\d+[^\s,]*/g
// Korean names: 2-4 hangul chars common pattern (conservative, used in context)
const KOREAN_NAME_RE = /([가-힣]{2,4})(?=\s*님|\s*씨|\s*아|\s*야)/g

const SPEAKER_LABELS = ['화자A', '화자B', '화자C', '화자D', '화자E', '화자F']

export interface AnonymizationResult {
  messages: NormalizedMessage[]
  speakerMapping: Record<string, string>
  maskedCount: number
}

export function anonymizeText(text: string): string {
  return text
    .replace(PHONE_RE, '[전화번호]')
    .replace(EMAIL_RE, '[이메일]')
    .replace(URL_RE, '[링크]')
    .replace(ADDRESS_RE, '[주소]')
    .replace(KOREAN_NAME_RE, '[이름]')
}

export function anonymizeMessages(messages: NormalizedMessage[]): AnonymizationResult {
  // Build speaker mapping
  const uniqueSpeakers = Array.from(new Set(messages.map(m => m.speakerId)))
  const speakerMapping: Record<string, string> = {}
  uniqueSpeakers.forEach((speaker, i) => {
    speakerMapping[speaker] = SPEAKER_LABELS[i] ?? `화자${String.fromCharCode(65 + i)}`
  })

  let maskedCount = 0

  const anonymized = messages.map(msg => {
    const originalText = msg.text
    const cleanedText = anonymizeText(originalText)
    if (cleanedText !== originalText) maskedCount++

    return {
      ...msg,
      speakerId: speakerMapping[msg.speakerId] ?? msg.speakerId,
      originalSpeaker: msg.speakerId,
      text: cleanedText,
    }
  })

  return { messages: anonymized, speakerMapping, maskedCount }
}
