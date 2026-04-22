import 'dotenv/config'
import { Worker } from 'bullmq'
import { PAPER_QUEUE_NAME, type PaperJobPayload } from '../queue/queues'
import { getWorkerRedisConnection } from '../queue/redis'
import { processPaperJob } from './processor'
import { markJobFailed } from '../services/jobService'
import { recoverStuckJobs } from './recovery'
import { logger } from '../lib/logger'

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2)
// lockDuration: how long the worker holds the Redis lock between renewals.
// timeout: BullMQ forcibly moves the job to failed after this many ms.
// Both must be set — lockDuration alone does not kill a hung job.
const JOB_TIMEOUT_MS = 10 * 60 * 1_000   // 10 min
const LOCK_RENEW_MS  =  2 * 60 * 1_000   // renew lock every 2 min (< timeout)

const worker = new Worker<PaperJobPayload, void, string>(
  PAPER_QUEUE_NAME,
  async (job) => {
    logger.info({ jobId: job.data.jobId, attempt: job.attemptsMade + 1 }, 'Processing job')
    await processPaperJob(job)
  },
  {
    connection: getWorkerRedisConnection(),
    concurrency: CONCURRENCY,
    lockDuration: JOB_TIMEOUT_MS,
    lockRenewTime: LOCK_RENEW_MS,
    // Respect OpenAI TPM: max 2 jobs per 10s
    limiter: { max: 2, duration: 10_000 },
  },
)

worker.on('failed', async (job, err) => {
  if (!job) return
  const maxAttempts = job.opts.attempts ?? 3
  const isFinal = job.attemptsMade >= maxAttempts
  logger.error(
    { jobId: job.data.jobId, attempt: job.attemptsMade, maxAttempts, isFinal },
    err.message,
  )
  await markJobFailed(job.data.jobId, err, isFinal).catch((dbErr) => {
    logger.error({ jobId: job.data.jobId }, `Failed to persist job failure: ${dbErr}`)
  })
})

worker.on('error', (err) => {
  logger.error(err, 'Worker error')
})

async function shutdown(signal: string) {
  logger.info(`${signal} — draining worker`)
  clearInterval(recoveryTimer)
  await worker.close()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

logger.info({ concurrency: CONCURRENCY }, `Worker started on queue "${PAPER_QUEUE_NAME}"`)

// Stuck-job recovery: runs every 5 min inside this process
const RECOVERY_INTERVAL_MS = 5 * 60 * 1_000
const recoveryTimer = setInterval(() => {
  recoverStuckJobs().catch((err) => logger.error(err, 'Recovery sweep failed'))
}, RECOVERY_INTERVAL_MS)
// Run once immediately on startup to catch any pre-existing stuck jobs
recoverStuckJobs().catch((err) => logger.error(err, 'Initial recovery sweep failed'))
