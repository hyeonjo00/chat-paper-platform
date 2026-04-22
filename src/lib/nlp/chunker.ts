import type { NormalizedMessage } from '@/types/conversation'

export interface Chunk {
  index: number
  total: number
  contextHeader: string
  speakerLegend: Record<string, string>
  messages: NormalizedMessage[]
  estimatedTokens: number
}

export interface ChunkConfig {
  chunkTokens: number
  overlapTokens: number
  reservedForPrompt: number
}

const DEFAULT_CONFIG: ChunkConfig = {
  chunkTokens: 10000,
  overlapTokens: 64,
  reservedForPrompt: 1000,
}

const MAX_CHUNKS = 3

// Rough token estimation: Korean ~1.5 tok/char, Latin ~0.25 tok/char
export function estimateTokens(text: string): number {
  const korean = (text.match(/[\uAC00-\uD7A3]/g) ?? []).length
  const others = text.length - korean
  return Math.ceil(korean * 1.5 + others * 0.25)
}

export function chunkMessages(messages: NormalizedMessage[], config?: Partial<ChunkConfig>): Chunk[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const maxPerChunk = cfg.chunkTokens - cfg.reservedForPrompt

  const speakerIds = Array.from(new Set(messages.map(m => m.speakerId)))
  const speakerLegend = Object.fromEntries(speakerIds.map((id, i) => [id, `Speaker${String.fromCharCode(65 + i)}`]))

  const dateRange = messages.length
    ? `${String(messages[0].timestamp).slice(0, 7)} ~ ${String(messages[messages.length - 1].timestamp).slice(0, 7)}`
    : ''

  const contextHeader = `화자 목록: ${speakerIds.join(', ')}. 대화 기간: ${dateRange}`

  const chunks: Chunk[] = []
  let start = 0

  while (start < messages.length) {
    let tokens = estimateTokens(contextHeader)
    let end = start

    while (end < messages.length) {
      const msgTokens = estimateTokens(messages[end].text)
      if (tokens + msgTokens > maxPerChunk && end > start) break
      tokens += msgTokens
      end++
    }

    chunks.push({
      index: chunks.length,
      total: 0, // set after
      contextHeader,
      speakerLegend,
      messages: messages.slice(start, end),
      estimatedTokens: tokens,
    })

    // Overlap: step back by overlap tokens
    let overlapStart = end
    let overlapTokens = 0
    while (overlapStart > start + 1) {
      overlapTokens += estimateTokens(messages[overlapStart - 1].text)
      if (overlapTokens >= cfg.overlapTokens) break
      overlapStart--
    }
    start = overlapStart
  }

  // Limit to MAX_CHUNKS by merging excess chunks
  while (chunks.length > MAX_CHUNKS) {
    // Merge the two smallest adjacent chunks
    let minIdx = 0
    let minTokens = chunks[0].estimatedTokens + chunks[1].estimatedTokens
    for (let i = 1; i < chunks.length - 1; i++) {
      const combined = chunks[i].estimatedTokens + chunks[i + 1].estimatedTokens
      if (combined < minTokens) { minTokens = combined; minIdx = i }
    }
    const merged = {
      ...chunks[minIdx],
      messages: [...chunks[minIdx].messages, ...chunks[minIdx + 1].messages],
      estimatedTokens: minTokens,
    }
    chunks.splice(minIdx, 2, merged)
  }

  const total = chunks.length
  chunks.forEach(c => (c.total = total))
  return chunks
}
