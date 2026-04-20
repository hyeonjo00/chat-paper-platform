import { NormalizedMessage, ParsedConversationData, ParseOptions } from '@/types/conversation'
import { anonymizeMessages } from '@/lib/nlp/anonymize'
import crypto from 'crypto'

// ── JSON format (Meta data download, messages/inbox/<thread>/message_1.json) ──

interface InstagramRawMessage {
  sender_name: string
  timestamp_ms: number
  content?: string
  share?: { link?: string; text?: string }
  photos?: unknown[]
  videos?: unknown[]
  audio_files?: unknown[]
  reactions?: unknown[]
  is_unsent?: boolean
}

interface InstagramExport {
  participants?: { name: string }[]
  messages?: InstagramRawMessage[]
  title?: string
}

function fixEncoding(str: string): string {
  // Meta encodes non-ASCII as latin1 bytes — decode back to UTF-8
  try {
    return decodeURIComponent(escape(str))
  } catch {
    return str
  }
}

function parseJSON(raw: string): NormalizedMessage[] {
  let data: InstagramExport
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }

  const rawMessages = data.messages
  if (!rawMessages || rawMessages.length === 0) return []

  const normalized: NormalizedMessage[] = []

  // Instagram JSON exports are newest-first; reverse to chronological
  for (const msg of [...rawMessages].reverse()) {
    if (msg.is_unsent) continue

    const text =
      msg.content ??
      msg.share?.text ??
      msg.share?.link ??
      (msg.photos?.length ? '[사진]' : null) ??
      (msg.videos?.length ? '[동영상]' : null) ??
      (msg.audio_files?.length ? '[음성]' : null)

    if (!text) continue

    normalized.push({
      id: crypto.randomUUID(),
      speakerId: fixEncoding(msg.sender_name),
      originalSpeaker: fixEncoding(msg.sender_name),
      timestamp: new Date(msg.timestamp_ms).toISOString(),
      text: fixEncoding(text),
    })
  }

  return normalized
}

// ── HTML format (Meta data download, messages/inbox/<thread>/message_1.html) ──
//
// Each message block looks like:
//   <div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">
//     <div class="_3-96 _2pio _2lek _2lel"><span class="_3-96 _2pi8 _2lel">SenderName</span></div>
//     <div class="_3-96 _2pi8 _2lel">Message text here</div>
//     <div class="_3-96 _2pio _2lek _2lel"><span class="_3-96 _2pi8 _2lel">Jan 1, 2024, 3:45 PM</span></div>
//   </div>
//
// We parse with regex — no DOM available in the API route.

// Strips all HTML tags from a string
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}

// Instagram HTML timestamp formats:
//   "Jan 1, 2024, 3:45 PM"  (en)
//   "2024년 1월 1일 오후 3:45"  (ko — rare but possible)
const EN_TS_RE = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i
const MONTHS: Record<string, number> = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
}

function parseHtmlTimestamp(raw: string): string | null {
  const m = raw.trim().match(EN_TS_RE)
  if (!m) return null
  const [, mon, day, year, h, min, ampm] = m
  let hour = parseInt(h)
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0
  const mo = MONTHS[mon.toLowerCase().slice(0, 3)]
  if (!mo) return null
  return new Date(parseInt(year), mo - 1, parseInt(day), hour, parseInt(min)).toISOString()
}

// Message block: everything between consecutive outer divs
// We look for the repeating uiBoxWhite noborder pattern
const MSG_BLOCK_RE = /<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">([\s\S]*?)<\/div>\s*(?=<div class="pam|$)/g

// Inner: first span content = sender, last span content = timestamp, middle div = text
const INNER_SPAN_RE = /<span[^>]*>([^<]+)<\/span>/g
const INNER_DIV_TEXT_RE = /<div class="_3-96 _2pi8 _2lel">([^<]*)<\/div>/

function parseHTML(raw: string): NormalizedMessage[] {
  const normalized: NormalizedMessage[] = []

  // Fallback approach: collect all _3-96 _2pi8 _2lel divs in order
  // Pattern in the HTML dump: sender span → content div → timestamp span (per block)
  // We scan <div role="main"> and iterate message blocks
  const mainMatch = raw.match(/<div role="main">([\s\S]*)<\/div>/)
  const body = mainMatch ? mainMatch[1] : raw

  // Extract all text-bearing elements in order
  const tokenRe = /<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder">([\s\S]*?)(?=<div class="pam _3-95|$)/g
  let blockMatch: RegExpExecArray | null

  while ((blockMatch = tokenRe.exec(body)) !== null) {
    const block = blockMatch[1]

    // Collect all spans (sender + timestamp are in spans)
    const spans: string[] = []
    let sm: RegExpExecArray | null
    const spanRe = /<span[^>]*>([\s\S]*?)<\/span>/g
    while ((sm = spanRe.exec(block)) !== null) {
      spans.push(stripTags(sm[1]))
    }

    // Collect plain text divs (message body)
    const textDivRe = /<div class="_3-96 _2pi8 _2lel">([\s\S]*?)<\/div>/g
    const textDivs: string[] = []
    let dm: RegExpExecArray | null
    while ((dm = textDivRe.exec(block)) !== null) {
      textDivs.push(stripTags(dm[1]))
    }

    if (spans.length < 2 || textDivs.length === 0) continue

    const sender = spans[0].trim()
    const rawTs = spans[spans.length - 1].trim()
    const ts = parseHtmlTimestamp(rawTs)
    if (!ts || !sender) continue

    const text = textDivs.find(t => t && t !== sender && parseHtmlTimestamp(t) === null) ?? ''
    if (!text) continue

    normalized.push({
      id: crypto.randomUUID(),
      speakerId: sender,
      originalSpeaker: sender,
      timestamp: ts,
      text,
    })
  }

  return normalized
}

// ── Public API ───────────────────────────────────────────────────────────────

export function isInstagramHTML(raw: string): boolean {
  return raw.includes('uiBoxWhite') || (raw.includes('<html') && raw.includes('sender_name'))
}

export function parseInstagramDM(raw: string, opts: ParseOptions): ParsedConversationData {
  const isHtml = raw.trimStart().startsWith('<') || isInstagramHTML(raw)
  const msgs = isHtml ? parseHTML(raw) : parseJSON(raw)

  if (msgs.length === 0) return emptyResult()

  const speakerSet = new Map<string, { turnCount: number; firstSeen: string }>()
  for (const m of msgs) {
    if (!speakerSet.has(m.speakerId)) {
      speakerSet.set(m.speakerId, { turnCount: 0, firstSeen: m.timestamp })
    }
    speakerSet.get(m.speakerId)!.turnCount++
  }

  const messages = opts.anonymize ? anonymizeMessages(msgs).messages : msgs
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
