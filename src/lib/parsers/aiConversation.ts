export interface AiMessage {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp?: Date
}

// ── JSON ──────────────────────────────────────────────────────────────────────

interface ChatGPTExport {
  conversations?: { mapping?: Record<string, { message?: { author?: { role?: string }; content?: { parts?: unknown[] }; create_time?: number } }> }[]
  mapping?: Record<string, { message?: { author?: { role?: string }; content?: { parts?: unknown[] }; create_time?: number } }>
}

interface SimpleJsonMessage {
  role?: string
  content?: string
  text?: string
  message?: string
  timestamp?: string | number
}

function parseJson(raw: string): AiMessage[] {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }

  // ChatGPT export format
  const asGPT = data as ChatGPTExport
  const convList = asGPT.conversations ?? (asGPT.mapping ? [asGPT] : null)
  if (convList) {
    const msgs: AiMessage[] = []
    for (const conv of convList) {
      const nodes = Object.values(conv.mapping ?? {})
        .filter(n => n.message?.content?.parts?.length && n.message.author?.role !== 'system')
        .sort((a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0))
      for (const node of nodes) {
        const role = node.message!.author!.role as 'user' | 'assistant'
        const text = (node.message!.content!.parts as unknown[])
          .map(p => (typeof p === 'string' ? p : JSON.stringify(p)))
          .join('\n')
          .trim()
        if (!text) continue
        const ts = node.message!.create_time ? new Date(node.message!.create_time * 1000) : undefined
        msgs.push({ role, text, timestamp: ts })
      }
    }
    if (msgs.length) return msgs
  }

  // Simple array: [{ role, content|text|message, timestamp? }]
  if (Array.isArray(data)) {
    return (data as SimpleJsonMessage[]).flatMap(item => {
      const text = (item.content ?? item.text ?? item.message ?? '').trim()
      const role = normaliseRole(item.role)
      if (!text) return []
      const ts = item.timestamp
        ? new Date(typeof item.timestamp === 'number' ? item.timestamp * (item.timestamp < 1e12 ? 1000 : 1) : item.timestamp)
        : undefined
      return [{ role, text, timestamp: ts }]
    })
  }

  return []
}

// ── Markdown / Plain text ─────────────────────────────────────────────────────

// Matches: **Human:**, Human:, **User:**, User:, **Assistant:**, Assistant:, **Claude:**, etc.
const ROLE_LINE = /^\*{0,2}(Human|User|사용자|Assistant|Claude|GPT|AI|어시스턴트|System|시스템)\*{0,2}\s*[：:]\s*/i

function parseText(raw: string): AiMessage[] {
  const msgs: AiMessage[] = []
  let currentRole: AiMessage['role'] = 'user'
  let buffer: string[] = []

  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text) msgs.push({ role: currentRole, text })
    buffer = []
  }

  for (const line of raw.split('\n')) {
    const match = line.match(ROLE_LINE)
    if (match) {
      flush()
      currentRole = normaliseRole(match[1])
      const rest = line.slice(match[0].length).trim()
      if (rest) buffer.push(rest)
    } else {
      buffer.push(line)
    }
  }
  flush()
  return msgs
}

// ── Public API ────────────────────────────────────────────────────────────────

export type AiConversationFormat = 'json' | 'markdown' | 'txt' | 'auto'

export function parseAiConversation(raw: string, format: AiConversationFormat = 'auto'): AiMessage[] {
  if (format === 'json') return parseJson(raw)
  if (format === 'markdown' || format === 'txt') return parseText(raw)

  // auto-detect
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const result = parseJson(raw)
    if (result.length) return result
  }
  return parseText(raw)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseRole(raw?: string): AiMessage['role'] {
  if (!raw) return 'user'
  const lower = raw.toLowerCase()
  if (['assistant', 'claude', 'gpt', 'ai', '어시스턴트'].includes(lower)) return 'assistant'
  if (['system', '시스템'].includes(lower)) return 'system'
  return 'user'
}
