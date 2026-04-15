import { NextResponse } from 'next/server'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status })
}

export function err(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

export const ERRORS = {
  UNAUTHORIZED: () => err('UNAUTHORIZED', '로그인이 필요합니다', 401),
  FORBIDDEN: () => err('FORBIDDEN', '접근 권한이 없습니다', 403),
  NOT_FOUND: (r = '리소스를 찾을 수 없습니다') => err('NOT_FOUND', r, 404),
  VALIDATION: (msg: string) => err('VALIDATION_ERROR', msg, 422),
  INTERNAL: (msg = '서버 오류가 발생했습니다') => err('INTERNAL_ERROR', msg, 500),
}
