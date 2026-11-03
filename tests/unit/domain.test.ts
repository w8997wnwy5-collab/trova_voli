import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, monthDays, SearchRequestSchema, todayUtc } from '@/lib/domain/schemas';
import { presetStrategy, resolveWeights } from '@/lib/domain/strategy';
import { decodeSearch, encodeSearch, searchKey } from '@/lib/url/search-url';

const today = todayUtc();
const d = (n: number) => addDays(today, n);

describe('SearchRequestSchema', () => {
  const base = { tripType: 'return', slices: [{ from: ['MIL'], to: ['LON'] }], dates: { mode: 'exact', depart: d(20), return: d(23) } };

  it('accepts a valid return search and fills defaults', () => {
    const r = SearchRequestSchema.parse(base);
    expect(r.passengers).toEqual({ adults: 1, children: 0, infants: 0 });
    expect(r.currency).toBe('EUR');
    expect(r.strategy.preset).toBe('balanced');
  });

  it('rejects past dates, identical endpoints and inverted return dates', () => {
    const res = SearchRequestSchema.safeParse({ ...base, slices: [{ from: ['MIL'], to: ['MIL'] }], dates: { mode: 'exact', depart: d(-5), return: d(-6) } });
    expect(res.success).toBe(false);
    const messages = res.error!.issues.map((i) => i.message);
    expect(messages).toContain('Origin and destination must differ');
    expect(messages).toContain('Departure date is in the past');
    expect(messages).toContain('Return must be on or after departure');
  });

  it('limits date windows and trip-length ranges', () => {
    expect(SearchRequestSchema.safeParse({ ...base, dates: { mode: 'window', windowStart: d(10), windowEnd: d(50) } }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ ...base, dates: { mode: 'window', windowStart: d(10), windowEnd: d(30), nights: { min: 2, max: 12 } } }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ ...base, dates: { mode: 'window', windowStart: d(10), windowEnd: d(30), nights: { min: 2, max: 5 } } }).success).toBe(true);
  });

  it('requires infants to have an adult and caps seats at 9', () => {
    expect(SearchRequestSchema.safeParse({ ...base, passengers: { adults: 1, children: 0, infants: 2 } }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ ...base, passengers: { adults: 6, children: 4, infants: 0 } }).success).toBe(false);
  });

  it('requires chronological legs for multi-city trips', () => {
    const res = SearchRequestSchema.safeParse({
      tripType: 'multi-city',
      slices: [
        { from: ['ROM'], to: ['PAR'], date: d(20) },
        { from: ['PAR'], to: ['AMS'], date: d(18) },
      ],
      dates: { mode: 'exact' },
    });
    expect(res.success).toBe(false);
    expect(res.error!.issues.some((i) => i.message.includes('chronological'))).toBe(true);
  });
});

describe('date helpers', () => {
  it('adds days across month ends and lists month days', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(monthDays('2027-02')).toHaveLength(28);
  });
});

describe('ranking weights', () => {
  it('sum to 1 and shift from cost to comfort with the slider', () => {
    const save = resolveWeights({ priority: 0 });
    const comfort = resolveWeights({ priority: 100 });
    for (const w of [save, comfort]) expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(save.cost).toBeGreaterThan(comfort.cost);
    expect(comfort.duration).toBeGreaterThan(save.duration);
  });

  it('normalises custom weights', () => {
    const w = resolveWeights({ priority: 50, weights: { cost: 50, duration: 50, stops: 0, risk: 0, airportChanges: 0, preferences: 0 } });
    expect(w.cost).toBe(0.5);
    expect(w.stops).toBe(0);
  });
});

describe('shareable URL codec', () => {
  it('round-trips a search with strategy overrides', () => {
    const strategy = { ...presetStrategy('cheapest'), preset: 'custom' as const, maxStops: { value: 1 as const, mode: 'soft' as const }, includeHotel: false };
    const qs = encodeSearch({
      request: {
        tripType: 'return',
        slices: [{ from: ['MIL'], to: ['LON', 'LGW'] }],
        dates: { mode: 'flexible', depart: '2026-12-11', return: '2026-12-14', flexDays: 2 },
        passengers: { adults: 2, children: 1, infants: 0 },
        bags: { carryOn: false, checked: 1 },
        currency: 'GBP',
        nearbyRadiusKm: 200,
        strategy,
      },
      sort: 'cheapest',
      focus: 'abc123',
    });
    expect(qs).toContain('from=MIL&to=LON,LGW');
    const back = decodeSearch(new URLSearchParams(qs));
    expect(back.request.slices[0]).toEqual({ from: ['MIL'], to: ['LON', 'LGW'] });
    expect(back.request.dates).toMatchObject({ mode: 'flexible', depart: '2026-12-11', return: '2026-12-14', flexDays: 2 });
    expect(back.request.passengers).toEqual({ adults: 2, children: 1, infants: 0 });
    expect(back.request.bags).toEqual({ carryOn: false, checked: 1 });
    expect(back.request.currency).toBe('GBP');
    expect(back.request.nearbyRadiusKm).toBe(200);
    expect(back.request.strategy.maxStops).toEqual({ value: 1, mode: 'soft' });
    expect(back.request.strategy.includeHotel).toBe(false);
    expect(back.sort).toBe('cheapest');
    expect(back.focus).toBe('abc123');
  });

  it('round-trips multi-city legs and ignores garbage', () => {
    const qs = 'trip=multi-city&legs=ROM:PAR:2026-12-10,PAR:AMS:2026-12-13,xx:yy:zz&preset=nope&ms=9.h&cur=XYZ&adults=99';
    const s = decodeSearch(new URLSearchParams(qs));
    expect(s.request.slices[0]).toEqual({ from: ['ROM'], to: ['PAR'], date: '2026-12-10' });
    expect(s.request.slices[2]).toEqual({ from: [], to: [], date: undefined });
    expect(s.request.strategy.preset).toBe('balanced');
    expect(s.request.strategy.maxStops).toEqual(presetStrategy('balanced').maxStops);
    expect(s.request.currency).toBe('EUR');
    expect(s.request.passengers?.adults).toBe(1);
  });

  it('excludes filter rules and view state from the search identity, but not scope flags', () => {
    const a = decodeSearch(new URLSearchParams('from=MIL&to=LON&depart=2026-12-11&return=2026-12-14&preset=balanced&sort=fastest&ms=0.h'));
    const b = decodeSearch(new URLSearchParams('from=MIL&to=LON&depart=2026-12-11&return=2026-12-14&preset=business'));
    expect(searchKey(a)).toBe(searchKey(b));
    const c = decodeSearch(new URLSearchParams('from=MIL&to=LON&depart=2026-12-11&return=2026-12-14&preset=balanced&ur=1'));
    expect(searchKey(c)).not.toBe(searchKey(a));
  });
});
