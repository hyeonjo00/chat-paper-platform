import { NextRequest } from 'next/server'
import { del } from '@vercel/blob'
import { prisma } from '@/lib/db/prisma'
import { ok, err, ERRORS } from '@/lib/api/response'
import { getGuestUser, setGuestCookie } from '@/lib/auth/guest-user'
import { parseKakaoTalk } from '@/lib/parsers/kakaotalk'
import { parseAiConversation } from '@/lib/parsers/aiConversation'
import { parseInstagramDM } from '@/lib/parsers/instagram'
import { parseLINE } from '@/lib/parsers/line'
import { anonymizeMessages } from '@/lib/privacy/anonymizer'
import { checkIpPreflightRateLimit, checkRouteRateLimit, checkUploadQuota, getClientIp } from '@/lib/api/rate-limit'
import JSZip from 'jszip'

const MAX_BYTES = 50 * 1024 * 1024
const MAX_ZIP_EXTRACT_BYTES = 100 * 1024 * 1024
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024
const MAX_ZIP_ENTRIES = 500

type ResolvedUploadType = 'KAKAO' | 'AI_CONVERSATION' | 'INSTAGRAM' | 'LINE'

interface ZipEntrySizes {
  compressedSize: number
  uncompressedSize: number
}

class UploadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadValidationError'
  }
}

function ext(name: string) {
  return name.slice(name.lastIndexOf('.')).toLowerCase()
}

function readZipEntrySizes(entry: JSZip.JSZipObject): ZipEntrySizes | null {
  const data = (entry as unknown as { _data?: Partial<ZipEntrySizes> })._data
  const compressedSize = data?.compressedSize
  const uncompressedSize = data?.uncompressedSize

  if (
    typeof compressedSize !== 'number' ||
    typeof uncompressedSize !== 'number' ||
    !Number.isSafeInteger(compressedSize) ||
    !Number.isSafeInteger(uncompressedSize) ||
    compressedSize < 0 ||
    uncompressedSize < 0
  ) {
    return null
  }

  return { compressedSize, uncompressedSize }
}

function detectUploadType(filename: string, content: string): ResolvedUploadType {
  const fileExt = ext(filename)

  if (fileExt === '.html' || fileExt === '.htm') return 'INSTAGRAM'
  if (fileExt === '.json') {
    if (content.includes('"timestamp_ms"') && content.includes('"sender_name"')) return 'INSTAGRAM'
    return 'AI_CONVERSATION'
  }
  if (/^\d{1,2}:\d{2}\t.+\t/m.test(content)) return 'LINE'
  if (/^\*{0,2}(Human|User|Assistant|Claude)/im.test(content)) return 'AI_CONVERSATION'
  if (/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/.test(content)) return 'KAKAO'

  return 'KAKAO'
}

async function extractZipFromBuffer(buffer: Buffer): Promise<{ filename: string; raw: string }> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new UploadValidationError('ZIP 파일을 읽을 수 없습니다')
  }

  const allEntries = Object.values(zip.files).filter((entry) => !entry.dir)

  if (allEntries.length === 0) throw new UploadValidationError('ZIP 파일이 비어 있습니다')
  if (allEntries.length > MAX_ZIP_ENTRIES) {
    throw new UploadValidationError(`ZIP 파일 항목은 최대 ${MAX_ZIP_ENTRIES}개까지 지원합니다`)
  }

  const sizes = new Map<JSZip.JSZipObject, ZipEntrySizes>()
  let totalUncompressed = 0

  for (const entry of allEntries) {
    const entrySize = readZipEntrySizes(entry)
    if (!entrySize) throw new UploadValidationError('ZIP 파일 메타데이터를 신뢰할 수 없습니다')
    if (entrySize.uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new UploadValidationError('ZIP 내부 파일 하나의 크기는 50MB 이하여야 합니다')
    }
    totalUncompressed += entrySize.uncompressedSize
    if (totalUncompressed > MAX_ZIP_EXTRACT_BYTES) {
      throw new UploadValidationError('ZIP 압축 해제 후 전체 크기가 100MB를 초과합니다')
    }
    sizes.set(entry, entrySize)
  }

  const chatExts = ['.txt', '.json', '.html', '.htm']
  const chatFiles = allEntries.filter((entry) =>
    chatExts.some((chatExt) => entry.name.toLowerCase().endsWith(chatExt)),
  )
  if (chatFiles.length === 0) {
    throw new UploadValidationError('ZIP 안에 대화 파일(.txt .json .html)이 없습니다')
  }

  // Instagram multi-part JSON merge (message_1.json, message_2.json, ...)
  const jsonFiles = chatFiles.filter((e) => e.name.toLowerCase().endsWith('.json'))
  if (jsonFiles.length > 1) {
    const texts = await Promise.all(jsonFiles.map((e) => e.async('string').catch(() => '')))
    const igTexts = texts.filter(
      (t) => t.includes('"timestamp_ms"') && t.includes('"sender_name"'),
    )
    if (igTexts.length > 0) {
      try {
        const merged = igTexts.reduce<{ participants: unknown[]; messages: unknown[] }>(
          (acc, t) => {
            const parsed = JSON.parse(t)
            if (!acc.participants.length && parsed.participants) acc.participants = parsed.participants
            if (Array.isArray(parsed.messages)) acc.messages.push(...parsed.messages)
            return acc
          },
          { participants: [], messages: [] },
        )
        return { filename: 'instagram_messages.json', raw: JSON.stringify(merged) }
      } catch {
        // fall through to largest-file selection
      }
    }
  }

  const target = chatFiles.reduce((a, b) =>
    sizes.get(a)!.uncompressedSize >= sizes.get(b)!.uncompressedSize ? a : b,
  )

  let raw: string
  try {
    raw = await target.async('string')
  } catch {
    throw new UploadValidationError('ZIP 내부 대화 파일을 읽을 수 없습니다')
  }

  return { filename: target.name.split('/').pop() ?? target.name, raw }
}

export async function POST(req: NextRequest) {
  let blobUrl: string | undefined

  try {
    const preflight = await checkIpPreflightRateLimit(req)
    if (!preflight.ok) return err('RATE_LIMITED', preflight.message, 429)

    const clientIp = getClientIp(req)
    const cookieGuestKey = req.cookies.get('chatpaper_guest')?.value ?? `anonymous:${clientIp}`
    const rate = await checkRouteRateLimit('upload', clientIp, cookieGuestKey)
    if (!rate.ok) return err('RATE_LIMITED', rate.message, 429)

    const guest = await getGuestUser()
    const quota = await checkUploadQuota(guest.userId)
    if (!quota.ok) return err('QUOTA_EXCEEDED', quota.message, 429)

    const body = await req.json().catch(() => null)
    if (!body?.blobUrl || !body?.filename) {
      return ERRORS.VALIDATION('blobUrl과 filename이 필요합니다')
    }

    blobUrl = body.blobUrl as string
    const originalFilename = body.filename as string
    const uploadType = (body.type as string | undefined)?.toUpperCase()

    const blobRes = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    })
    if (!blobRes.ok) throw new UploadValidationError('파일을 읽을 수 없습니다')

    const arrayBuffer = await blobRes.arrayBuffer()
    const sizeBytes = arrayBuffer.byteLength
    if (sizeBytes > MAX_BYTES) throw new UploadValidationError('파일 크기는 50MB 이하여야 합니다')

    let resolvedFilename = originalFilename
    let raw: string

    if (ext(originalFilename) === '.zip') {
      const extracted = await extractZipFromBuffer(Buffer.from(arrayBuffer))
      resolvedFilename = extracted.filename
      raw = extracted.raw
    } else {
      raw = new TextDecoder('utf-8').decode(arrayBuffer).replace(/^\uFEFF/, '')
    }

    const resolvedType: ResolvedUploadType =
      uploadType === 'KAKAO' || uploadType === 'AI_CONVERSATION' || uploadType === 'INSTAGRAM' || uploadType === 'LINE'
        ? (uploadType as ResolvedUploadType)
        : detectUploadType(resolvedFilename, raw)

    let messages: { speakerId: string; text: string; timestamp: Date }[]

    if (resolvedType === 'KAKAO') {
      const parsed = parseKakaoTalk(raw)
      messages = parsed.map((m) => ({ speakerId: m.speaker, text: m.text, timestamp: m.timestamp }))
    } else if (resolvedType === 'INSTAGRAM') {
      const parsed = parseInstagramDM(raw, { anonymize: false })
      messages = parsed.messages.map((m) => ({
        speakerId: m.speakerId,
        text: m.text,
        timestamp: new Date(m.timestamp),
      }))
    } else if (resolvedType === 'LINE') {
      const parsed = parseLINE(raw, { anonymize: false })
      messages = parsed.messages.map((m) => ({
        speakerId: m.speakerId,
        text: m.text,
        timestamp: new Date(m.timestamp),
      }))
    } else {
      const fileExt = ext(resolvedFilename).replace(/^\./, '')
      const fmt: 'json' | 'markdown' | 'auto' =
        fileExt === 'json' ? 'json' : fileExt === 'md' ? 'markdown' : 'auto'
      const parsed = parseAiConversation(raw, fmt)
      messages = parsed.map((m, i) => ({
        speakerId: m.role === 'user' ? '사용자' : m.role === 'system' ? '시스템' : 'AI 어시스턴트',
        text: m.text,
        timestamp: m.timestamp ?? new Date(Date.now() + i * 60_000),
      }))
    }

    if (messages.length === 0) {
      throw new UploadValidationError('파싱된 메시지가 없습니다. 파일 형식을 확인해 주세요.')
    }

    const anonymised = anonymizeMessages(messages)

    const upload = await prisma.upload.create({
      data: {
        userId: guest.userId,
        type: resolvedType,
        originalFilename,
        storagePath: '',
        sizeBytes,
        parseStatus: 'COMPLETED',
        parsedAt: new Date(),
        parsedMessages: {
          createMany: {
            data: anonymised.map((m) => ({
              speakerId: m.speakerId,
              text: m.text,
              timestamp: m.timestamp,
            })),
          },
        },
      },
      include: { _count: { select: { parsedMessages: true } } },
    })

    await del(blobUrl).catch((e) => console.error('[upload] blob delete failed:', e))

    const response = ok({
      uploadId: upload.id,
      type: resolvedType,
      filename: originalFilename,
      messageCount: upload._count.parsedMessages,
      parseStatus: 'COMPLETED',
    })

    setGuestCookie(response, guest.guestKey)
    return response
  } catch (error) {
    if (blobUrl) await del(blobUrl).catch(() => {})

    if (error instanceof UploadValidationError) {
      return ERRORS.VALIDATION(error.message)
    }

    console.error('[upload] unhandled error:', error)
    return ERRORS.INTERNAL(
      error instanceof Error ? error.message : '업로드 처리 중 오류가 발생했습니다',
    )
  }
}
