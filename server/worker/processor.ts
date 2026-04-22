import type { PaperJobPayload } from '../queue/queues'
import { getPrisma } from '../db/client'
import {
  markJobProcessing,
  updateJobProgress,
  appendJobLog,
} from '../services/jobService'
import { childLogger } from '../lib/logger'
import { chunkMessages } from '../../src/lib/nlp/chunker'
import {
  analyseRelationship,
  summariseChunk,
  generatePaperSection,
  type PaperLang,
  type WritingStyle,
  type ChunkSummary,
  type RelationshipAnalysis,
} from '../../src/lib/openai/promptPipeline'
import type { NormalizedMessage } from '../../src/types/conversation'
import { PaperStatus } from '@prisma/client'

const prisma = getPrisma()

const PROGRESS = {
  START: 5,
  MESSAGES_LOADED: 10,
  RELATIONSHIP_DONE: 30,
  CHUNKS_SUMMARISED: 55,
  SECTIONS_BATCH1_DONE: 75,
  SECTIONS_BATCH2_DONE: 95,
} as const

export async function processPaperJob(data: PaperJobPayload, signal: AbortSignal) {
  const { jobId, uploadId, paperId, language, writingStyle } = data
  const lang = language as PaperLang
  const style = writingStyle as WritingStyle
  const log = childLogger({ jobId, paperId, uploadId })

  const started = await markJobProcessing(jobId)
  if (!started) return

  await appendJobLog(jobId, 'info', 'Worker started')
  await updateJobProgress(jobId, PROGRESS.START)

  // ── 1. Load messages ────────────────────────────────────────────────────────
  if (signal.aborted) throw new Error('Job aborted')

  const rows = await prisma.parsedMessage.findMany({
    where: { uploadId },
    orderBy: { timestamp: 'asc' },
    select: { id: true, speakerId: true, timestamp: true, text: true },
  })

  if (rows.length === 0) throw new Error(`No parsed messages for uploadId=${uploadId}`)

  log.info({ count: rows.length }, 'Messages loaded')
  await updateJobProgress(jobId, PROGRESS.MESSAGES_LOADED)

  const normalised: NormalizedMessage[] = rows.map((m) => ({
    id: m.id,
    speakerId: m.speakerId,
    timestamp: m.timestamp.toISOString(),
    text: m.text,
  }))

  // ── 2. Chunk ────────────────────────────────────────────────────────────────
  if (signal.aborted) throw new Error('Job aborted')
  const chunks = chunkMessages(normalised)
  await appendJobLog(jobId, 'info', `Created ${chunks.length} chunk(s)`)

  // ── 3. Parallel: relationship + sequential chunk summaries ──────────────────
  if (signal.aborted) throw new Error('Job aborted')

  const [relationshipResult, chunkSummaries] = await Promise.all([
    analyseRelationship(normalised, lang, signal) as Promise<RelationshipAnalysis>,
    (async (): Promise<ChunkSummary[]> => {
      const summaries: ChunkSummary[] = []
      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) throw new Error('Job aborted')
        const chunk = chunks[i]
        const summary = await summariseChunk(
          chunk.messages,
          chunk.contextHeader,
          lang,
          signal,
        ) as ChunkSummary
        summaries.push(summary)
        const p =
          PROGRESS.RELATIONSHIP_DONE +
          ((i + 1) / chunks.length) *
            (PROGRESS.CHUNKS_SUMMARISED - PROGRESS.RELATIONSHIP_DONE)
        await updateJobProgress(jobId, Math.round(p))
      }
      return summaries
    })(),
  ])

  await appendJobLog(jobId, 'info', 'Relationship + chunk summaries complete')
  await updateJobProgress(jobId, PROGRESS.CHUNKS_SUMMARISED)

  // ── 4. Build analysis context ───────────────────────────────────────────────
  if (signal.aborted) throw new Error('Job aborted')

  const speakerCount = Math.max(
    ...chunkSummaries.map((s) => s.speakerCount ?? 2),
    2,
  )

  const analysisContext = JSON.stringify({
    relationship: relationshipResult,
    summaries: chunkSummaries,
    messageCount: normalised.length,
    speakerCount,
  })

  const sectionOpts = { analysisContext, lang, style, speakerCount }

  // ── 5. Generate sections in two parallel batches ────────────────────────────
  const [title, abstract, introduction] = await Promise.all([
    generatePaperSection({ section: 'title',        ...sectionOpts }, signal),
    generatePaperSection({ section: 'abstract',     ...sectionOpts }, signal),
    generatePaperSection({ section: 'introduction', ...sectionOpts }, signal),
  ])

  await updateJobProgress(jobId, PROGRESS.SECTIONS_BATCH1_DONE)
  if (signal.aborted) throw new Error('Job aborted')

  const [methods, results, discussion, conclusion] = await Promise.all([
    generatePaperSection({ section: 'methods',    ...sectionOpts }, signal),
    generatePaperSection({ section: 'results',    ...sectionOpts }, signal),
    generatePaperSection({ section: 'discussion', ...sectionOpts }, signal),
    generatePaperSection({ section: 'conclusion', ...sectionOpts }, signal),
  ])

  await updateJobProgress(jobId, PROGRESS.SECTIONS_BATCH2_DONE)
  await appendJobLog(jobId, 'info', 'All sections generated')

  // ── 6. Atomic persist: Paper + Job in one transaction with PROCESSING guard ─
  if (signal.aborted) throw new Error('Job aborted')

  await prisma.$transaction(async (tx) => {
    const paperUpdate = await tx.paper.updateMany({
      where: { id: paperId, status: 'PROCESSING' },
      data: {
        status: PaperStatus.COMPLETED,
        title,
        abstract,
        introduction,
        methods,
        results,
        discussion,
        conclusion,
        relationshipType: relationshipResult.relationshipType,
        relationshipIssues: relationshipResult.hasIssues
          ? relationshipResult.issues.join('\n')
          : null,
        affectionScores:
          relationshipResult.isRomantic && relationshipResult.affectionScores
            ? (relationshipResult.affectionScores as object)
            : undefined,
        references: buildReferences(chunkSummaries),
        generatedAt: new Date(),
      },
    })
    const jobUpdate = await tx.job.updateMany({
      where: { id: jobId, status: 'PROCESSING' },
      data: { status: 'COMPLETED', progress: 100, paperId, completedAt: new Date() },
    })
    if (paperUpdate.count !== 1 || jobUpdate.count !== 1) {
      throw new Error('Job completion state guard failed')
    }
  }, { maxWait: 5_000, timeout: 30_000 })

  await appendJobLog(jobId, 'info', 'Paper saved — job complete')
  log.info('Job completed successfully')
}

function buildReferences(summaries: ChunkSummary[]): object {
  const topics = new Set<string>()
  for (const s of summaries) {
    for (const t of s.topics ?? []) topics.add(t)
  }
  return Array.from(topics).map((t, i) => ({ id: i + 1, title: t, type: 'topic' }))
}
