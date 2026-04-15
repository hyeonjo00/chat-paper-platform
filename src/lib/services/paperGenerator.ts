import { summariseChunk, generatePaperSection, PaperLang, WritingStyle, ChunkSummary } from '@/lib/openai/promptPipeline'
import { chunkMessages } from '@/lib/nlp/chunker'
import { NormalizedMessage } from '@/types/conversation'

export interface PaperInput {
  messages: NormalizedMessage[]
  lang: PaperLang
  style: WritingStyle
}

export interface GeneratedPaper {
  title: string
  abstract: string
  introduction: string
  methods: string
  results: string
  discussion: string
  conclusion: string
}

export async function generatePaper(input: PaperInput): Promise<GeneratedPaper> {
  const { messages, lang, style } = input

  // 1. Chunk and summarise sequentially to avoid TPM rate limits
  const chunks = chunkMessages(messages)
  const summaries: ChunkSummary[] = []
  for (const c of chunks) {
    const summary = await summariseChunk(
      c.messages.map(m => ({ speakerId: m.speakerId, text: m.text })),
      c.contextHeader,
      lang
    )
    summaries.push(summary)
  }

  // Truncate analysisContext to ~60k chars to stay within model context limit
  const fullContext = JSON.stringify(summaries)
  const analysisContext = fullContext.length > 60000 ? fullContext.slice(0, 60000) + '...(truncated)' : fullContext

  // 2. Generate sections sequentially to avoid TPM rate limits
  const title        = await generatePaperSection({ section: 'title',        analysisContext, lang, style })
  const abstract     = await generatePaperSection({ section: 'abstract',     analysisContext, lang, style })
  const introduction = await generatePaperSection({ section: 'introduction', analysisContext, lang, style })
  const methods      = await generatePaperSection({ section: 'methods',      analysisContext, lang, style })
  const results      = await generatePaperSection({ section: 'results',      analysisContext, lang, style })
  const discussion   = await generatePaperSection({ section: 'discussion',   analysisContext, lang, style })
  const conclusion   = await generatePaperSection({ section: 'conclusion',   analysisContext, lang, style })

  return { title, abstract, introduction, methods, results, discussion, conclusion }
}
