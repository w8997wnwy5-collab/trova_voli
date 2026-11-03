import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { config } from './config';

type Client = InstanceType<typeof PrismaClient>;
const globalForPrisma = globalThis as unknown as { flightHackerPrisma?: Client };

/** Prisma client when DATABASE_URL is configured; undefined otherwise (in-memory fallbacks apply). */
export function getPrisma(): Client | undefined {
  const url = config().DATABASE_URL;
  if (!url) return undefined;
  if (!globalForPrisma.flightHackerPrisma) {
    globalForPrisma.flightHackerPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  return globalForPrisma.flightHackerPrisma;
}

export async function databaseHealthy(): Promise<boolean | null> {
  const prisma = getPrisma();
  if (!prisma) return null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
