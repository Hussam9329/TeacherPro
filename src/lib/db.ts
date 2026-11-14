import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// The schema uses engineType "client", so Prisma talks to Postgres through the
// `pg` driver given here instead of its native query engine.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
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
// 2. The `pg` pool inside PrismaPg reuses connections between invocations.
// 3. The globalThis pattern is the official Prisma recommendation for
//    serverless environments: https://pris.ly/d/serverless-best-practices
globalForPrisma.prisma = db