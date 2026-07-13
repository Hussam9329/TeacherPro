import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  })

// Performance: always cache the PrismaClient on globalThis, including in
// production. Previously this was gated to non-production only, which meant
// every Vercel Serverless cold start created a new PrismaClient (~200ms
// overhead for connection setup). By reusing the client across warm Lambda
// invocations, cold starts skip the connection setup step.
//
// This is safe because:
// 1. DATABASE_URL uses Neon's Pooler endpoint which manages connection limits.
// 2. Prisma 6+ handles connection pooling internally with sensible defaults.
// 3. The globalThis pattern is the official Prisma recommendation for
//    serverless environments: https://pris.ly/d/serverless-best-practices
globalForPrisma.prisma = db