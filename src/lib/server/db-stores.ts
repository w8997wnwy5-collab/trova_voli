import 'server-only';
import type { FareOffer } from '@/lib/domain/types';
import type { OfferCache } from '@/lib/search/cache';
import { getPrisma } from './db';

/** Shared provider-response cache in PostgreSQL; respects provider TTLs and offer expiry. */
export class PrismaOfferCache implements OfferCache {
  async get(key: string): Promise<FareOffer[] | undefined> {
    const prisma = getPrisma();
    if (!prisma) return undefined;
    const row = await prisma.providerCacheEntry.findUnique({ where: { key } });
    if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
    return row.offers as unknown as FareOffer[];
  }

  async set(key: string, offers: FareOffer[], ttlSeconds: number): Promise<void> {
    const prisma = getPrisma();
    if (!prisma || ttlSeconds <= 0) return;
    const offerExpiry = Math.min(...offers.map((o) => o.expiresAt ?? Number.POSITIVE_INFINITY));
    const expiresAt = new Date(Math.min(Date.now() + ttlSeconds * 1000, offerExpiry));
    if (expiresAt.getTime() <= Date.now()) return;
    const provider = key.split(':')[0];
    const data = { provider, offers: offers as unknown as object, expiresAt };
    await prisma.providerCacheEntry.upsert({ where: { key }, create: { key, ...data }, update: data });
    // Opportunistic cleanup keeps the table small without a scheduler.
    if (Math.random() < 0.02) await prisma.providerCacheEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
