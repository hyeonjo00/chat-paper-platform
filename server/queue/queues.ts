import { Queue, type JobsOptions } from 'bullmq'
import { getRedisConnection } from './redis'

export const PAPER_QUEUE_NAME = 'paper-generation'

export interface PaperJobPayload {
  jobId: string
  uploadId: string
  paperId: string
  userId: string
  language: string
  writingStyle: string
}

export const PAPER_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5_000, // 5s → 10s → 20s
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
}

let _paperQueue: Queue<PaperJobPayload, void, string> | null = null

export function getPaperQueue(): Queue<PaperJobPayload, void, string> {
  if (!_paperQueue) {
    _paperQueue = new Queue(PAPER_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: PAPER_JOB_OPTIONS,
    })
  }
  return _paperQueue
}

export async function enqueuePaperJob(
  payload: PaperJobPayload,
  idempotencyKey: string,
): Promise<string> {
  const queue = getPaperQueue()
  const job = await queue.add('generate', payload, {
    ...PAPER_JOB_OPTIONS,
    jobId: idempotencyKey, // BullMQ deduplicates by jobId
  })
  return job.id!
}
