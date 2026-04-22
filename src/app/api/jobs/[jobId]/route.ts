import { NextRequest } from 'next/server'
import { ok, ERRORS } from '@/lib/api/response'
import { getExistingGuestUser } from '@/lib/auth/guest-user'
import { getJobStatus } from '../../../../../server/services/jobService'

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  try {
    const guest = await getExistingGuestUser()
    if (!guest) return ERRORS.UNAUTHORIZED()

    const job = await getJobStatus(params.jobId)
    if (!job) return ERRORS.NOT_FOUND('Job not found')
    if (job.userId !== guest.userId) return ERRORS.FORBIDDEN()

    return ok({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      paperId: job.paperId,
      error: job.errorMessage ?? null,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      enqueuedAt: job.enqueuedAt,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      failedAt: job.failedAt ?? null,
    })
  } catch (error) {
    return ERRORS.INTERNAL(
      error instanceof Error ? error.message : 'Failed to fetch job status',
    )
  }
}
