import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { ok, err, ERRORS } from '@/lib/api/response'
import { getGuestUser } from '@/lib/auth/guest-user'
import { translatePaper } from '@/lib/openai/translate'
import type { PaperLang } from '@/lib/openai/promptPipeline'

const VALID_LANGS: PaperLang[] = ['ko', 'en', 'ja']

type RouteContext = { params: { paperId: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const guest = await getGuestUser()

    const body = await req.json().catch(() => null)
    const targetLang: PaperLang = body?.targetLang
    if (!VALID_LANGS.includes(targetLang)) {
      return ERRORS.VALIDATION('targetLang must be ko, en, or ja')
    }

    const paper = await prisma.paper.findFirst({
      where: { id: params.paperId, userId: guest.userId },
      select: {
        id: true,
        language: true,
        title: true,
        abstract: true,
        introduction: true,
        methods: true,
        results: true,
        discussion: true,
        conclusion: true,
      },
    })
    if (!paper) return ERRORS.NOT_FOUND('논문을 찾을 수 없습니다')

    const paperLang = paper.language.toLowerCase() as PaperLang
    // Same language as original — return original sections directly
    if (paperLang === targetLang) {
      return ok({
        language: targetLang,
        title: paper.title,
        abstract: paper.abstract,
        introduction: paper.introduction,
        methods: paper.methods,
        results: paper.results,
        discussion: paper.discussion,
        conclusion: paper.conclusion,
        cached: true,
      })
    }

    // Check cache
    const cached = await prisma.paperTranslation.findUnique({
      where: { paperId_language: { paperId: paper.id, language: targetLang.toUpperCase() as 'KO' | 'EN' | 'JA' } },
    })
    if (cached) {
      return ok({
        language: targetLang,
        title: cached.title,
        abstract: cached.abstract,
        introduction: cached.introduction,
        methods: cached.methods,
        results: cached.results,
        discussion: cached.discussion,
        conclusion: cached.conclusion,
        cached: true,
      })
    }

    // Translate
    const translated = await translatePaper(
      {
        title: paper.title,
        abstract: paper.abstract,
        introduction: paper.introduction,
        methods: paper.methods,
        results: paper.results,
        discussion: paper.discussion,
        conclusion: paper.conclusion,
      },
      targetLang,
    )

    // Upsert cache
    await prisma.paperTranslation.upsert({
      where: { paperId_language: { paperId: paper.id, language: targetLang.toUpperCase() as 'KO' | 'EN' | 'JA' } },
      create: {
        paperId: paper.id,
        language: targetLang.toUpperCase() as 'KO' | 'EN' | 'JA',
        ...translated,
      },
      update: translated,
    })

    return ok({
      language: targetLang,
      ...translated,
      cached: false,
    })
  } catch (error) {
    console.error('[translate] error:', error)
    return ERRORS.INTERNAL(
      error instanceof Error ? error.message : '번역 중 오류가 발생했습니다',
    )
  }
}
