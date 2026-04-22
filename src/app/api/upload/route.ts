import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { ok, ERRORS } from '@/lib/api/response'
import { getGuestUser, setGuestCookie } from '@/lib/auth/guest-user'
import { parseKakaoTalk } from '@/lib/parsers/kakaotalk'
import { parseAiConversation } from '@/lib/parsers/aiConversation'
import { parseInstagramDM } from '@/lib/parsers/instagram'
import { parseLINE } from '@/lib/parsers/line'
import { anonymizeMessages } from '@/lib/privacy/anonymizer'
import JSZip from 'jszip'

const MAX_BYTES = 50 * 1024 * 1024          // 50 MB
const MAX_ZIP_EXTRACT_BYTES = 100 * 1024 * 1024 // 100 MB uncompressed
const ALLOWED_EXT = new Set(['.txt', '.md', '.json', '.html', '.zip'])

function ext(name: string) {
  return name.slice(name.lastIndexOf('.')).toLowerCase()
}

type ResolvedUploadType = 'KAKAO' | 'AI_CONVERSATION' | 'INSTAGRAM' | 'LINE'

function detectUploadType(filename: string, content: string): ResolvedUploadType {
  if (/\d{4}년 \d{1,2}월 \d{1,2}일/.test(content)) return 'KAKAO'
  if (ext(filename) === '.html' || ext(filename) === '.htm') return 'INSTAGRAM'
  if (ext(filename) === '.json') {
    if (content.includes('"timestamp_ms"') && content.includes('"sender_name"')) return 'INSTAGRAM'
    return 'AI_CONVERSATION'
  }
  if (/^\d{1,2}:\d{2}\t.+\t/m.test(content)) return 'LINE'
  if (/^\*{0,2}(Human|User|Assistant|Claude)/im.test(content)) return 'AI_CONVERSATION'
  return 'KAKAO'
}

export async function POST(req: NextRequest) {
  try {
    const guest = await getGuestUser()

    const formData = await req.formData().catch(() => null)
    if (!formData) return ERRORS.VALIDATION('multipart/form-data required')

    const file = formData.get('file') as File | null
    const uploadType = (formData.get('type') as string | null)?.toUpperCase()

    if (!file) return ERRORS.VALIDATION('file is required')
    if (file.size > MAX_BYTES) return ERRORS.VALIDATION('파일 크기는 50MB 이하여야 합니다')
    if (!ALLOWED_EXT.has(ext(file.name))) return ERRORS.VALIDATION('.txt .md .json .html .zip 파일만 지원합니다')

    // ZIP 파일이면 내부 .txt 추출 (카카오톡 내보내기 구조)
    let rawFilename = file.name
    let raw: string
    if (ext(file.name) === '.zip') {
      const zip = await JSZip.loadAsync(await file.arrayBuffer())
      const CHAT_EXTS = ['.txt', '.json', '.html', '.htm']
      const chatFiles = Object.values(zip.files).filter(
        f => !f.dir && CHAT_EXTS.some(e => f.name.toLowerCase().endsWith(e))
      )
      if (chatFiles.length === 0) return ERRORS.VALIDATION('ZIP 내부에 대화 파일(.txt .json .html)이 없습니다.')
      // 가장 큰 파일 선택 (카카오톡·인스타 내보내기 모두 대응)
      const target = chatFiles.reduce((a, b) => ((a as any)._data?.uncompressedSize ?? 0) >= ((b as any)._data?.uncompressedSize ?? 0) ? a : b)
      const uncompressedSize: number = (target as any)._data?.uncompressedSize ?? 0
      if (uncompressedSize > MAX_ZIP_EXTRACT_BYTES) {
        return ERRORS.VALIDATION('압축 해제 후 파일 크기가 100MB를 초과합니다')
      }
      raw = await target.async('string')
      rawFilename = target.name.split('/').pop() ?? target.name
    } else {
      raw = await file.text()
    }

    const resolvedType: ResolvedUploadType =
      uploadType === 'KAKAO' || uploadType === 'AI_CONVERSATION' || uploadType === 'INSTAGRAM' || uploadType === 'LINE'
        ? (uploadType as ResolvedUploadType)
        : detectUploadType(rawFilename, raw)

    // Parse
    let messages: { speakerId: string; text: string; timestamp: Date }[]

    if (resolvedType === 'KAKAO') {
      const parsed = parseKakaoTalk(raw)
      messages = parsed.map(m => ({ speakerId: m.speaker, text: m.text, timestamp: m.timestamp }))
    } else if (resolvedType === 'INSTAGRAM') {
      const parsed = parseInstagramDM(raw, { anonymize: false })
      messages = parsed.messages.map(m => ({
        speakerId: m.speakerId,
        text: m.text,
        timestamp: new Date(m.timestamp),
      }))
    } else if (resolvedType === 'LINE') {
      const parsed = parseLINE(raw, { anonymize: false })
      messages = parsed.messages.map(m => ({
        speakerId: m.speakerId,
        text: m.text,
        timestamp: new Date(m.timestamp),
      }))
    } else {
      const fileExt = ext(rawFilename).replace(/^\./, '')
      const fmt: 'json' | 'markdown' | 'auto' = fileExt === 'json' ? 'json' : fileExt === 'md' ? 'markdown' : 'auto'
      const parsed = parseAiConversation(raw, fmt)
      messages = parsed.map((m, i) => ({
        speakerId: m.role === 'user' ? '사용자' : m.role === 'system' ? '시스템' : 'AI 어시스턴트',
        text: m.text,
        timestamp: m.timestamp ?? new Date(Date.now() + i * 60_000),
      }))
    }

    if (messages.length === 0) return ERRORS.VALIDATION('파싱된 메시지가 없습니다. 파일 형식을 확인해주세요.')

    // Anonymise before storing
    const anonymised = anonymizeMessages(messages)

    // Persist
    const upload = await prisma.upload.create({
      data: {
        userId: guest.userId,
        type: resolvedType,
        originalFilename: file.name,
        storagePath: '',       // file stored in-DB as parsed messages; raw not persisted
        sizeBytes: file.size,
        parseStatus: 'COMPLETED',
        parsedAt: new Date(),
        parsedMessages: {
          createMany: {
            data: anonymised.map(m => ({
              speakerId: m.speakerId,
              text: m.text,
              timestamp: m.timestamp,
            })),
          },
        },
      },
      include: { _count: { select: { parsedMessages: true } } },
    })

    const response = ok({
      uploadId: upload.id,
      type: resolvedType,
      filename: file.name,
      messageCount: upload._count.parsedMessages,
      parseStatus: 'COMPLETED',
    })

    setGuestCookie(response, guest.guestKey)

    return response
  } catch (error) {
    console.error('[upload] unhandled error:', error)
    return ERRORS.INTERNAL(
      error instanceof Error ? error.message : '업로드 처리 중 오류가 발생했습니다'
    )
  }
}
