import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { ok, err, ERRORS } from '@/lib/api/response'
import { getOrCreateGuestUser, setGuestCookie } from '@/lib/auth/guest-user'
import { anonymizeMessages } from '@/lib/privacy/anonymizer'
import { detectFromMessages } from '@/lib/nlp/languageDetector'
import { enqueuePaperJob } from '../../../../server/queue/queues'
import { checkIpPreflightRateLimit, checkRouteRateLimit, getClientIp } from '@/lib/api/rate-limit'
import type { PaperLang, WritingStyle } from '@/lib/openai/promptPipeline'
import type { NormalizedMessage } from '@/types/conversation'
import crypto from 'crypto'

class QuotaExceededError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'QuotaExceededError'
  }
}

export async function POST(req: NextRequest) {
  try {
    const preflight = await checkIpPreflightRateLimit(req)
    if (!preflight.ok) return err('RATE_LIMITED', preflight.message, 429)

    const clientIp = getClientIp(req)
    const cookieGuestKey = req.cookies.get('chatpaper_guest')?.value ?? `anonymous:${clientIp}`
    const rate = await checkRouteRateLimit('analyze', clientIp, cookieGuestKey)
    if (!rate.ok) return err('RATE_LIMITED', rate.message, 429)

    const guest = await getOrCreateGuestUser()

    const body = await req.json().catch(() => null)
    if (!body?.uploadId) return ERRORS.VALIDATION('uploadId required')

    const { uploadId, lang: langOverride, style = 'communication_analysis' } = body as {
      uploadId: string
      lang?: PaperLang
      style?: WritingStyle
    }

    // 1. Load + verify ownership
    const upload = await prisma.upload.findUnique({
      where: { id: uploadId },
      include: { parsedMessages: { orderBy: { timestamp: 'asc' } } },
    })
    if (!upload) return ERRORS.NOT_FOUND('업로드를 찾을 수 없습니다')
    if (upload.userId !== guest.userId) return ERRORS.FORBIDDEN()
    if (!upload.parsedMessages.length) return ERRORS.VALIDATION('파싱된 메시지가 없습니다')

    // 2. Language detection (done before DB writes so we don't create orphans on error)
    const cleanMessages: NormalizedMessage[] = anonymizeMessages(
      upload.parsedMessages.map((m) => ({
        id: m.id,
        speakerId: m.speakerId,
        text: m.text,
        timestamp: m.timestamp,
      })),
    ).map((m) => ({
      id: m.id,
      speakerId: m.speakerId,
      timestamp: m.timestamp.toISOString(),
      text: m.text,
    }))

    const detection = detectFromMessages(cleanMessages)
    const lang: PaperLang = langOverride ?? (detection.dominant as PaperLang | null) ?? 'ko'

    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${uploadId}:${style}:${lang}`)
      .digest('hex')

    // 3. Atomic idempotent creation: create Job first (unique on idempotencyKey),
    //    then create Paper only if Job creation succeeded.
    //    On P2002 conflict, return the existing job without creating another Paper.
    let job: { id: string; paperId: string | null; status: string }
    let paper: { id: string }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const dayStart = new Date()
        dayStart.setHours(0, 0, 0, 0)
        const [concurrent, daily] = await Promise.all([
          tx.job.count({ where: { userId: guest.userId, status: { in: ['PENDING', 'PROCESSING'] } } }),
          tx.job.count({ where: { userId: guest.userId, enqueuedAt: { gte: dayStart } } }),
        ])
        if (concurrent >= 2)
          throw new QuotaExceededError('이미 처리 중인 논문이 있습니다. 완료 후 다시 시도해 주세요.')
        if (daily >= 10)
          throw new QuotaExceededError('오늘의 논문 생성 한도에 도달했습니다. 내일 다시 시도해 주세요.')

        const newPaper = await tx.paper.create({
          data: {
            userId: guest.userId,
            uploadId,
            language: lang.toUpperCase() as 'KO' | 'EN' | 'JA',
            writingStyle: style.toUpperCase() as never,
            status: 'PROCESSING',
          },
        })
        const newJob = await tx.job.create({
          data: {
            userId: guest.userId,
            uploadId,
            paperId: newPaper.id,
            idempotencyKey,
            status: 'PENDING',
            metadata: { lang, style, messageCount: cleanMessages.length } as Prisma.InputJsonValue,
          },
        })
        return { job: newJob, paper: newPaper }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 })
      job = result.job
      paper = result.paper
    } catch (txError) {
      if (txError instanceof QuotaExceededError) {
        return err('QUOTA_EXCEEDED', txError.message, 429)
      }
      // P2034 = serialization failure — concurrent transaction conflict
      if (
        txError instanceof Prisma.PrismaClientKnownRequestError &&
        txError.code === 'P2034'
      ) {
        return err('CONFLICT', '요청이 충돌했습니다. 잠시 후 다시 시도해 주세요.', 409)
      }
      // P2002 = unique constraint on idempotencyKey — concurrent duplicate request
      if (
        txError instanceof Prisma.PrismaClientKnownRequestError &&
        txError.code === 'P2002'
      ) {
        const existing = await prisma.job.findUnique({
          where: { idempotencyKey },
          select: { id: true, paperId: true, status: true },
        })
        if (!existing) throw txError // unexpected — rethrow
        const response = ok({
          jobId: existing.id,
          paperId: existing.paperId,
          status: existing.status,
          reused: true,
        })
        setGuestCookie(response, guest.guestKey)
        return response
      }
      throw txError
    }

    // 4. Enqueue — on Redis failure, atomically mark both FAILED
    try {
      await enqueuePaperJob(
        {
          jobId: job.id,
          uploadId,
          paperId: paper.id,
          userId: guest.userId,
          language: lang,
          writingStyle: style,
        },
        idempotencyKey,
      )
    } catch (enqueueError) {
      await prisma.$transaction(async (tx) => {
        await tx.job.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: 'Queue unavailable', failedAt: new Date() },
        })
        await tx.paper.update({
          where: { id: paper.id },
          data: { status: 'FAILED' },
        })
      }, { maxWait: 5_000, timeout: 30_000 })
      console.error('[analyze] enqueue failed:', enqueueError)
      return ERRORS.INTERNAL('큐 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.')
    }

    const response = ok({
      jobId: job.id,
      paperId: paper.id,
      lang,
      style,
      status: 'PENDING',
      reused: false,
      detectedScores: detection.scores,
      isMixed: detection.isMixed,
    })

    setGuestCookie(response, guest.guestKey)
    return response
  } catch (error) {
    console.error('[analyze] unhandled error:', error)
    return ERRORS.INTERNAL(
      error instanceof Error ? error.message : '분석 처리 중 오류가 발생했습니다',
    )
  }
}
