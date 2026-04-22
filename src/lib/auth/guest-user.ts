import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

const GUEST_COOKIE = 'chatpaper_guest'
const GUEST_DOMAIN = 'guest.chatpaper.local'
const GUEST_NAME = 'Guest'
const GUEST_MAX_AGE = 60 * 60 * 24 * 30

function guestEmail(key: string) {
  return `${key}@${GUEST_DOMAIN}`
}

function readGuestKey(): string | undefined {
  return cookies().get(GUEST_COOKIE)?.value
}

// Use in POST routes — creates user if missing
export async function getOrCreateGuestUser() {
  const existingKey = readGuestKey()
  const guestKey = existingKey ?? crypto.randomUUID()
  const email = guestEmail(guestKey)

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: GUEST_NAME },
    select: { id: true },
  })

  return { userId: user.id, guestKey }
}

// Use in GET routes — never creates users; returns null if no session
export async function getExistingGuestUser(): Promise<{ userId: string; guestKey: string } | null> {
  const guestKey = readGuestKey()
  if (!guestKey) return null

  const user = await prisma.user.findUnique({
    where: { email: guestEmail(guestKey) },
    select: { id: true },
  })
  if (!user) return null

  return { userId: user.id, guestKey }
}

// Back-compat alias — existing POST routes that haven't been migrated yet
export async function getGuestUser() {
  return getOrCreateGuestUser()
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
