import { describe, expect, it } from 'vitest';
import type { FareOffer } from '@/lib/domain/types';
import { MemoryOfferCache } from '@/lib/search/cache';
import { runProviderTasks } from '@/lib/search/orchestrator';
import type { PlannedTask } from '@/lib/search/plan';
import { ProviderError, type FlightProvider, type ProviderQuery } from '@/lib/providers/types';
import { offer, seg } from '../support/fixtures';

const NOW = Date.parse('2026-11-03T10:00:00Z');

function task(i: number): PlannedTask {
  const query: ProviderQuery = {
    slices: [{ origin: 'MXP', destination: 'BCN', departureDate: `2026-12-${String(10 + i).padStart(2, '0')}` }],
    passengers: { adults: 1, children: 0, infants: 0 },
    cabin: 'economy',
    currency: 'EUR',
    maxConnections: 1,
  };
  return { key: `t${i}`, kind: 'ow', purpose: 'primary', priority: i, query };
}

function fakeProvider(id: string, behaviour: (q: ProviderQuery, n: number) => Promise<FareOffer[]>, limits: Partial<FlightProvider['limits']> = {}) {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const p: FlightProvider & { stats: () => { maxActive: number; calls: number } } = {
    id,
    name: id,
    capabilities: { oneWay: true, roundTrip: false, multiCity: false, maxSlices: 1, maxConnections: 1, dataQuality: 'live', booking: 'deeplink' },
    limits: { maxConcurrency: 2, maxCallsPerSearch: 100, timeoutMs: 500, cacheTtlSeconds: 60, ...limits },
    async search(q) {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        return await behaviour(q, calls);
      } finally {
        active--;
      }
    },
    stats: () => ({ maxActive, calls }),
  };
  return p;
}

const ok = (id: string) => async (q: ProviderQuery) => {
  await new Promise((r) => setTimeout(r, 10));
  const exp = Date.now() + 3600_000;
  return [{ ...offer(`${id}-${q.slices[0].departureDate}`, [[seg('MXP', 'BCN', `${q.slices[0].departureDate}T08:00`, 100)]], { price: 50 }), expiresAt: exp }];
};

describe('orchestrator', () => {
  it('respects per-provider concurrency and call budgets', async () => {
    const p = fakeProvider('p', ok('p'), { maxConcurrency: 2, maxCallsPerSearch: 4 });
    const tasks = Array.from({ length: 6 }, (_, i) => task(i));
    const res = await runProviderTasks([p], new Map([['p', tasks]]), { cache: new MemoryOfferCache(), requestId: 'r', now: NOW, deadlineMs: 5000 });
    expect(p.stats().maxActive).toBeLessThanOrEqual(2);
    expect(p.stats().calls).toBe(4);
    expect(res.statuses[0]).toMatchObject({ status: 'ok', callsMade: 4, skippedByBudget: 2 });
  });

  it('keeps results from healthy providers when another one fails', async () => {
    const good = fakeProvider('good', ok('good'));
    const bad = fakeProvider('bad', async () => {
      throw new ProviderError('boom', 'upstream');
    });
    const tasks = [task(0), task(1)];
    const res = await runProviderTasks([good, bad], new Map([['good', tasks], ['bad', tasks]]), { cache: new MemoryOfferCache(), requestId: 'r', now: NOW, deadlineMs: 5000 });
    expect(res.offers).toHaveLength(2);
    expect(res.statuses.find((s) => s.id === 'good')!.status).toBe('ok');
    expect(res.statuses.find((s) => s.id === 'bad')!).toMatchObject({ status: 'failed', failures: 2 });
  });

  it('reports partial results and timeouts', async () => {
    const flaky = fakeProvider('flaky', async (q, n) => {
      if (n % 2 === 0) throw new ProviderError('nope', 'upstream');
      return ok('flaky')(q);
    }, { maxConcurrency: 1 });
    const slow = fakeProvider('slow', () => new Promise((r) => setTimeout(() => r([]), 2000)), { timeoutMs: 50 });
    const tasks = [task(0), task(1), task(2)];
    const res = await runProviderTasks([flaky, slow], new Map([['flaky', tasks], ['slow', [task(0)]]]), { cache: new MemoryOfferCache(), requestId: 'r', now: NOW, deadlineMs: 5000 });
    expect(res.statuses.find((s) => s.id === 'flaky')!.status).toBe('partial');
    expect(res.statuses.find((s) => s.id === 'slow')!.status).toBe('timeout');
  });

  it('stops calling a provider that rejects credentials (circuit breaker)', async () => {
    const p = fakeProvider('auth', async () => {
      throw new ProviderError('bad token', 'auth');
    }, { maxConcurrency: 1 });
    await runProviderTasks([p], new Map([['auth', [task(0), task(1), task(2)]]]), { cache: new MemoryOfferCache(), requestId: 'r', now: NOW, deadlineMs: 5000 });
    expect(p.stats().calls).toBe(1);
  });

  it('serves repeated searches from cache and supports fault injection', async () => {
    const cache = new MemoryOfferCache();
    const p = fakeProvider('c', ok('c'));
    const tasks = [task(0), task(1)];
    await runProviderTasks([p], new Map([['c', tasks]]), { cache, requestId: 'r1', now: NOW, deadlineMs: 5000 });
    const second = await runProviderTasks([p], new Map([['c', tasks]]), { cache, requestId: 'r2', now: NOW, deadlineMs: 5000 });
    expect(p.stats().calls).toBe(2);
    expect(second.statuses[0]).toMatchObject({ cacheHits: 2, callsMade: 0 });
    expect(second.offers[0].dataQuality).toBe('cached');
    const injected = await runProviderTasks([fakeProvider('x', ok('x'))], new Map([['x', tasks]]), { cache: new MemoryOfferCache(), requestId: 'r3', now: NOW, deadlineMs: 5000, failProviders: ['x'] });
    expect(injected.statuses[0].status).toBe('failed');
  });

  it('shares one in-flight request between identical concurrent searches', async () => {
    const p = fakeProvider('sf', ok('sf'));
    const tasks = [task(0)];
    const opts = { cache: new MemoryOfferCache(), requestId: 'r', now: NOW, deadlineMs: 5000 };
    await Promise.all([runProviderTasks([p], new Map([['sf', tasks]]), opts), runProviderTasks([p], new Map([['sf', tasks]]), { ...opts, cache: new MemoryOfferCache() })]);
    expect(p.stats().calls).toBe(1);
  });
});
