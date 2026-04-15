import { ok, ERRORS } from '@/lib/api/response'
import { getGuestUser, setGuestCookie } from '@/lib/auth/guest-user'
import { prisma } from '@/lib/db/prisma'

const SCORE_BY_LANGUAGE = {
  KO: { ko: 1, en: 0, ja: 0 },
  EN: { ko: 0, en: 1, ja: 0 },
  JA: { ko: 0, en: 0, ja: 1 },
} as const

const SECTION_KEYS = [
  'title',
  'abstract',
  'introduction',
  'methods',
  'results',
  'discussion',
  'conclusion',
] as const

export async function GET(
  _req: Request,
  { params }: { params: { paperId: string } }
) {
  const guest = await getGuestUser()

  const paper = await prisma.paper.findUnique({
    where: { id: params.paperId },
    select: {
      id: true,
      userId: true,
      language: true,
      writingStyle: true,
      title: true,
      abstract: true,
      introduction: true,
      methods: true,
      results: true,
      discussion: true,
      conclusion: true,
      generatedAt: true,
      createdAt: true,
    },
  })

  if (!paper) return ERRORS.NOT_FOUND('논문을 찾을 수 없습니다')
  if (paper.userId !== guest.userId) return ERRORS.FORBIDDEN()

  const sections = SECTION_KEYS.filter((key) => Boolean(paper[key]))

  const response = ok({
    paperId: paper.id,
    lang: paper.language.toLowerCase(),
    style: paper.writingStyle.toLowerCase(),
    detectedScores: SCORE_BY_LANGUAGE[paper.language],
    isMixed: false,
    sections,
    paper: {
      title: paper.title ?? '',
      abstract: paper.abstract ?? '',
      introduction: paper.introduction ?? '',
      methods: paper.methods ?? '',
      results: paper.results ?? '',
      discussion: paper.discussion ?? '',
      conclusion: paper.conclusion ?? '',
      generatedAt: paper.generatedAt?.toISOString() ?? null,
      createdAt: paper.createdAt.toISOString(),
    },
  })

  setGuestCookie(response, guest.guestKey)

  return response
}
