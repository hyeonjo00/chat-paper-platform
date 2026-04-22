import { NextRequest, NextResponse } from 'next/server'

// This endpoint is permanently removed. All paper generation goes through
// the async queue: POST /api/analyze → poll GET /api/jobs/:jobId → GET /api/results/:jobId
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { ok: false, error: { code: 'GONE', message: 'Use POST /api/analyze to start generation' } },
    { status: 410 },
  )
}
