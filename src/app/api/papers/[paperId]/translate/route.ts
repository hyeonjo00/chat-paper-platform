import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { ok, ERRORS } from '@/lib/api/response'
import { getGuestUser } from '@/lib/auth/guest-user'
import { translatePaper, translateRelationship, type AffectionScore } from '@/lib/openai/translate'
import type { PaperLang } from '@/lib/openai/promptPipeline'

const VALID_LANGS: PaperLang[] = ['ko', 'en', 'ja']
type LangEnum = 'KO' | 'EN' | 'JA'

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
        relationshipType: true,
        relationshipIssues: true,
        affectionScores: true,
      },
    })
    if (!paper) return ERRORS.NOT_FOUND('논문을 찾을 수 없습니다')

    const paperLang = paper.language.toLowerCase() as PaperLang
    const langEnum = targetLang.toUpperCase() as LangEnum

    // Same language as original — return original directly
    if (paperLang === targetLang) {
      const { language: _l, ...rest } = paper
      return ok({ language: targetLang, ...rest, cached: true })
    }

    // Check cache
    const cached = await prisma.paperTranslation.findUnique({
      where: { paperId_language: { paperId: paper.id, language: langEnum } },
    })
    if (cached) {
      const { language: _l, paperId: _p, id: _i, createdAt: _c, ...rest } = cached
      return ok({ language: targetLang, ...rest, cached: true })
    }

    // Translate sections and relationship data in parallel
    const [translatedSections, translatedRel] = await Promise.all([
      translatePaper(
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
      ),
      translateRelationship(
        {
          relationshipType: paper.relationshipType,
          relationshipIssues: paper.relationshipIssues,
          affectionScores: paper.affectionScores as AffectionScore[] | null,
        },
        targetLang,
      ),
    ])

    const data = { ...translatedSections, ...translatedRel }

    // Upsert cache — affectionScores null must use Prisma.JsonNull
    const upsertData = {
      ...data,
      affectionScores: data.affectionScores
        ? (data.affectionScores as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    }

    await prisma.paperTranslation.upsert({
      where: { paperId_language: { paperId: paper.id, language: langEnum } },
      create: { paperId: paper.id, language: langEnum, ...upsertData },
      update: upsertData,
    })

    return ok({ language: targetLang, ...data, cached: false })
  } catch (error) {
    console.error('[translate] error:', error)
    return ERRORS.INTERNAL(
      error instanceof Error ? error.message : '번역 중 오류가 발생했습니다',
    )
  }
}
