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
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PROCESSING,
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  })
}

export async function updateJobProgress(jobId: string, progress: number) {
  return prisma.job.update({
    where: { id: jobId },
    data: { progress: Math.min(100, Math.max(0, progress)) },
  })
}

export async function markJobCompleted(jobId: string, paperId: string) {
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      progress: 100,
      paperId,
      completedAt: new Date(),
    },
  })
}

export async function markJobFailed(
  jobId: string,
  error: Error,
  isFinal: boolean,
) {
  const jobData: Prisma.JobUpdateInput = {
    errorMessage: error.message,
    errorStack: error.stack,
  }
  if (isFinal) {
    jobData.status = JobStatus.FAILED
    jobData.failedAt = new Date()
  }

  // When permanently failed, atomically fail both Job and its Paper so neither
  // stays stuck in PROCESSING indefinitely.
  if (isFinal) {
    const [job] = await prisma.$transaction(async (tx) => {
      const updated = await tx.job.update({ where: { id: jobId }, data: jobData })
      if (updated.paperId) {
        await tx.paper.update({
          where: { id: updated.paperId },
          data: { status: 'FAILED' },
        })
      }
      return [updated]
    })
    await appendJobLog(jobId, 'error', `Job permanently failed: ${error.message}`, {
      stack: error.stack,
    })
    return job
  }

  const job = await prisma.job.update({ where: { id: jobId }, data: jobData })
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
