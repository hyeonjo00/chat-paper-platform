import { ParsedConversationData, ParseOptions } from '@/types/conversation'
import { parseKakaoTalk } from './kakao'
import { parseChatGPT } from './chatgpt'
import { parsePlainText } from './plain'
import { parseInstagramDM } from './instagram'
import { parseLINE } from './line'

export function detectAndParse(raw: string, filename: string, opts: ParseOptions): ParsedConversationData {
  const lower = filename.toLowerCase()

  // Explicit type override
  if (opts.type === 'KAKAO' || (lower.endsWith('.txt') && opts.type !== 'LINE')) {
    const result = parseKakaoTalk(raw, opts)
    if (result.totalMessages > 0) return result
    return parsePlainText(raw, opts)
  }

  if (opts.type === 'INSTAGRAM') return parseInstagramDM(raw, opts)
  if (opts.type === 'LINE') return parseLINE(raw, opts)

  // Auto-detect by file extension + content signature
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return parseInstagramDM(raw, opts)
  }

  if (lower.endsWith('.json')) {
    if (raw.includes('"timestamp_ms"') && raw.includes('"sender_name"')) {
      return parseInstagramDM(raw, opts)
    }
    return parseChatGPT(raw, opts)
  }

  if (lower.endsWith('.txt')) {
    // LINE exports use tab-delimited HH:mm\tspeaker\tmessage lines
    if (/^\d{1,2}:\d{2}\t.+\t/m.test(raw)) return parseLINE(raw, opts)
    // KakaoTalk date header
    if (/\d{4}년 \d{1,2}월 \d{1,2}일/.test(raw)) return parseKakaoTalk(raw, opts)
    return parsePlainText(raw, opts)
  }

  if (lower.endsWith('.md')) return parsePlainText(raw, opts)

  // Fallback auto-detect
  if (/\d{4}년 \d{1,2}월 \d{1,2}일/.test(raw)) return parseKakaoTalk(raw, opts)
  if (raw.includes('"conversations"') || raw.includes('"mapping"')) return parseChatGPT(raw, opts)
  if (raw.includes('"timestamp_ms"') && raw.includes('"sender_name"')) return parseInstagramDM(raw, opts)

  return parsePlainText(raw, opts)
}

export { parseKakaoTalk } from './kakao'
export { parseChatGPT } from './chatgpt'
export { parsePlainText } from './plain'
export { parseInstagramDM } from './instagram'
export { parseLINE } from './line'
