import { PrismaClient } from '@prisma/client'

let _prisma: PrismaClient | null = null

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    })
  }
  return _prisma
}
