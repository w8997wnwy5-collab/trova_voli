import type { FareOffer } from '@/lib/domain/types';

export interface OfferCache {
  get(key: string): Promise<FareOffer[] | undefined>;
  set(key: string, offers: FareOffer[], ttlSeconds: number): Promise<void>;
}

/** Bounded in-memory TTL cache (per server instance). */
export class MemoryOfferCache implements OfferCache {
  private readonly entries = new Map<string, { offers: FareOffer[]; expiresAt: number }>();

  constructor(private readonly maxEntries = 3000) {}

  async get(key: string): Promise<FareOffer[] | undefined> {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // LRU: re-insert to mark as recently used.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.offers;
  }

  async set(key: string, offers: FareOffer[], ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    // Never keep an offer beyond its own expiry.
    const offerExpiry = Math.min(...offers.map((o) => o.expiresAt ?? Number.POSITIVE_INFINITY));
    const expiresAt = Math.min(Date.now() + ttlSeconds * 1000, offerExpiry);
    if (expiresAt <= Date.now()) return;
    this.entries.set(key, { offers, expiresAt });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Memory first, then a shared store (e.g. PostgreSQL) when configured. */
export class TieredOfferCache implements OfferCache {
  constructor(
    private readonly l1: OfferCache,
    private readonly l2: OfferCache,
  ) {}

  async get(key: string): Promise<FareOffer[] | undefined> {
    const local = await this.l1.get(key);
    if (local) return local;
    try {
      return await this.l2.get(key);
    } catch {
      return undefined; // a cache outage must never fail a search
    }
  }

  async set(key: string, offers: FareOffer[], ttlSeconds: number): Promise<void> {
    await this.l1.set(key, offers, ttlSeconds);
    try {
      await this.l2.set(key, offers, ttlSeconds);
    } catch {
      /* ignore shared-cache failures */
    }
  }
}
