import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextRequest, NextResponse } from 'next/server'
import { checkIpPreflightRateLimit, checkRouteRateLimit, getClientIp } from '@/lib/api/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const preflight = await checkIpPreflightRateLimit(req)
    if (!preflight.ok) return NextResponse.json({ error: preflight.message }, { status: 429 })

    const clientIp = getClientIp(req)
    const cookieGuestKey = req.cookies.get('chatpaper_guest')?.value ?? `anonymous:${clientIp}`
    const rate = await checkRouteRateLimit('upload', clientIp, cookieGuestKey)
    if (!rate.ok) return NextResponse.json({ error: rate.message }, { status: 429 })

    const body = (await req.json()) as HandleUploadBody

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        access: 'private',
        allowedContentTypes: [
          'text/plain',
          'text/html',
          'application/json',
          'application/zip',
          'application/x-zip-compressed',
          'text/markdown',
          'application/octet-stream',
        ],
        maximumSizeInBytes: 50 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {},
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '토큰 생성에 실패했습니다' },
      { status: 400 },
    )
  }
}
