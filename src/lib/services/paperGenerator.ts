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

  // 1. Chunk and summarise
  const chunks = chunkMessages(messages)
  const summaries: ChunkSummary[] = await Promise.all(
    chunks.map(c =>
      summariseChunk(
        c.messages.map(m => ({ speakerId: m.speakerId, text: m.text })),
        c.contextHeader,
        lang
      )
    )
  )

  const analysisContext = JSON.stringify(summaries)

  // 2. Generate all sections (title + 6 body sections) in parallel
  const [title, abstract, introduction, methods, results, discussion, conclusion] =
    await Promise.all([
      generatePaperSection({ section: 'title',        analysisContext, lang, style }),
      generatePaperSection({ section: 'abstract',     analysisContext, lang, style }),
      generatePaperSection({ section: 'introduction', analysisContext, lang, style }),
      generatePaperSection({ section: 'methods',      analysisContext, lang, style }),
      generatePaperSection({ section: 'results',      analysisContext, lang, style }),
      generatePaperSection({ section: 'discussion',   analysisContext, lang, style }),
      generatePaperSection({ section: 'conclusion',   analysisContext, lang, style }),
    ])

  return { title, abstract, introduction, methods, results, discussion, conclusion }
}
