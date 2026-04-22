const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])

export interface WorkerEnv {
  redisUrl: string
  databaseUrl: string
  openAiApiKey: string
  workerConcurrency: number
  logLevel: string
  jobTimeoutMs: number
}

function required(name: string, errors: string[]): string {
  const value = process.env[name]?.trim()
  if (!value) errors.push(`${name} is required`)
  return value ?? ''
}

function parsePositiveInt(name: string, fallback: number, errors: string[]): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${name} must be a positive integer`)
    return fallback
  }
  return value
}

export function loadWorkerEnv(): WorkerEnv {
  const errors: string[] = []
  const redisUrl = required('REDIS_URL', errors)
  const databaseUrl = required('DATABASE_URL', errors)
  const openAiApiKey = required('OPENAI_API_KEY', errors)
  const workerConcurrency = parsePositiveInt('WORKER_CONCURRENCY', 2, errors)
  const jobTimeoutMs = parsePositiveInt('JOB_TIMEOUT_MS', 10 * 60 * 1_000, errors)
  const logLevel = process.env.LOG_LEVEL?.trim() || 'info'

  if (!LOG_LEVELS.has(logLevel)) {
    errors.push(`LOG_LEVEL must be one of: ${Array.from(LOG_LEVELS).join(', ')}`)
  }
  if (workerConcurrency > 10) {
    errors.push('WORKER_CONCURRENCY must be <= 10')
  }
  if (jobTimeoutMs < 60_000) {
    errors.push('JOB_TIMEOUT_MS must be at least 60000')
  }

  if (errors.length > 0) {
    throw new Error(`Worker environment validation failed: ${errors.join('; ')}`)
  }

  return { redisUrl, databaseUrl, openAiApiKey, workerConcurrency, logLevel, jobTimeoutMs }
}
