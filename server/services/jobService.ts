import { JobStatus, Prisma } from '@prisma/client'
import { getPrisma } from '../db/client'
import { logger } from '../lib/logger'

const prisma = getPrisma()

export async function createJob(params: {
  userId: string
  uploadId?: string
  paperId?: string
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}) {
  return prisma.job.create({
    data: {
      userId: params.userId,
      uploadId: params.uploadId,
      paperId: params.paperId,
      idempotencyKey: params.idempotencyKey,
      metadata: params.metadata as Prisma.InputJsonValue,
    },
  })
}

export async function findJobByIdempotencyKey(key: string) {
  return prisma.job.findUnique({ where: { idempotencyKey: key } })
}

export async function markJobProcessing(jobId: string) {
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.PENDING },
    data: {
      status: JobStatus.PROCESSING,
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  })

  if (result.count !== 1) {
    const current = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    })
    logger.warn({ jobId, status: current?.status ?? 'missing' }, 'Skipping non-pending job')
    return null
  }

  return prisma.job.findUniqueOrThrow({ where: { id: jobId } })
}

export async function updateJobProgress(jobId: string, progress: number) {
  return prisma.job.update({
    where: { id: jobId },
    data: { progress: Math.min(100, Math.max(0, progress)) },
  })
}

export async function markJobCompleted(jobId: string, paperId: string) {
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.PROCESSING },
    data: {
      status: JobStatus.COMPLETED,
      progress: 100,
      paperId,
      completedAt: new Date(),
    },
  })
  if (result.count !== 1) {
    logger.warn({ jobId }, 'Skipping completion for non-processing job')
    return null
  }
  return prisma.job.findUniqueOrThrow({ where: { id: jobId } })
}

export async function markJobFailed(
  jobId: string,
  error: Error,
  isFinal: boolean,
) {
  const jobData: Prisma.JobUpdateManyMutationInput = {
    errorMessage: error.message,
    errorStack: error.stack,
  }
  if (isFinal) {
    jobData.status = JobStatus.FAILED
    jobData.failedAt = new Date()
    jobData.startedAt = null
  } else {
    jobData.status = JobStatus.PENDING
    jobData.startedAt = null
  }

  // When permanently failed, atomically fail both Job and its Paper so neither
  // stays stuck in PROCESSING indefinitely.
  if (isFinal) {
    const job = await prisma.$transaction(async (tx) => {
      const update = await tx.job.updateMany({
        where: { id: jobId, status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
        data: jobData,
      })
      const updated = await tx.job.findUnique({ where: { id: jobId } })
      if (update.count !== 1 || !updated) return updated
      if (updated.paperId) {
        await tx.paper.updateMany({
          where: { id: updated.paperId, status: 'PROCESSING' },
          data: { status: 'FAILED' },
        })
      }
      return updated
    }, { maxWait: 5_000, timeout: 30_000 })
    await appendJobLog(jobId, 'error', `Job permanently failed: ${error.message}`, {
      stack: error.stack,
    })
    return job
  }

  const update = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.PROCESSING },
    data: jobData,
  })
  const job = await prisma.job.findUnique({ where: { id: jobId } })
  if (update.count !== 1) {
    logger.warn({ jobId, status: job?.status ?? 'missing' }, 'Skipping retry state update for non-processing job')
  }
  await appendJobLog(jobId, 'error', `Job attempt failed (will retry): ${error.message}`, {
    stack: error.stack,
  })
  return job
}

export async function appendJobLog(
  jobId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>,
) {
  logger[level]({ jobId, ...data }, message)
  return prisma.jobLog.create({
    data: { jobId, level, message, data: data as Prisma.InputJsonValue },
  })
}

export async function getJobStatus(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      status: true,
      progress: true,
      paperId: true,
      errorMessage: true,
      enqueuedAt: true,
      startedAt: true,
      completedAt: true,
      failedAt: true,
      attempts: true,
      maxAttempts: true,
    },
  })
}
