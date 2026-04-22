import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getApiRedisConnection } from '../../../server/queue/redis'

const MAX_CONCURRENT_JOBS = 2
const MAX_DAILY_JOBS = 10
const MAX_DAILY_UPLOADS = 20
const WINDOW_SEC = 60
const IP_PREFLIGHT_MAX = 30
const IP_PREFLIGHT_WINDOW_SEC = 60

const ROUTE_LIMITS = {
  upload: { ip: 8, guest: 6 },
  analyze: { ip: 6, guest: 4 },
} as const

type LimitedRoute = keyof typeof ROUTE_LIMITS

function dayStart() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start
}

function hashPart(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL?.trim()
}

async function incrementLimit(key: string, max: number) {
  const redis = getApiRedisConnection()
  const result = await redis.eval(
    `local n = redis.call('INCR', KEYS[1])
     if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
     return n`,
    1,
    key,
    String(WINDOW_SEC),
  ) as number
  return result <= max
}

export async function checkIpPreflightRateLimit(
  req: NextRequest,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isRedisConfigured()) return { ok: true }
  try {
    const ip = getClientIp(req)
    const redis = getApiRedisConnection()
    const result = await redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return n`,
      1,
      `preflight:ip:${hashPart(ip)}`,
      String(IP_PREFLIGHT_WINDOW_SEC),
    ) as number
    if (result > IP_PREFLIGHT_MAX) {
      return { ok: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
    }
    return { ok: true }
  } catch (e) {
    console.error('[rate-limit] preflight Redis error (fail-open):', e instanceof Error ? e.message : e)
    return { ok: true }
  }
}

export async function checkRouteRateLimit(
  route: LimitedRoute,
  ip: string,
  guestKey: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isRedisConfigured()) return { ok: true }
  try {
    const limits = ROUTE_LIMITS[route]
    const [ipOk, guestOk] = await Promise.all([
      incrementLimit(`ratelimit:${route}:ip:${hashPart(ip)}`, limits.ip),
      incrementLimit(`ratelimit:${route}:guest:${hashPart(guestKey)}`, limits.guest),
    ])

    if (!ipOk || !guestOk) {
      return { ok: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
    }
    return { ok: true }
  } catch (e) {
    console.error('[rate-limit] Redis error (fail-open):', e instanceof Error ? e.message : e)
    return { ok: true }
  }
}

export async function checkUserQuota(
  userId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const start = dayStart()

  const [concurrent, daily] = await Promise.all([
    prisma.job.count({ where: { userId, status: { in: ['PENDING', 'PROCESSING'] } } }),
    prisma.job.count({ where: { userId, enqueuedAt: { gte: start } } }),
  ])

  if (concurrent >= MAX_CONCURRENT_JOBS) {
    return { ok: false, message: '이미 처리 중인 논문이 있습니다. 완료 후 다시 시도해 주세요.' }
  }
  if (daily >= MAX_DAILY_JOBS) {
    return { ok: false, message: '오늘의 논문 생성 한도에 도달했습니다. 내일 다시 시도해 주세요.' }
  }
  return { ok: true }
}

export async function checkUploadQuota(
  userId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const daily = await prisma.upload.count({
    where: { userId, uploadedAt: { gte: dayStart() } },
  })

  if (daily >= MAX_DAILY_UPLOADS) {
    return { ok: false, message: '오늘의 업로드 한도에 도달했습니다. 내일 다시 시도해 주세요.' }
  }
  return { ok: true }
}

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0'
  )
}
