import { NormalizedMessage, ParsedConversationData, ParseOptions } from '@/types/conversation'
import { anonymizeMessages } from '@/lib/nlp/anonymize'
import crypto from 'crypto'

// LINE exported TXT format (Android & iOS share this format):
//
// [LINE] <name>との트ークのトーク履歴 / 과의 대화
// 保存日時: YYYY/MM/DD HH:mm  /  저장한 날짜: YYYY/MM/DD HH:mm
//
// YYYY/MM/DD(요일)
// HH:mm  발화자  메시지
// HH:mm  발화자  [사진]
//
// Messages can span multiple lines (continuation lines have no leading timestamp).

const DATE_HEADER_RE = /^(\d{4})\/(\d{2})\/(\d{2})\([월화수목금토일月火水木金土日MTWRFSU]\)$/
const MESSAGE_RE = /^(\d{1,2}):(\d{2})\t(.+?)\t(.*)$/

export function parseLINE(raw: string, opts: ParseOptions): ParsedConversationData {
  const lines = raw.split(/\r?\n/)
  const speakerSet = new Map<string, { turnCount: number; firstSeen: string }>()
  const normalized: NormalizedMessage[] = []

  let curYear = 0, curMonth = 0, curDay = 0

  for (const line of lines) {
    const dateMatch = line.trim().match(DATE_HEADER_RE)
    if (dateMatch) {
      curYear = Number(dateMatch[1])
      curMonth = Number(dateMatch[2])
      curDay = Number(dateMatch[3])
      continue
    }

    // Tab-delimited message line
    const msgMatch = line.match(MESSAGE_RE)
    if (msgMatch && curYear) {
      const [, h, m, speaker, text] = msgMatch
      const ts = new Date(curYear, curMonth - 1, curDay, Number(h), Number(m)).toISOString()

      if (!speakerSet.has(speaker)) {
        speakerSet.set(speaker, { turnCount: 0, firstSeen: ts })
      }
      speakerSet.get(speaker)!.turnCount++

      normalized.push({
        id: crypto.randomUUID(),
        speakerId: speaker,
        originalSpeaker: speaker,
        timestamp: ts,
        text: text.trim(),
      })
      continue
    }

    // Continuation line — append to last message
    const trimmed = line.trim()
    if (trimmed && normalized.length > 0 && !DATE_HEADER_RE.test(trimmed)) {
      const last = normalized[normalized.length - 1]
      last.text = `${last.text}\n${trimmed}`.trim()
    }
  }

  if (normalized.length === 0) return emptyResult()

  const messages = opts.anonymize ? anonymizeMessages(normalized).messages : normalized
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
