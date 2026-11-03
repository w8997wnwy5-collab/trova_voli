import { describe, expect, it } from 'vitest';
import { addDays, SearchRequestSchema, todayUtc } from '@/lib/domain/schemas';
import { presetStrategy } from '@/lib/domain/strategy';
import { applyStrategy } from '@/lib/engine/filters';
import { rank } from '@/lib/engine/rank';
import { MockProvider } from '@/lib/providers/mock/provider';
import { MemoryOfferCache } from '@/lib/search/cache';
import { runSearch } from '@/lib/search/service';
import { createLogger } from '@/lib/server/logger';

const NOW = Date.parse(`${todayUtc()}T10:00:00Z`);
const day = (n: number) => addDays(todayUtc(), n);
const providers = () => ({
  active: [
    new MockProvider({ id: 'demo-network', name: 'Demo Air Network', personality: 'network' }),
    new MockProvider({ id: 'demo-budget', name: 'Demo Budget Finder', personality: 'budget' }),
  ],
  inactive: [{ id: 'duffel', name: 'Duffel', reason: 'Not configured' }],
});
const deps = () => ({ providers: providers(), cache: new MemoryOfferCache(), now: NOW, logger: createLogger({}, 'silent') });

describe('end-to-end search (demo providers)', () => {
  const request = SearchRequestSchema.parse({
    tripType: 'return',
    slices: [{ from: ['MIL'], to: ['LON'] }],
    dates: { mode: 'flexible', depart: day(38), return: day(41), flexDays: 1 },
    bags: { carryOn: true, checked: 0 },
    strategy: presetStrategy('cheapest'),
  });

  it('finds conventional and hacker itineraries with a baseline and statuses', async () => {
    const res = await runSearch(request, 'it-1', deps());
    expect(res.dataMode).toBe('demo');
    expect(res.candidates.length).toBeGreaterThan(50);
    expect(res.candidates.length).toBeLessThanOrEqual(250);
    expect(res.baselineId).toBeDefined();
    expect(res.candidates.every((c) => c.tags.includes('demo'))).toBe(true);
    expect(res.candidates.some((c) => c.tags.includes('split-ticket'))).toBe(true);
    expect(res.candidates.some((c) => c.attrs.usesNearbyAirport)).toBe(true);
    expect(res.searchedDates).toHaveLength(3);
    expect(res.providers.map((p) => p.status)).toEqual(['ok', 'ok', 'not-configured']);
    expect(res.warnings[0]).toMatch(/Demo data/);
    // Savings vs the conventional baseline are real: the cheapest option beats or equals it.
    const s = presetStrategy('cheapest');
    const ranking = rank(applyStrategy(res.candidates, s).kept, s, 'cheapest');
    const baseline = res.candidates.find((c) => c.id === res.baselineId)!;
    expect(ranking.items[0].total).toBeLessThanOrEqual(baseline.attrs.totalCost);
    // Every returned itinerary has a consistent cost breakdown.
    for (const c of res.candidates.slice(0, 50)) {
      expect(c.cost.lines.reduce((sum, l) => sum + l.amount.amount, 0)).toBe(c.cost.total.amount);
    }
  });

  it('is deterministic for the same inputs', async () => {
    const a = await runSearch(request, 'it-2', deps());
    const b = await runSearch(request, 'it-3', deps());
    expect(a.candidates.map((c) => `${c.id}:${c.cost.total.amount}`)).toEqual(b.candidates.map((c) => `${c.id}:${c.cost.total.amount}`));
  });

  it('survives a provider outage with partial results', async () => {
    const res = await runSearch({ ...request, simulate: { failProviders: ['demo-budget'] } }, 'it-4', { ...deps(), allowFaultInjection: true });
    expect(res.providers.find((p) => p.id === 'demo-budget')!.status).toBe('failed');
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.warnings.some((w) => w.includes('Demo Budget Finder'))).toBe(true);
  });

  it('ignores fault injection unless explicitly allowed', async () => {
    const res = await runSearch({ ...request, simulate: { failProviders: ['demo-budget'] } }, 'it-5', { ...deps(), allowFaultInjection: false });
    expect(res.providers.find((p) => p.id === 'demo-budget')!.status).toBe('ok');
  });

  it('handles a month-long transatlantic search within budget and time', async () => {
    const month = day(70).slice(0, 7);
    const req = SearchRequestSchema.parse({ tripType: 'return', slices: [{ from: ['MXP'], to: ['NYC'] }], dates: { mode: 'month', month, nights: { min: 6, max: 8 } }, bags: { carryOn: true, checked: 1 } });
    const started = Date.now();
    const res = await runSearch(req, 'it-6', deps());
    expect(Date.now() - started).toBeLessThan(8000);
    expect(res.candidates.length).toBeGreaterThan(50);
    expect(res.stats.itinerariesBuilt).toBeLessThanOrEqual(2500);
    expect(new Set(res.candidates.map((c) => c.attrs.outboundDate)).size).toBeGreaterThan(10);
  });

  it('supports one-way, open-jaw and multi-city trips', async () => {
    const oneWay = await runSearch(SearchRequestSchema.parse({ tripType: 'one-way', slices: [{ from: ['TRN'], to: ['BCN'] }], dates: { mode: 'exact', depart: day(30) } }), 'it-7', deps());
    expect(oneWay.candidates.length).toBeGreaterThan(0);
    expect(oneWay.candidates.every((c) => c.journeys.length === 1)).toBe(true);
    const openJaw = await runSearch(
      SearchRequestSchema.parse({ tripType: 'open-jaw', slices: [{ from: ['MIL'], to: ['PAR'], date: day(30) }, { from: ['AMS'], to: ['MIL'], date: day(34) }], dates: { mode: 'exact' } }),
      'it-8',
      deps(),
    );
    expect(openJaw.candidates.length).toBeGreaterThan(0);
    expect(openJaw.candidates.every((c) => c.journeys.length === 2)).toBe(true);
    const multi = await runSearch(
      SearchRequestSchema.parse({
        tripType: 'multi-city',
        slices: [
          { from: ['ROM'], to: ['PAR'], date: day(30) },
          { from: ['PAR'], to: ['AMS'], date: day(33) },
          { from: ['AMS'], to: ['ROM'], date: day(36) },
        ],
        dates: { mode: 'exact' },
      }),
      'it-9',
      deps(),
    );
    expect(multi.candidates.length).toBeGreaterThan(0);
    for (const c of multi.candidates.slice(0, 30)) {
      for (let i = 1; i < c.journeys.length; i++) expect(c.journeys[i].departureUtc).toBeGreaterThan(c.journeys[i - 1].arrivalUtc);
    }
  });
});
