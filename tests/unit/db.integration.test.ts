import { afterAll, describe, expect, it, vi } from 'vitest';
import { offer, seg } from '../support/fixtures';

// Runs only when TEST_DATABASE_URL points to a migrated PostgreSQL database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgreSQL offer cache (Prisma)', () => {
  afterAll(() => vi.unstubAllEnvs());

  it('stores, returns and expires provider responses', async () => {
    vi.stubEnv('DATABASE_URL', url!);
    vi.resetModules();
    const { PrismaOfferCache } = await import('@/lib/server/db-stores');
    const { getPrisma, databaseHealthy } = await import('@/lib/server/db');
    expect(await databaseHealthy()).toBe(true);
    const cache = new PrismaOfferCache();
    const key = `test:${Date.now()}`;
    const o = { ...offer('db-1', [[seg('MXP', 'BCN', '2026-12-11T08:00', 100)]], { price: 42 }), expiresAt: Date.now() + 60_000 };
    await cache.set(key, [o], 30);
    const back = await cache.get(key);
    expect(back?.[0].price.total).toEqual({ amount: 4200, currency: 'EUR' });
    await getPrisma()!.providerCacheEntry.update({ where: { key }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await cache.get(key)).toBeUndefined();
    await getPrisma()!.providerCacheEntry.delete({ where: { key } });
    await getPrisma()!.$disconnect();
  });
});
