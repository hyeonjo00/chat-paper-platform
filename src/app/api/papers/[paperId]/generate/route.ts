import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { ok, ERRORS } from '@/lib/api/response'
import { getGuestUser, setGuestCookie } from '@/lib/auth/guest-user'
import { anonymizeMessages } from '@/lib/privacy/anonymizer'
import { detectFromMessages } from '@/lib/nlp/languageDetector'
import { generatePaper } from '@/lib/services/paperGenerator'
import type { PaperLang } from '@/lib/openai/promptPipeline'
import type { NormalizedMessage } from '@/types/conversation'

export const maxDuration = 300 // Vercel Pro: up to 5 min

export async function POST(
  req: NextRequest,
  { params }: { params: { paperId: string } }
) {
  try {
    const guest = await getGuestUser()

    const paper = await prisma.paper.findUnique({
      where: { id: params.paperId },
      include: {
        upload: {
          include: { parsedMessages: { orderBy: { timestamp: 'asc' } } },
        },
      },
    })

    if (!paper) return ERRORS.NOT_FOUND('논문을 찾을 수 없습니다')
    if (paper.userId !== guest.userId) return ERRORS.FORBIDDEN()
    if (paper.status !== 'PROCESSING') {
      return ERRORS.VALIDATION(`이미 처리된 논문입니다 (status: ${paper.status})`)
    }
    if (!paper.upload.parsedMessages.length) {
      await prisma.paper.update({
        where: { id: params.paperId },
        data: { status: 'FAILED' },
      })
      return ERRORS.VALIDATION('파싱된 메시지가 없습니다')
    }

    // Anonymise messages
    const rawMessages = paper.upload.parsedMessages.map(m => ({
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

    const lang = paper.language.toLowerCase() as PaperLang
    const style = paper.writingStyle.toLowerCase() as never

    // Re-detect language for consistency (already stored on paper, but needed for generator)
    detectFromMessages(normalised) // side-effect free; result already stored in paper.language

    // Generate paper sections
    let generated
    try {
      generated = await generatePaper({ messages: normalised, lang, style })
    } catch (genError) {
      console.error('[generate] OpenAI error:', genError)
      await prisma.paper.update({
        where: { id: params.paperId },
        data: { status: 'FAILED' },
      })
      return ERRORS.INTERNAL(
        genError instanceof Error ? genError.message : '논문 생성 중 오류가 발생했습니다'
      )
    }

    // Persist sections and mark COMPLETED
    const updated = await prisma.paper.update({
      where: { id: params.paperId },
      data: {
        status: 'COMPLETED',
        title:        generated.title,
        abstract:     generated.abstract,
        introduction: generated.introduction,
        methods:      generated.methods,
        results:      generated.results,
        discussion:   generated.discussion,
        conclusion:   generated.conclusion,
        generatedAt:  new Date(),
      },
    })

    const response = ok({
      paperId: updated.id,
      status: 'COMPLETED',
      sections: ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'],
    })

    setGuestCookie(response, guest.guestKey)
    return response
  } catch (error) {
    console.error('[generate] unhandled error:', error)
    // Attempt to mark as FAILED
    try {
      await prisma.paper.update({
        where: { id: params.paperId },
        data: { status: 'FAILED' },
      })
    } catch {
      // ignore secondary failure
    }
    return ERRORS.INTERNAL(
      error instanceof Error ? error.message : '논문 생성 중 오류가 발생했습니다'
    )
  }
}
