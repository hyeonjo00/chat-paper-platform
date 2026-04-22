import { getPrisma } from '../db/client'
import { getPaperQueue } from '../queue/queues'
import { logger } from '../lib/logger'
import type { PaperJobPayload } from '../queue/queues'

const prisma = getPrisma()

// Runs on a timer inside the worker process.
// Finds jobs stuck in PROCESSING longer than stuckAfterMs and either requeues
// them (if retries remain) or permanently fails them.
const STUCK_AFTER_MS = 12 * 60 * 1_000 // 12 min — slightly beyond the 10 min job timeout

export async function recoverStuckJobs() {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS)

  const stuck = await prisma.job.findMany({
    where: {
      status: 'PROCESSING',
      startedAt: { lt: cutoff },
    },
    select: {
      id: true,
      uploadId: true,
      paperId: true,
      userId: true,
      attempts: true,
      maxAttempts: true,
      metadata: true,
    },
  })

  if (stuck.length === 0) return

  logger.warn({ count: stuck.length }, 'Recovering stuck jobs')

  for (const job of stuck) {
    const isFinal = job.attempts >= job.maxAttempts
    const log = logger.child({ jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts })

    if (isFinal || !job.uploadId || !job.paperId) {
      // No retries left — permanently fail both Job and Paper
      await prisma.$transaction([
        prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            errorMessage: 'Job timed out with no retries remaining',
            failedAt: new Date(),
          },
        }),
        ...(job.paperId
          ? [prisma.paper.update({ where: { id: job.paperId }, data: { status: 'FAILED' } })]
          : []),
      ])
      log.error('Stuck job permanently failed')
    } else {
      // Reset to PENDING and requeue — worker will pick it up
      const meta = (job.metadata ?? {}) as Record<string, unknown>
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'PENDING', progress: 0, startedAt: null },
      })

      const queue = getPaperQueue()
      await queue.add(
        'generate',
        {
          jobId: job.id,
          uploadId: job.uploadId,
          paperId: job.paperId,
          userId: job.userId,
          language: (meta.lang as string) ?? 'ko',
          writingStyle: (meta.style as string) ?? 'communication_analysis',
        } satisfies PaperJobPayload,
      )
      log.warn('Stuck job requeued for retry')
    }
  }
}
