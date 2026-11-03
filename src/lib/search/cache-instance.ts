import 'server-only';
import { config } from '@/lib/server/config';
import { MemoryOfferCache, TieredOfferCache, type OfferCache } from './cache';
import { PrismaOfferCache } from '@/lib/server/db-stores';

let instance: OfferCache | undefined;

/** Process-wide offer cache: memory, plus PostgreSQL when DATABASE_URL is configured. */
export function getOfferCache(): OfferCache {
  if (!instance) {
    const memory = new MemoryOfferCache();
    instance = config().DATABASE_URL ? new TieredOfferCache(memory, new PrismaOfferCache()) : memory;
  }
  return instance;
}
