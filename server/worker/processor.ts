import { Job as BullJob } from 'bullmq'
import type { PaperJobPayload } from '../queue/queues'
import { getPrisma } from '../db/client'
import {
  markJobProcessing,
  updateJobProgress,
  markJobCompleted,
  appendJobLog,
} from '../services/jobService'
import { childLogger } from '../lib/logger'
import { chunkMessages } from '../../src/lib/nlp/chunker'
import { callWithRetry } from '../../src/lib/openai/client'
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
  SAVED: 100,
} as const

export async function processPaperJob(bullJob: BullJob<PaperJobPayload>) {
  const { jobId, uploadId, paperId, language, writingStyle } = bullJob.data
  const lang = language as PaperLang
  const style = writingStyle as WritingStyle
  const log = childLogger({ jobId, paperId, uploadId })

  await markJobProcessing(jobId)
  await appendJobLog(jobId, 'info', 'Worker started')
  await updateJobProgress(jobId, PROGRESS.START)

  // ── 1. Load messages ────────────────────────────────────────────────────────
  const rows = await prisma.parsedMessage.findMany({
    where: { uploadId },
    orderBy: { timestamp: 'asc' },
    select: { id: true, speakerId: true, timestamp: true, text: true },
  })

  if (rows.length === 0) {
    throw new Error(`No parsed messages for uploadId=${uploadId}`)
  }

  log.info({ count: rows.length }, 'Messages loaded')
  await updateJobProgress(jobId, PROGRESS.MESSAGES_LOADED)

  const normalised: NormalizedMessage[] = rows.map((m) => ({
    id: m.id,
    speakerId: m.speakerId,
    timestamp: m.timestamp.toISOString(),
    text: m.text,
  }))

  // ── 2. Chunk ────────────────────────────────────────────────────────────────
  const chunks = chunkMessages(normalised)
  await appendJobLog(jobId, 'info', `Created ${chunks.length} chunk(s)`)

  // ── 3. Parallel: relationship + sequential chunk summaries ──────────────────
  const [relationshipResult, chunkSummaries] = await Promise.all([
    callWithRetry(() => analyseRelationship(normalised, lang)) as Promise<RelationshipAnalysis>,
    (async (): Promise<ChunkSummary[]> => {
      const summaries: ChunkSummary[] = []
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const summary = await callWithRetry(() =>
          summariseChunk(chunk.messages, chunk.contextHeader, lang),
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

  // ── 4. Build analysis context (JSON string) for section generator ───────────
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
    callWithRetry(() => generatePaperSection({ section: 'title', ...sectionOpts })),
    callWithRetry(() => generatePaperSection({ section: 'abstract', ...sectionOpts })),
    callWithRetry(() => generatePaperSection({ section: 'introduction', ...sectionOpts })),
  ])

  await updateJobProgress(jobId, PROGRESS.SECTIONS_BATCH1_DONE)

  const [methods, results, discussion, conclusion] = await Promise.all([
    callWithRetry(() => generatePaperSection({ section: 'methods', ...sectionOpts })),
    callWithRetry(() => generatePaperSection({ section: 'results', ...sectionOpts })),
    callWithRetry(() => generatePaperSection({ section: 'discussion', ...sectionOpts })),
    callWithRetry(() => generatePaperSection({ section: 'conclusion', ...sectionOpts })),
  ])

  await updateJobProgress(jobId, PROGRESS.SECTIONS_BATCH2_DONE)
  await appendJobLog(jobId, 'info', 'All sections generated')

  // ── 6. Persist ──────────────────────────────────────────────────────────────
  await prisma.paper.update({
    where: { id: paperId },
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

  await markJobCompleted(jobId, paperId)
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
