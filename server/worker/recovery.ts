import { getPrisma } from '../db/client'
import { getPaperQueue, PAPER_JOB_OPTIONS } from '../queue/queues'
import { logger } from '../lib/logger'
import type { PaperJobPayload } from '../queue/queues'

const prisma = getPrisma()

const STUCK_AFTER_MS = 12 * 60 * 1_000
const STUCK_PENDING_AFTER_MS = 30 * 60 * 1_000
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const REQUEUE_DELAY_MS = 5_000
const RUNNABLE_STATES = new Set([
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
  'paused',
])
const REUSABLE_STATES = new Set(['failed', 'completed', 'unknown'])

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
      idempotencyKey: true,
      metadata: true,
    },
  })

  if (stuck.length === 0) return

  logger.warn({ count: stuck.length }, 'Recovering stuck jobs')

  const queue = getPaperQueue()

  for (const job of stuck) {
    const remainingAttempts = job.maxAttempts - job.attempts
    const isFinal = remainingAttempts <= 0
    const log = logger.child({ jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts })

    if (isFinal || !job.uploadId || !job.paperId) {
      await prisma.$transaction(async (tx) => {
        await tx.job.updateMany({
          where: { id: job.id, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            errorMessage: 'Job timed out with no retries remaining',
            startedAt: null,
            failedAt: new Date(),
          },
        })
        if (job.paperId) {
          await tx.paper.updateMany({
            where: { id: job.paperId, status: 'PROCESSING' },
            data: { status: 'FAILED' },
          })
        }
      }, { maxWait: 5_000, timeout: 30_000 })
      log.error('Stuck job permanently failed')
      continue
    }

    const bullJobId = job.idempotencyKey ?? job.id
    const existing = await queue.getJob(bullJobId)

    if (existing) {
      const state = await existing.getState()
      if (RUNNABLE_STATES.has(state)) {
        log.warn({ state }, 'Job already runnable in Redis; skipping requeue')
        continue
      }

      if (!REUSABLE_STATES.has(state)) {
        log.error({ state }, 'Unknown BullMQ state; skipping unsafe recovery')
        continue
      }

      await existing.remove()
      log.warn({ state }, 'Removed terminal BullMQ job before requeue')
    }

    const meta = (job.metadata ?? {}) as Record<string, unknown>
    const payload: PaperJobPayload = {
      jobId: job.id,
      uploadId: job.uploadId,
      paperId: job.paperId,
      userId: job.userId,
      language: (meta.lang as string) ?? 'ko',
      writingStyle: (meta.style as string) ?? 'communication_analysis',
    }

    const added = await queue.add('generate', payload, {
      ...PAPER_JOB_OPTIONS,
      attempts: remainingAttempts,
      delay: REQUEUE_DELAY_MS,
      jobId: bullJobId,
    })

    const update = await prisma.job.updateMany({
      where: { id: job.id, status: 'PROCESSING' },
      data: {
        status: 'PENDING',
        progress: 0,
        startedAt: null,
        errorMessage: null,
        errorStack: null,
      },
    })

    if (update.count !== 1) {
      await added.remove().catch((err) => {
        log.error({ err }, 'Failed to remove requeued job after DB state mismatch')
      })
      log.error('Recovery enqueue rolled back because DB state changed')
      continue
    }

    log.warn({ remainingAttempts }, 'Stuck job requeued for retry')
  }
}

export async function recoverStuckPendingJobs() {
  const cutoff = new Date(Date.now() - STUCK_PENDING_AFTER_MS)

  const stuck = await prisma.job.findMany({
    where: {
      status: 'PENDING',
      enqueuedAt: { lt: cutoff },
      uploadId: { not: null },
      paperId: { not: null },
    },
    select: {
      id: true,
      uploadId: true,
      paperId: true,
      userId: true,
      maxAttempts: true,
      idempotencyKey: true,
      metadata: true,
    },
  })

  if (stuck.length === 0) return

  logger.warn({ count: stuck.length }, 'Recovering stuck PENDING jobs')

  const queue = getPaperQueue()

  for (const job of stuck) {
    if (!job.uploadId || !job.paperId) continue

    const bullJobId = job.idempotencyKey ?? job.id
    const log = logger.child({ jobId: job.id })

    const existing = await queue.getJob(bullJobId)
    if (existing) {
      const state = await existing.getState()
      if (RUNNABLE_STATES.has(state)) {
        log.warn({ state }, 'PENDING job already in Redis queue — skipping')
        continue
      }
      await existing.remove()
    }

    const meta = (job.metadata ?? {}) as Record<string, unknown>
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
      {
        ...PAPER_JOB_OPTIONS,
        attempts: job.maxAttempts,
        delay: REQUEUE_DELAY_MS,
        jobId: bullJobId,
      },
    )

    log.warn('Stuck PENDING job re-enqueued')
  }
}

export async function purgeOldJobLogs() {
  const cutoff = new Date(Date.now() - LOG_RETENTION_MS)
  const { count } = await prisma.jobLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  if (count > 0) logger.info({ count }, 'Purged old job logs')
}
