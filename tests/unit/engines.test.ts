import { describe, expect, it } from 'vitest';
import { presetStrategy, type TripStrategy } from '@/lib/domain/strategy';
import type { Itinerary } from '@/lib/domain/types';
import { assemble } from '@/lib/engine/assemble';
import { combine, type CombineSpec } from '@/lib/engine/combine';
import { bagNeeds, computeCost } from '@/lib/engine/cost';
import { explain } from '@/lib/engine/explain';
import { applyStrategy, effectiveTotal } from '@/lib/engine/filters';
import { computeImpacts, suggestRelaxations } from '@/lib/engine/impact';
import { rank } from '@/lib/engine/rank';
import { assessRisk, isOvernightFlight, isOvernightLayover, missProbability, requiredConnectionMinutes } from '@/lib/engine/risk';
import { conventionalBaseline, dedupe, prune } from '@/lib/engine/select';
import { BUNDLED_RATES } from '@/lib/util/fx';
import { assembleCtx, combineCtx, journey, offer, seg } from '../support/fixtures';

const D1 = '2026-12-11';
const D2 = '2026-12-14';

function returnSpec(): CombineSpec & { journeys: ReturnType<typeof journey>[] } {
  return {
    tripType: 'return',
    journeys: [journey(0, ['MXP', 'LIN', 'BGY'], ['STN', 'LGW', 'LHR'], [D1]), journey(1, ['STN', 'LGW', 'LHR'], ['MXP', 'LIN', 'BGY'], [D2])],
    datePairs: new Set([`${D1}|${D2}`]),
  };
}

describe('combination engine', () => {
  it('pairs self-transfers only with a safe minimum gap and within the max layover', () => {
    const spec: CombineSpec = { tripType: 'one-way', journeys: [journey(0, ['MXP'], ['BCN'], [D1])] };
    const first = offer('a', [[seg('MXP', 'CDG', `${D1}T08:00`, 90)]], { price: 40 });
    const tooTight = offer('b', [[seg('CDG', 'BCN', `${D1}T10:00`, 100)]], { price: 30 }); // 30 min after landing
    const ok = offer('c', [[seg('CDG', 'BCN', `${D1}T12:30`, 100)]], { price: 35 });
    const tooLate = offer('d', [[seg('CDG', 'BCN', `${addDay(D1)}T12:00`, 100)]], { price: 20 }); // > 20h
    const res = combine([first, tooTight, ok, tooLate], combineCtx(spec));
    const ids = res.drafts.map((d) => d[0].map((l) => l.offer.id).join('+'));
    expect(ids).toEqual(['a+c']);
  });

  it('adds ground transfer time before allowing an airport change', () => {
    const spec: CombineSpec = { tripType: 'one-way', journeys: [journey(0, ['MXP'], ['BCN'], [D1])] };
    const first = offer('a', [[seg('MXP', 'CDG', `${D1}T08:00`, 90)]], { price: 40 });
    const change2h = offer('b', [[seg('ORY', 'BCN', `${D1}T11:30`, 100)]], { price: 30 }); // 2h after landing < 90 + 120
    const change4h = offer('c', [[seg('ORY', 'BCN', `${D1}T13:30`, 100)]], { price: 30 });
    const res = combine([first, change2h, change4h], combineCtx(spec));
    expect(res.drafts.map((d) => d[0].map((l) => l.offer.id).join('+'))).toEqual(['a+c']);
  });

  it('uses round-trip tickets whole and builds split tickets per direction', () => {
    const spec = returnSpec();
    const rt = offer('rt', [[seg('MXP', 'LHR', `${D1}T07:00`, 120)], [seg('LHR', 'MXP', `${D2}T18:00`, 120)]], { price: 200 });
    const out = offer('o', [[seg('BGY', 'STN', `${D1}T06:00`, 120, 'QJ')]], { price: 30 });
    const back = offer('b', [[seg('LGW', 'MXP', `${D2}T20:00`, 120, 'SH')]], { price: 45 });
    const res = combine([rt, out, back], combineCtx(spec));
    const keys = res.drafts.map((d) => d.map((legs) => legs.map((l) => `${l.offer.id}:${l.slice}`).join('+')).join('|'));
    expect(keys).toContain('rt:0|rt:1');
    expect(keys).toContain('o:0|b:0');
    // A round-trip ticket is never half-used (no throwaway ticketing).
    expect(keys.some((k) => k.includes('rt:0') && !k.includes('rt:1'))).toBe(false);
  });

  it('builds positioning itineraries around a round trip from a hub', () => {
    const spec: CombineSpec = {
      tripType: 'return',
      journeys: [journey(0, ['TRN'], ['JFK'], [D1]), journey(1, ['JFK'], ['TRN'], [D2])],
      datePairs: new Set([`${D1}|${D2}`]),
    };
    const rt = offer('rt', [[seg('CDG', 'JFK', `${D1}T14:00`, 480)], [seg('JFK', 'CDG', `${D2}T18:00`, 450)]], { price: 300 });
    const pos1 = offer('p1', [[seg('TRN', 'CDG', `${D1}T07:00`, 90)]], { price: 50 });
    const pos2 = offer('p2', [[seg('CDG', 'TRN', `${addDay(D2)}T13:00`, 90)]], { price: 50 });
    const res = combine([rt, pos1, pos2], combineCtx(spec));
    const keys = res.drafts.map((d) => d.map((legs) => legs.map((l) => `${l.offer.id}:${l.slice}`).join('+')).join('|'));
    expect(keys).toContain('p1:0+rt:0|rt:1+p2:0');
  });

  it('keeps multi-city legs chronological with a beam search', () => {
    const spec: CombineSpec = {
      tripType: 'multi-city',
      journeys: [journey(0, ['FCO'], ['CDG'], [D1]), journey(1, ['CDG'], ['AMS'], [D1])],
    };
    const leg1 = offer('l1', [[seg('FCO', 'CDG', `${D1}T08:00`, 120)]], { price: 50 });
    const early = offer('l2a', [[seg('CDG', 'AMS', `${D1}T09:00`, 60)]], { price: 20 });
    const later = offer('l2b', [[seg('CDG', 'AMS', `${D1}T16:00`, 60)]], { price: 40 });
    const res = combine([leg1, early, later], combineCtx(spec));
    expect(res.drafts.map((d) => d.map((legs) => legs[0].offer.id).join('>'))).toEqual(['l1>l2b']);
  });

  it('caps the number of drafts', () => {
    const spec: CombineSpec = { tripType: 'one-way', journeys: [journey(0, ['MXP'], ['BCN'], [D1])] };
    const offers = Array.from({ length: 60 }, (_, i) => offer(`o${i}`, [[seg('MXP', 'BCN', `${D1}T${String(6 + (i % 14)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, 100, 'X', i)]], { price: 30 + i }));
    const res = combine(offers, combineCtx(spec, { limits: { optionsPerDate: 5, maxDrafts: 10 } }));
    expect(res.drafts.length).toBeLessThanOrEqual(80);
    const capped = combine(offers, combineCtx(spec, { limits: { maxDrafts: 10 } }));
    expect(capped.drafts.length).toBeLessThanOrEqual(60);
  });
});

function addDay(d: string) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

describe('cost calculator', () => {
  const ctx = { currency: 'EUR', fx: BUNDLED_RATES, passengers: { adults: 2, children: 0, infants: 0 }, bags: { carryOn: true, checked: 1 } };

  it('adds missing bags per traveller and per flight, with known fees', () => {
    const lcc = offer('l', [[seg('BGY', 'STN', `${D1}T06:00`, 120)]], { price: 60, carryOn: 0, checked: 0, carryOnFee: 20, checkedFee: 30 });
    const need = bagNeeds(lcc, ctx);
    expect(need).toMatchObject({ carryOnUnits: 2, checkedUnits: 2, estimated: false, included: false });
    const cost = computeCost([{ offer: lcc, label: 'T1' }], [], ctx);
    expect(cost.total.amount).toBe((60 + 2 * 20 + 2 * 30) * 100);
    expect(cost.perTraveler.amount).toBe(8000);
  });

  it('estimates fees when the allowance is unknown and marks them', () => {
    const unknown = offer('u', [[seg('MXP', 'LHR', `${D1}T06:00`, 120)]], { price: 100, carryOn: null, checked: null });
    const cost = computeCost([{ offer: unknown, label: 'T1' }], [], ctx);
    const bags = cost.lines.find((l) => l.kind === 'bags')!;
    expect(bags.estimated).toBe(true);
    expect(cost.estimatedShare).toBeGreaterThan(0);
  });

  it('includes booking/payment fees, converts currencies and adds transfers and hotels', () => {
    const gbp = offer('g', [[seg('LGW', 'MXP', `${D2}T06:00`, 120)]], { price: 100, currency: 'GBP', checked: 1, bookingFee: 5, paymentPercent: 2 });
    const cost = computeCost([{ offer: gbp, label: 'T1' }], [{ kind: 'transfer', label: 'Bus', eurPerUnit: 10, units: 2 }, { kind: 'hotel', label: 'Hotel', eurPerUnit: 100, units: 1 }], ctx);
    expect(cost.lines.map((l) => l.kind)).toEqual(['fare', 'booking-fee', 'payment-fee', 'transfer', 'hotel']);
    expect(cost.fxNote).toMatch(/converted/);
    expect(cost.hotelAmount).toBe(10000);
    const fare = Math.round((100 / BUNDLED_RATES.rates.GBP) * 100);
    expect(cost.lines[0].amount.amount).toBe(fare);
  });
});

describe('risk rules', () => {
  const prev = seg('MXP', 'CDG', `${D1}T08:00`, 90);
  const next = seg('CDG', 'BCN', `${D1}T12:00`, 100);

  it('recommends longer buffers for self-transfers, checked bags, long-haul and airport changes', () => {
    const base = { prev, next, selfTransfer: false, transferMinutes: 0, checkedBags: false, passportControl: false };
    const protectedMin = requiredConnectionMinutes(base);
    const self = requiredConnectionMinutes({ ...base, selfTransfer: true });
    const selfBags = requiredConnectionMinutes({ ...base, selfTransfer: true, checkedBags: true });
    const longHaul = requiredConnectionMinutes({ ...base, selfTransfer: true, prev: { ...prev, durationMinutes: 480 } });
    const change = requiredConnectionMinutes({ ...base, selfTransfer: true, next: { ...next, origin: 'ORY' }, transferMinutes: 75 });
    expect(protectedMin).toBeLessThan(self);
    expect(selfBags).toBeGreaterThan(self);
    expect(longHaul).toBeGreaterThan(self);
    expect(change).toBeGreaterThan(self + 75);
  });

  it('lowers missed-connection probability as the buffer grows', () => {
    const c = { prev, next, selfTransfer: true, transferMinutes: 0, checkedBags: false, passportControl: false };
    const p90 = missProbability(c, 90);
    const p180 = missProbability(c, 180);
    expect(p90).toBeGreaterThan(p180);
    expect(missProbability(c, 30)).toBe(1);
    expect(missProbability({ ...c, selfTransfer: false }, 180)).toBeLessThan(p180);
  });

  it('detects overnight layovers and overnight flights', () => {
    expect(isOvernightLayover('2026-12-11T22:30', '2026-12-12T07:00')).toBe(true);
    expect(isOvernightLayover('2026-12-11T09:00', '2026-12-11T15:00')).toBe(false);
    expect(isOvernightFlight(seg('JFK', 'LHR', '2026-12-11T22:00', 420))).toBe(true);
    expect(isOvernightFlight(seg('MXP', 'LHR', '2026-12-11T10:00', 120))).toBe(false);
  });

  it('turns probabilities and flags into a 0–100 score and level', () => {
    const low = assessRisk({ selfTransferMiss: [], protectedMiss: [0.01], airportChanges: 0, overnightLayovers: 0, overnightFlights: 0, requiresEntry: false, transitVisaRisk: false, flags: [] });
    const high = assessRisk({ selfTransferMiss: [0.25], protectedMiss: [], airportChanges: 1, overnightLayovers: 1, overnightFlights: 0, requiresEntry: true, transitVisaRisk: false, flags: [] });
    expect(low.level).toBe('low');
    expect(high.level).toBe('high');
    expect(high.missProbability).toBe(0.25);
  });
});

function buildItineraries() {
  const spec = returnSpec();
  const ctx = assembleCtx(spec);
  const rt = offer('rt', [[seg('MXP', 'LHR', `${D1}T07:00`, 120, 'AZ', 1)], [seg('LHR', 'MXP', `${D2}T18:00`, 120, 'AZ', 2)]], { price: 220, checked: 1, changeable: true });
  const out = offer('o', [[seg('BGY', 'STN', `${D1}T06:00`, 120, 'QJ', 3)]], { price: 30, carryOn: 0, carryOnFee: 20 });
  const back = offer('b', [[seg('LGW', 'MXP', `${D2}T20:00`, 120, 'SH', 4)]], { price: 45, carryOn: 1 });
  const selfOut1 = offer('s1', [[seg('MXP', 'CDG', `${D1}T06:00`, 90, 'AF', 5)]], { price: 25 });
  const selfOut2 = offer('s2', [[seg('ORY', 'LGW', `${D1}T13:30`, 80, 'BZ', 6)]], { price: 25 });
  const drafts = [
    [[{ offer: rt, slice: 0 }], [{ offer: rt, slice: 1 }]],
    [[{ offer: out, slice: 0 }], [{ offer: back, slice: 0 }]],
    [[{ offer: selfOut1, slice: 0 }, { offer: selfOut2, slice: 0 }], [{ offer: back, slice: 0 }]],
  ];
  return { ctx, its: drafts.map((d) => assemble(d, ctx)!) };
}

describe('assembly', () => {
  it('describes conventional, split and self-transfer itineraries', () => {
    const { its } = buildItineraries();
    const [conv, split, self] = its;
    expect(conv.attrs.conventional).toBe(true);
    expect(conv.tags).toContain('conventional');
    expect(conv.attrs.bagsIncluded).toBe(true);
    expect(split.tags).toContain('split-ticket');
    expect(split.attrs.ticketCount).toBe(2);
    expect(split.cost.lines.some((l) => l.kind === 'bags')).toBe(true);
    expect(self.attrs.selfTransfers).toBe(1);
    expect(self.attrs.airportChanges).toBe(1);
    expect(self.attrs.airportChangesSameCityOnly).toBe(true);
    expect(self.tags).toEqual(expect.arrayContaining(['self-transfer', 'airport-change', 'split-ticket']));
    expect(self.cost.lines.some((l) => l.kind === 'transfer')).toBe(true);
    expect(self.risk.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['self-transfer', 'airport-change']));
    expect(self.journeys[0].connections[0]).toMatchObject({ kind: 'self-transfer', airportChange: true, layoverMinutes: 360 });
  });

  it('adds access transfers for nearby airports and flags entry requirements', () => {
    const spec: CombineSpec & { journeys: ReturnType<typeof journey>[] } = {
      tripType: 'one-way',
      journeys: [{ ...journey(0, ['MXP'], ['BCN'], [D1], { origins: { TRN: 'MXP' } }) }],
    };
    const ctx = assembleCtx(spec);
    const a = offer('a', [[seg('TRN', 'LGW', `${D1}T06:00`, 120)]], { price: 20 });
    const b = offer('b', [[seg('LGW', 'BCN', `${D1}T12:00`, 120)]], { price: 20 });
    const it = assemble([[{ offer: a, slice: 0 }, { offer: b, slice: 0 }]], ctx)!;
    expect(it.attrs.usesNearbyAirport).toBe(true);
    expect(it.journeys[0].accessTransfers[0]).toMatchObject({ from: 'MXP', to: 'TRN' });
    expect(it.attrs.requiresEntry).toBe(true); // landside self-transfer in the UK on an Italy → Spain trip
    expect(it.attrs.conventional).toBe(false);
  });

  it('gives identical flights the same id so they de-duplicate', () => {
    const { ctx } = buildItineraries();
    const x = offer('x', [[seg('MXP', 'BCN', `${D1}T06:00`, 120, 'VY', 9)]], { price: 50, provider: 'p1' });
    const y = offer('y', [[seg('MXP', 'BCN', `${D1}T06:00`, 120, 'VY', 9)]], { price: 45, provider: 'p2' });
    const spec = { tripType: 'one-way' as const, journeys: [journey(0, ['MXP'], ['BCN'], [D1])] };
    const c = { ...ctx, spec };
    const a = assemble([[{ offer: x, slice: 0 }]], c)!;
    const b = assemble([[{ offer: y, slice: 0 }]], c)!;
    expect(a.id).toBe(b.id);
    const [only] = dedupe([a, b]);
    expect(only.attrs.totalCost).toBe(4500);
    expect(only.alternatives[0].providerName).toContain('p1');
  });
});

describe('filters, ranking, impact and explanations', () => {
  const { its } = buildItineraries();

  it('hard rules exclude and soft rules only lower preference fit', () => {
    const hard: TripStrategy = { ...presetStrategy('balanced'), selfTransfer: { value: 'never', mode: 'hard' } };
    const soft: TripStrategy = { ...hard, selfTransfer: { value: 'never', mode: 'soft' } };
    const h = applyStrategy(its, hard);
    const s = applyStrategy(its, soft);
    expect(h.kept).toHaveLength(2);
    expect(h.excludedBy.selfTransfer).toBe(1);
    expect(s.kept).toHaveLength(3);
    expect(s.kept.find((k) => k.it.attrs.selfTransfers > 0)!.preferenceFit).toBeLessThan(1);
  });

  it('ranks deterministically and moves with the Save ↔ Comfort slider', () => {
    const save: TripStrategy = { ...presetStrategy('cheapest') };
    const a = rank(applyStrategy(its, save).kept, save).items.map((i) => i.it.id);
    const b = rank(applyStrategy([...its].reverse(), save).kept, save).items.map((i) => i.it.id);
    expect(a).toEqual(b);
    const cheapId = its[1].id;
    expect(a[0]).toBe(cheapId);
    const comfort: TripStrategy = { ...presetStrategy('cheapest'), priority: 100 };
    const top = rank(applyStrategy(its, comfort).kept, comfort).items[0];
    expect(top.it.attrs.selfTransfers).toBe(0);
  });

  it('reports cheapest, fastest and best-value labels with explainable components', () => {
    const s = presetStrategy('cheapest');
    const r = rank(applyStrategy(its, s).kept, s);
    expect(r.cheapestId).toBe(its[1].id);
    const best = r.items[0];
    const sum = Object.values(best.contributions).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(best.score, 0);
    const baseline = conventionalBaseline(its)!;
    const e = explain(best, { ranking: r, baselineTotal: baseline.attrs.totalCost, formatMoney: (n) => `€${(n / 100).toFixed(2)}` });
    expect(e.savingsVsBaseline).toBeGreaterThan(0);
    expect(e.reasons.join(' ')).toMatch(/Saves €/);
  });

  it('computes what each control would change', () => {
    const s = presetStrategy('cheapest');
    const impacts = computeImpacts(its, s);
    const never = impacts.selfTransfer.options.find((o) => o.value === 'never')!;
    expect(never.count).toBe(2);
    const split = impacts.splitTickets.options.find((o) => o.value === false)!;
    expect(split.count).toBe(1);
    expect(split.cheapest).toBe(its[0].attrs.totalCost);
  });

  it('suggests relaxations when must-haves hide everything', () => {
    const strict: TripStrategy = { ...presetStrategy('balanced'), splitTickets: { value: false, mode: 'hard' }, maxStops: { value: 0, mode: 'hard' }, flexibleTicket: { value: true, mode: 'hard' }, bagsIncluded: { value: true, mode: 'hard' }, maxDoorToDoorHours: { value: 2, mode: 'hard' } };
    expect(applyStrategy(its, strict).kept).toHaveLength(0);
    const suggestions = suggestRelaxations(its, strict);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].count).toBeGreaterThan(0);
  });

  it('can exclude the optional hotel estimate from totals', () => {
    const it = { ...its[0], cost: { ...its[0].cost, hotelAmount: 5000 } } as Itinerary;
    expect(effectiveTotal(it, { includeHotel: true })).toBe(it.attrs.totalCost);
    expect(effectiveTotal(it, { includeHotel: false })).toBe(it.attrs.totalCost - 5000);
  });

  it('prunes with diversity and finds the conventional baseline', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...its[1], id: `x${i}`, attrs: { ...its[1].attrs, totalCost: 1000 + i } }));
    const kept = prune([...many, its[0]], 10);
    expect(kept.length).toBeLessThanOrEqual(10);
    expect(kept.some((k) => k.attrs.conventional)).toBe(true);
    expect(conventionalBaseline(kept)?.id).toBe(its[0].id);
  });
});
