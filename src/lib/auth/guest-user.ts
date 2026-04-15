import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

const GUEST_COOKIE = 'chatpaper_guest'
const GUEST_DOMAIN = 'guest.chatpaper.local'
const GUEST_NAME = 'Guest'
const GUEST_MAX_AGE = 60 * 60 * 24 * 30

export async function getGuestUser() {
  const cookieStore = cookies()
  const existingGuestKey = cookieStore.get(GUEST_COOKIE)?.value
  const guestKey = existingGuestKey || crypto.randomUUID()
  const email = `${guestKey}@${GUEST_DOMAIN}`

  const user = await prisma.user.upsert({
    where: { email },
    update: { name: GUEST_NAME },
    create: { email, name: GUEST_NAME },
    select: { id: true },
  })

  return {
    userId: user.id,
    guestKey,
  }
}

export function setGuestCookie(response: NextResponse, guestKey: string) {
  response.cookies.set(GUEST_COOKIE, guestKey, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUEST_MAX_AGE,
  })
}
