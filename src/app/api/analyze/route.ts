import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { ok, ERRORS } from '@/lib/api/response'
import { getGuestUser, setGuestCookie } from '@/lib/auth/guest-user'
import { anonymizeMessages } from '@/lib/privacy/anonymizer'
import { detectFromMessages } from '@/lib/nlp/languageDetector'
import { generatePaper } from '@/lib/services/paperGenerator'
import type { PaperLang, WritingStyle } from '@/lib/openai/promptPipeline'
import type { NormalizedMessage } from '@/types/conversation'

export async function POST(req: NextRequest) {
  const guest = await getGuestUser()

  const body = await req.json().catch(() => null)
  if (!body?.uploadId) return ERRORS.VALIDATION('uploadId required')

  const { uploadId, lang: langOverride, style = 'communication_analysis' } = body as {
    uploadId: string
    lang?: PaperLang
    style?: WritingStyle
  }

  // 1. Load parsed messages, verify ownership
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    include: { parsedMessages: { orderBy: { timestamp: 'asc' } } },
  })
  if (!upload) return ERRORS.NOT_FOUND('업로드를 찾을 수 없습니다')
  if (upload.userId !== guest.userId) return ERRORS.FORBIDDEN()
  if (!upload.parsedMessages.length) return ERRORS.VALIDATION('파싱된 메시지가 없습니다')

  // 2. Anonymise (re-run to catch any missed PII from earlier parse)
  const rawMessages = upload.parsedMessages.map(m => ({
    id: m.id,
    speakerId: m.speakerId,
    text: m.text,
    timestamp: m.timestamp,
  }))
  const cleanMessages = anonymizeMessages(rawMessages)

  const normalised: NormalizedMessage[] = cleanMessages.map(m => ({
    id: m.id,
    speakerId: m.speakerId,
    timestamp: m.timestamp.toISOString(),
    text: m.text,
  }))

  // 3. Detect language
  const detection = detectFromMessages(normalised)
  const lang: PaperLang =
    langOverride ??
    (detection.dominant as PaperLang | null) ??
    'ko'

  // 4. Summarise chunks + generate all paper sections
  const paper = await generatePaper({ messages: normalised, lang, style })

  // 5. Persist paper
  const created = await prisma.paper.create({
    data: {
      userId: guest.userId,
      uploadId,
      language: lang.toUpperCase() as 'KO' | 'EN' | 'JA',
      writingStyle: style.toUpperCase() as never,
      status: 'COMPLETED',
      title:        paper.title,
      abstract:     paper.abstract,
      introduction: paper.introduction,
      methods:      paper.methods,
      results:      paper.results,
      discussion:   paper.discussion,
      conclusion:   paper.conclusion,
      generatedAt:  new Date(),
    },
  })

  const response = ok({
    paperId: created.id,
    lang,
    style,
    detectedScores: detection.scores,
    isMixed: detection.isMixed,
    sections: Object.keys(paper),
  })

  setGuestCookie(response, guest.guestKey)

  return response
}
