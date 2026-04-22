import { NextRequest } from 'next/server'
import { ok, ERRORS } from '@/lib/api/response'
import { getExistingGuestUser } from '@/lib/auth/guest-user'
import { prisma } from '@/lib/db/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  try {
    const guest = await getExistingGuestUser()
    if (!guest) return ERRORS.UNAUTHORIZED()

    const job = await prisma.job.findUnique({
      where: { id: params.jobId },
      select: { userId: true, paperId: true, status: true },
    })

    if (!job) return ERRORS.NOT_FOUND('Job not found')
    if (job.userId !== guest.userId) return ERRORS.FORBIDDEN()

    if (job.status !== 'COMPLETED' || !job.paperId) {
      return ERRORS.VALIDATION(`Job is not complete (status=${job.status})`)
    }

    const paper = await prisma.paper.findUnique({
      where: { id: job.paperId },
      select: {
        id: true,
        language: true,
        writingStyle: true,
        status: true,
        title: true,
        abstract: true,
        introduction: true,
        relatedWork: true,
        methods: true,
        results: true,
        discussion: true,
        conclusion: true,
        references: true,
        appendix: true,
        relationshipType: true,
        relationshipIssues: true,
        affectionScores: true,
        generatedAt: true,
        createdAt: true,
      },
    })

    if (!paper) return ERRORS.NOT_FOUND('Paper not found')

    return ok({ paper })
  } catch (error) {
    return ERRORS.INTERNAL(
      error instanceof Error ? error.message : 'Failed to fetch result',
    )
  }
}
