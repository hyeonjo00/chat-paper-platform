import { NormalizedMessage, ParsedConversationData, ParseOptions } from '@/types/conversation'
import { anonymizeMessages } from '@/lib/nlp/anonymize'
import crypto from 'crypto'

// **Human:** text  or  Human: text
const HUMAN_LINE = /^\*{0,2}(?:Human|사용자|User):\*{0,2}\s*(.+)/i
const ASSIST_LINE = /^\*{0,2}(?:Assistant|Claude|GPT|AI|어시스턴트):\*{0,2}\s*(.+)/i

export function parsePlainText(raw: string, opts: ParseOptions): ParsedConversationData {
  const blocks = raw.split(/\n---+\n|\n={3,}\n/)
  const rawMessages: NormalizedMessage[] = []
  const speakerMap = new Map<string, { turnCount: number; firstSeen: string }>()

  let ts = new Date()

  for (const block of blocks) {
    const lines = block.split('\n')
    let currentSpeaker: string | null = null
    let buffer: string[] = []

    const flush = () => {
      if (!currentSpeaker || !buffer.length) return
      const text = buffer.join('\n').trim()
      if (!text) return
      const isoTs = ts.toISOString()
      if (!speakerMap.has(currentSpeaker)) speakerMap.set(currentSpeaker, { turnCount: 0, firstSeen: isoTs })
      speakerMap.get(currentSpeaker)!.turnCount++
      rawMessages.push({ id: crypto.randomUUID(), speakerId: currentSpeaker, originalSpeaker: currentSpeaker, timestamp: isoTs, text })
      ts = new Date(ts.getTime() + 60_000)
      buffer = []
    }

    for (const line of lines) {
      const hm = line.match(HUMAN_LINE)
      const am = line.match(ASSIST_LINE)
      if (hm) {
        flush()
        currentSpeaker = '사용자'
        buffer = [hm[1]]
      } else if (am) {
        flush()
        currentSpeaker = 'AI 어시스턴트'
        buffer = [am[1]]
      } else if (currentSpeaker) {
        buffer.push(line)
      }
    }
    flush()
  }

  if (rawMessages.length === 0) return emptyResult()

  const messages = opts.anonymize ? anonymizeMessages(rawMessages).messages : rawMessages
  const timestamps = messages.map(m => m.timestamp).sort()

  return {
    messages,
    speakers: Array.from(speakerMap.entries()).map(([id, v]) => ({ id, ...v })),
    dateRange: { start: timestamps[0], end: timestamps[timestamps.length - 1] },
    totalMessages: messages.length,
    speakerCount: speakerMap.size,
  }
}

function emptyResult(): ParsedConversationData {
  return { messages: [], speakers: [], dateRange: { start: '', end: '' }, totalMessages: 0, speakerCount: 0 }
}
