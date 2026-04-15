import { NormalizedMessage, ParsedConversationData, ParseOptions } from '@/types/conversation'
import { anonymizeMessages } from '@/lib/nlp/anonymize'
import crypto from 'crypto'

interface GPTMessage {
  id: string
  message?: {
    author?: { role: string }
    content?: { parts?: string[] }
    create_time?: number
  }
}

export function parseChatGPT(raw: string, opts: ParseOptions): ParsedConversationData {
  let data: { conversations?: { mapping?: Record<string, GPTMessage> }[] } | { mapping?: Record<string, GPTMessage> }

  try {
    data = JSON.parse(raw)
  } catch {
    return emptyResult()
  }

  // Support both array of conversations and single conversation
  const conversations = Array.isArray((data as { conversations?: unknown }).conversations)
    ? (data as { conversations: { mapping?: Record<string, GPTMessage> }[] }).conversations
    : [data as { mapping?: Record<string, GPTMessage> }]

  const rawMessages: NormalizedMessage[] = []
  const speakerMap = new Map<string, { turnCount: number; firstSeen: string }>()

  for (const conv of conversations) {
    if (!conv.mapping) continue
    const nodes = Object.values(conv.mapping)
      .filter(n => n.message?.content?.parts?.length && n.message.author?.role !== 'system')
      .sort((a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0))

    for (const node of nodes) {
      const role = node.message?.author?.role ?? 'unknown'
      const text = node.message?.content?.parts?.join('\n').trim() ?? ''
      const ts = node.message?.create_time
        ? new Date(node.message.create_time * 1000).toISOString()
        : new Date().toISOString()

      if (!text) continue

      const speakerId = role === 'user' ? '사용자' : 'AI 어시스턴트'
      if (!speakerMap.has(speakerId)) speakerMap.set(speakerId, { turnCount: 0, firstSeen: ts })
      speakerMap.get(speakerId)!.turnCount++

      rawMessages.push({ id: crypto.randomUUID(), speakerId, originalSpeaker: speakerId, timestamp: ts, text })
    }
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
