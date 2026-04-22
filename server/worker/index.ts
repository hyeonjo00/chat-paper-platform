import { Worker } from 'bullmq'
import { PAPER_QUEUE_NAME, type PaperJobPayload } from '../queue/queues'
import { getWorkerRedisConnection } from '../queue/redis'
import { processPaperJob } from './processor'
import { markJobFailed } from '../services/jobService'
import { recoverStuckJobs, recoverStuckPendingJobs, purgeOldJobLogs } from './recovery'
import { logger } from '../lib/logger'
import { loadWorkerEnv } from '../lib/env'
import { getPrisma } from '../db/client'

const LOCK_RENEW_MS = 2 * 60 * 1_000
const RECOVERY_INTERVAL_MS = 5 * 60 * 1_000
const SHUTDOWN_TIMEOUT_MS = 4_000

let worker: Worker<PaperJobPayload, void, string> | null = null
let recoveryTimer: ReturnType<typeof setInterval> | null = null
let shuttingDown = false

class JobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Job exceeded hard timeout of ${timeoutMs}ms`)
    this.name = 'JobTimeoutError'
  }
}

async function runWithHardDeadline(
  data: PaperJobPayload,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new JobTimeoutError(timeoutMs))
    }, timeoutMs)
  })

  try {
    await Promise.race([processPaperJob(data, controller.signal), timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function validateStartup() {
  const redis = getWorkerRedisConnection()
  await redis.ping()
  await getPrisma().$queryRaw`SELECT 1`
}

async function closeWorkerWithTimeout() {
  if (!worker) return

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Worker close timed out after ${SHUTDOWN_TIMEOUT_MS}ms`)),
      SHUTDOWN_TIMEOUT_MS,
    )
  })

  try {
    await Promise.race([worker.close(), timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  logger.info(`${signal} - draining worker`)
  if (recoveryTimer) clearInterval(recoveryTimer)
  await closeWorkerWithTimeout()
  process.exit(0)
}

async function main() {
  const env = loadWorkerEnv()
  await validateStartup()

  worker = new Worker<PaperJobPayload, void, string>(
    PAPER_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.data.jobId, attempt: job.attemptsMade + 1 }, 'Processing job')
      await runWithHardDeadline(job.data, env.jobTimeoutMs)
    },
    {
      connection: getWorkerRedisConnection(),
      concurrency: env.workerConcurrency,
      lockDuration: env.jobTimeoutMs + 90_000,
      lockRenewTime: Math.min(LOCK_RENEW_MS, Math.floor(env.jobTimeoutMs / 3)),
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

  const runRecovery = async () => {
    await recoverStuckJobs().catch((err) => logger.error(err, 'PROCESSING recovery failed'))
    await recoverStuckPendingJobs().catch((err) => logger.error(err, 'PENDING recovery failed'))
    await purgeOldJobLogs().catch((err) => logger.error(err, 'Log purge failed'))
  }

  recoveryTimer = setInterval(runRecovery, RECOVERY_INTERVAL_MS)
  await runRecovery()
  logger.info(
    { concurrency: env.workerConcurrency, jobTimeoutMs: env.jobTimeoutMs },
    `Worker started on queue "${PAPER_QUEUE_NAME}"`,
  )
}

function handleSignal(signal: string) {
  shutdown(signal).catch((err) => {
    logger.fatal(err, 'Shutdown failed')
    process.exit(1)
  })
}

process.on('SIGTERM', () => handleSignal('SIGTERM'))
process.on('SIGINT',  () => handleSignal('SIGINT'))

main().catch((err) => {
  logger.fatal(err, 'Worker startup failed')
  process.exit(1)
})
