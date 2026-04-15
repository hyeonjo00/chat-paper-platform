import { NormalizedMessage, ParsedConversationData, ParseOptions } from '@/types/conversation'
import { anonymizeMessages } from '@/lib/nlp/anonymize'
import crypto from 'crypto'

// iOS: [2024년 1월 15일 오후 3:25] [홍길동] 안녕
const IOS_LINE = /^\[(\d{4}년 \d{1,2}월 \d{1,2}일 (?:오전|오후) \d{1,2}:\d{2})\] \[(.+?)\] (.+)$/
// Android: 2024년 1월 15일 오후 3:25, 홍길동 : 안녕
const ANDROID_LINE = /^(\d{4}년 \d{1,2}월 \d{1,2}일 (?:오전|오후) \d{1,2}:\d{2}), (.+?) : (.+)$/
// Date divider
const DATE_DIVIDER = /^-{3,}|^={3,}/

function parseKoreanDate(raw: string): Date {
  const m = raw.match(/(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2})/)
  if (!m) return new Date()
  let [, y, mo, d, ampm, h, min] = m
  let hour = parseInt(h)
  if (ampm === '오후' && hour !== 12) hour += 12
  if (ampm === '오전' && hour === 12) hour = 0
  return new Date(parseInt(y), parseInt(mo) - 1, parseInt(d), hour, parseInt(min))
}

const SYSTEM_PATTERNS = [/님이 들어왔습니다/, /님이 나갔습니다/, /님을 내보냈습니다/, /채팅방을 나갔습니다/, /카카오톡 대화 내용을 내보냈습니다/]

export function parseKakaoTalk(raw: string, opts: ParseOptions): ParsedConversationData {
  const lines = raw.split('\n')
  const rawMessages: NormalizedMessage[] = []
  const speakerSet = new Map<string, { turnCount: number; firstSeen: string }>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || DATE_DIVIDER.test(trimmed)) continue
    if (SYSTEM_PATTERNS.some(p => p.test(trimmed))) continue

    const iosMatch = trimmed.match(IOS_LINE)
    const androidMatch = trimmed.match(ANDROID_LINE)
    const match = iosMatch || androidMatch

    if (match) {
      const [, rawDate, speaker, text] = match
      const ts = parseKoreanDate(rawDate).toISOString()

      if (!speakerSet.has(speaker)) {
        speakerSet.set(speaker, { turnCount: 0, firstSeen: ts })
      }
      speakerSet.get(speaker)!.turnCount++

      rawMessages.push({
        id: crypto.randomUUID(),
        speakerId: speaker,
        originalSpeaker: speaker,
        timestamp: ts,
        text: text.trim(),
      })
    }
  }

  if (rawMessages.length === 0) return emptyResult()

  const messages = opts.anonymize
    ? anonymizeMessages(rawMessages).messages
    : rawMessages

  const timestamps = messages.map(m => m.timestamp).sort()

  return {
    messages,
    speakers: Array.from(speakerSet.entries()).map(([id, v]) => ({ id, ...v })),
    dateRange: { start: timestamps[0], end: timestamps[timestamps.length - 1] },
    totalMessages: messages.length,
    speakerCount: speakerSet.size,
  }
}

function emptyResult(): ParsedConversationData {
  return { messages: [], speakers: [], dateRange: { start: '', end: '' }, totalMessages: 0, speakerCount: 0 }
}
