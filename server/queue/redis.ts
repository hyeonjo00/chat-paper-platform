import IORedis from 'ioredis'

// Separate configs for API (non-blocking) vs Worker (persistent)
function getRedisUrl(): string {
  const url = process.env.REDIS_URL?.trim()
  if (!url) throw new Error('REDIS_URL is not set')

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      throw new Error('invalid protocol')
    }
    if (
      process.env.NODE_ENV === 'production' &&
      parsed.protocol === 'redis:' &&
      parsed.hostname.endsWith('.upstash.io') &&
      !parsed.hostname.startsWith('fly-')
    ) {
      throw new Error('public Upstash Redis URLs require TLS')
    }
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// URL, or rediss:// for public Upstash endpoints')
  }

  return url
}

function sanitizeRedisErrorMessage(message: string): string {
  const configuredUrl = process.env.REDIS_URL?.trim()
  let sanitized = configuredUrl ? message.replaceAll(configuredUrl, '[REDACTED_REDIS_URL]') : message
  sanitized = sanitized.replaceAll(/\/\/([^:@\s]+):([^@\s]+)@/g, '//[redacted]:[redacted]@')
  return sanitized
}

function makeConnection(enableOfflineQueue: boolean): IORedis {
  const url = getRedisUrl()
  const parsed = new URL(url)

  const conn = new IORedis(url, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    enableOfflineQueue,
    connectTimeout: 5_000,
    ...(parsed.protocol === 'rediss:' ? { tls: { servername: parsed.hostname } } : {}),
    retryStrategy: (times: number) => {
      if (times > 5) return null // stop retrying after 5 attempts
      return Math.min(times * 500, 3_000)
    },
    lazyConnect: false,
  })

  conn.on('error', (err) => {
    console.error('[redis] connection error', sanitizeRedisErrorMessage(err.message))
  })

  return conn
}

// API-side: offline queue disabled so enqueue fails fast on Redis outage
let _apiConn: IORedis | null = null
export function getApiRedisConnection(): IORedis {
  if (!_apiConn) _apiConn = makeConnection(false)
  return _apiConn
}

// Worker-side: offline queue enabled so worker can reconnect after blip
let _workerConn: IORedis | null = null
export function getWorkerRedisConnection(): IORedis {
  if (!_workerConn) _workerConn = makeConnection(true)
  return _workerConn
}

// Back-compat alias used by queue singleton (API side)
export function getRedisConnection(): IORedis {
  return getApiRedisConnection()
}
