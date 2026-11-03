import type { FareOffer, FareSlice, TripType } from '@/lib/domain/types';

// Builds candidate itineraries from normalized offers. Pure: all geography comes in through the
// context so the engine is testable without the airport dataset.

export interface Leg {
  offer: FareOffer;
  slice: number;
}

/** Legs flown per journey (outbound, return or multi-city leg), in order. */
export type DraftItinerary = Leg[][];

export interface CombineJourney {
  index: number;
  origins: Set<string>;
  destinations: Set<string>;
  altOrigins: Map<string, unknown>;
  altDestinations: Map<string, unknown>;
  dates: string[];
}

export interface CombineSpec {
  tripType: TripType;
  journeys: CombineJourney[];
  datePairs?: Set<string>;
}

export interface CombineLimits {
  /** Journey options kept per departure date. */
  optionsPerDate: number;
  /** Second legs kept per first leg when building self-transfers. */
  secondLegsPerFirst: number;
  /** Split-ticket combinations kept per (outbound, return) date pair. */
  combosPerDatePair: number;
  beamWidth: number;
  /** Absolute floor for a self-transfer at the same airport (minutes). */
  minSelfTransferMinutes: number;
  /** Extra floor added to the ground transfer time when changing airports (minutes). */
  airportChangeExtraMinutes: number;
  maxLayoverMinutes: number;
  maxStopoverMinutes: number;
  /** Minimum time at the destination before a return flight (minutes). */
  minStayMinutes: number;
  /** Hard cap on drafts handed to assembly (diversity-preserving). */
  maxDrafts: number;
}

export const DEFAULT_LIMITS: CombineLimits = {
  optionsPerDate: 28,
  secondLegsPerFirst: 3,
  combosPerDatePair: 24,
  beamWidth: 300,
  minSelfTransferMinutes: 90,
  airportChangeExtraMinutes: 120,
  maxLayoverMinutes: 20 * 60,
  maxStopoverMinutes: 72 * 60,
  minStayMinutes: 4 * 60,
  maxDrafts: 2500,
};

export interface CombineContext {
  spec: CombineSpec;
  /** Approximate total cost of an offer in the user's currency (minor units), used for pruning. */
  approxCost: (offer: FareOffer) => number;
  sameCity: (a: string, b: string) => boolean;
  /** Ground transfer minutes between two airports of the same area. */
  transferMinutes: (from: string, to: string) => number;
  allowStopovers: boolean;
  limits?: Partial<CombineLimits>;
}

interface JourneyOption {
  legs: Leg[];
  dep: number;
  arr: number;
  date: string;
  cost: number;
  minutes: number;
  single: boolean;
}

const sliceOf = (l: Leg): FareSlice => l.offer.slices[l.slice];
const firstSeg = (s: FareSlice) => s.segments[0];
const lastSeg = (s: FareSlice) => s.segments[s.segments.length - 1];
const depDate = (s: FareSlice) => firstSeg(s).departureLocal.slice(0, 10);

function makeOption(legs: Leg[], cost: number): JourneyOption {
  const dep = firstSeg(sliceOf(legs[0])).departureUtc;
  const arr = lastSeg(sliceOf(legs[legs.length - 1])).arrivalUtc;
  return { legs, dep, arr, date: depDate(sliceOf(legs[0])), cost, minutes: (arr - dep) / 60000, single: legs.length === 1 };
}

/** Keeps the cheapest options per date plus a few of the fastest, so pruning never hides speed. */
function prunePerDate(options: JourneyOption[], perDate: number): JourneyOption[] {
  const byDate = new Map<string, JourneyOption[]>();
  for (const o of options) {
    const list = byDate.get(o.date) ?? [];
    list.push(o);
    byDate.set(o.date, list);
  }
  const out: JourneyOption[] = [];
  for (const list of byDate.values()) {
    const keep = new Set<JourneyOption>();
    [...list].sort((a, b) => a.cost - b.cost || a.minutes - b.minutes).slice(0, perDate).forEach((o) => keep.add(o));
    [...list].sort((a, b) => a.minutes - b.minutes || a.cost - b.cost).slice(0, 4).forEach((o) => keep.add(o));
    [...list].filter((o) => o.single).sort((a, b) => a.cost - b.cost).slice(0, 6).forEach((o) => keep.add(o));
    out.push(...keep);
  }
  return out;
}

function buildJourneyOptions(j: CombineJourney, oneSlice: FareOffer[], ctx: CombineContext, limits: CombineLimits): JourneyOption[] {
  const isOrigin = (a: string) => j.origins.has(a) || j.altOrigins.has(a);
  const isDest = (a: string) => j.destinations.has(a) || j.altDestinations.has(a);
  const dates = new Set(j.dates);
  const options: JourneyOption[] = [];
  const firstLegs: FareOffer[] = [];
  const secondByAirport = new Map<string, FareOffer[]>();

  for (const o of oneSlice) {
    const s = o.slices[0];
    const from = firstSeg(s).origin;
    const to = lastSeg(s).destination;
    if (isOrigin(from) && isDest(to)) {
      if (dates.has(depDate(s))) options.push(makeOption([{ offer: o, slice: 0 }], ctx.approxCost(o)));
    } else if (isOrigin(from) && !isOrigin(to)) {
      if (dates.has(depDate(s))) firstLegs.push(o);
    } else if (!isOrigin(from) && !isDest(from) && isDest(to)) {
      const list = secondByAirport.get(from) ?? [];
      list.push(o);
      secondByAirport.set(from, list);
    }
  }
  for (const list of secondByAirport.values()) list.sort((a, b) => firstSeg(a.slices[0]).departureUtc - firstSeg(b.slices[0]).departureUtc);
  const hubAirports = [...secondByAirport.keys()];
  const maxLayover = (ctx.allowStopovers ? limits.maxStopoverMinutes : limits.maxLayoverMinutes) * 60000;

  for (const f of firstLegs) {
    const arrive = lastSeg(f.slices[0]);
    const fCost = ctx.approxCost(f);
    const candidates: { o: FareOffer; score: number }[] = [];
    for (const airport of hubAirports) {
      if (airport !== arrive.destination && !ctx.sameCity(airport, arrive.destination)) continue;
      const change = airport !== arrive.destination;
      const minGap = (change ? ctx.transferMinutes(arrive.destination, airport) + limits.airportChangeExtraMinutes : limits.minSelfTransferMinutes) * 60000;
      for (const s of secondByAirport.get(airport)!) {
        const dep = firstSeg(s.slices[0]).departureUtc;
        const gap = dep - arrive.arrivalUtc;
        if (gap < minGap) continue;
        if (gap > maxLayover) break;
        if (lastSeg(s.slices[0]).destination === firstSeg(f.slices[0]).origin) continue;
        candidates.push({ o: s, score: ctx.approxCost(s) + gap / 60000 / 6 });
      }
    }
    candidates
      .sort((a, b) => a.score - b.score)
      .slice(0, limits.secondLegsPerFirst)
      .forEach(({ o }) => options.push(makeOption([{ offer: f, slice: 0 }, { offer: o, slice: 0 }], fCost + ctx.approxCost(o))));
  }
  const perDate = Math.max(limits.optionsPerDate, Math.min(80, Math.round(240 / Math.max(1, j.dates.length))));
  return prunePerDate(options, perDate);
}

function matchesJourney(s: FareSlice, j: CombineJourney): boolean {
  const from = firstSeg(s).origin;
  const to = lastSeg(s).destination;
  return (j.origins.has(from) || j.altOrigins.has(from)) && (j.destinations.has(to) || j.altDestinations.has(to)) && j.dates.includes(depDate(s));
}

export interface CombineResult {
  drafts: DraftItinerary[];
  stats: { journeyOptions: number[]; considered: number };
}

/** Generates candidate itineraries; bounded by the limits to avoid combinatorial explosion. */
export function combine(offers: FareOffer[], ctx: CombineContext): CombineResult {
  const limits = { ...DEFAULT_LIMITS, ...ctx.limits };
  const { spec } = ctx;
  const oneSlice = offers.filter((o) => o.slices.length === 1);
  const multiSlice = offers.filter((o) => o.slices.length > 1);
  const perJourney = spec.journeys.map((j) => buildJourneyOptions(j, oneSlice, ctx, limits));
  const drafts: DraftItinerary[] = [];
  let considered = 0;
  // Few date combinations (exact dates) can afford many options each; many combinations get fewer.
  const pairCount = spec.datePairs?.size ?? 1;
  const perPairCap = Math.max(limits.combosPerDatePair, Math.min(120, Math.round(1200 / pairCount)));

  // 1) Single tickets covering every journey (round trip, open-jaw or multi-city ticket).
  if (spec.journeys.length > 1) {
    const byDates = new Map<string, { o: FareOffer; cost: number; minutes: number }[]>();
    for (const o of multiSlice) {
      if (o.slices.length !== spec.journeys.length) continue;
      if (!o.slices.every((s, i) => matchesJourney(s, spec.journeys[i]))) continue;
      if (!pairAllowed(spec, o.slices.map(depDate))) continue;
      if (!chronological(o.slices.map((s) => [firstSeg(s).departureUtc, lastSeg(s).arrivalUtc]), limits.minStayMinutes)) continue;
      const key = o.slices.map(depDate).join('|');
      const list = byDates.get(key) ?? [];
      const minutes = o.slices.reduce((m, s) => m + (lastSeg(s).arrivalUtc - firstSeg(s).departureUtc) / 60000, 0);
      list.push({ o, cost: ctx.approxCost(o), minutes });
      byDates.set(key, list);
    }
    for (const list of byDates.values()) {
      const keep = new Set<FareOffer>();
      [...list].sort((a, b) => a.cost - b.cost).slice(0, perPairCap).forEach((x) => keep.add(x.o));
      [...list].sort((a, b) => a.minutes - b.minutes || a.cost - b.cost).slice(0, 3).forEach((x) => keep.add(x.o));
      for (const o of keep) drafts.push(o.slices.map((_, i) => [{ offer: o, slice: i }]));
    }
  }

  if (spec.journeys.length === 1) {
    drafts.push(...perJourney[0].map((opt) => [opt.legs]));
  } else if (spec.journeys.length === 2) {
    // 2) Separate tickets per direction (any mix of airlines/providers).
    const [outs, rets] = perJourney;
    const retsByDate = new Map<string, JourneyOption[]>();
    for (const r of rets) {
      const list = retsByDate.get(r.date) ?? [];
      list.push(r);
      retsByDate.set(r.date, list);
    }
    for (const list of retsByDate.values()) list.sort((a, b) => a.cost - b.cost);
    const perPair = new Map<string, { cost: number; minutes: number; draft: DraftItinerary }[]>();
    for (const o of outs) {
      for (const [date, list] of retsByDate) {
        if (!pairAllowed(spec, [o.date, date])) continue;
        for (const r of list) {
          considered++;
          if (r.dep < o.arr + limits.minStayMinutes * 60000) continue;
          const key = `${o.date}|${date}`;
          const bucket = perPair.get(key) ?? [];
          bucket.push({ cost: o.cost + r.cost, minutes: o.minutes + r.minutes, draft: [o.legs, r.legs] });
          perPair.set(key, bucket);
        }
      }
    }
    for (const bucket of perPair.values()) {
      const keep = new Set<(typeof bucket)[number]>();
      [...bucket].sort((a, b) => a.cost - b.cost).slice(0, perPairCap).forEach((c) => keep.add(c));
      [...bucket].sort((a, b) => a.minutes - b.minutes || a.cost - b.cost).slice(0, 4).forEach((c) => keep.add(c));
      for (const c of keep) drafts.push(c.draft);
    }
    // 3) Positioning: round trip from a hub, reached with separate one-way flights.
    if (spec.tripType === 'return') drafts.push(...positioningDrafts(spec, oneSlice, multiSlice, ctx, limits));
  } else {
    // 4) Multi-city with separate tickets: beam search keeps the problem linear in legs.
    let beam: { legs: Leg[][]; arr: number; cost: number }[] = [{ legs: [], arr: Number.NEGATIVE_INFINITY, cost: 0 }];
    for (const options of perJourney) {
      const next: typeof beam = [];
      const sorted = [...options].sort((a, b) => a.cost - b.cost).slice(0, 80);
      for (const b of beam) {
        for (const o of sorted) {
          considered++;
          if (o.dep < b.arr + 3 * 3600_000) continue;
          next.push({ legs: [...b.legs, o.legs], arr: o.arr, cost: b.cost + o.cost });
        }
      }
      beam = next.sort((a, b) => a.cost - b.cost).slice(0, limits.beamWidth);
    }
    drafts.push(...beam.filter((b) => b.legs.length === spec.journeys.length).map((b) => b.legs));
  }

  return { drafts: capDrafts(drafts, ctx, limits.maxDrafts), stats: { journeyOptions: perJourney.map((p) => p.length), considered } };
}

/** Keeps at most `max` drafts: a few per date combination first, then the cheapest overall. */
function capDrafts(drafts: DraftItinerary[], ctx: CombineContext, max: number): DraftItinerary[] {
  if (drafts.length <= max) return drafts;
  const scored = drafts.map((d) => {
    const offers = new Set(d.flat().map((l) => l.offer));
    let cost = 0;
    for (const o of offers) cost += ctx.approxCost(o);
    return { d, cost, key: d.map((legs) => depDate(sliceOf(legs[0]))).join('|') };
  });
  scored.sort((a, b) => a.cost - b.cost);
  const keep = new Set<(typeof scored)[number]>();
  const perKey = new Map<string, number>();
  for (const s of scored) {
    const n = perKey.get(s.key) ?? 0;
    if (n < 4) {
      keep.add(s);
      perKey.set(s.key, n + 1);
    }
  }
  for (const s of scored) {
    if (keep.size >= max) break;
    keep.add(s);
  }
  return [...keep].slice(0, Math.max(max, keep.size)).map((s) => s.d);
}

function pairAllowed(spec: CombineSpec, dates: string[]): boolean {
  if (!spec.datePairs || dates.length !== 2) return true;
  return spec.datePairs.has(`${dates[0]}|${dates[1]}`);
}

function chronological(spans: [number, number][], minGapMinutes: number): boolean {
  for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1] + minGapMinutes * 60000) return false;
  return true;
}

function positioningDrafts(spec: CombineSpec, oneSlice: FareOffer[], multiSlice: FareOffer[], ctx: CombineContext, limits: CombineLimits): DraftItinerary[] {
  const [out, back] = spec.journeys;
  const drafts: DraftItinerary[] = [];
  const isHome = (a: string) => out.origins.has(a) || out.altOrigins.has(a);
  // Index one-way flights from home (by arrival airport) and to home (by departure airport).
  const fromHome = new Map<string, FareOffer[]>();
  const toHome = new Map<string, FareOffer[]>();
  for (const o of oneSlice) {
    const s = o.slices[0];
    const from = firstSeg(s).origin;
    const to = lastSeg(s).destination;
    if (isHome(from)) fromHome.set(to, [...(fromHome.get(to) ?? []), o]);
    if (isHome(to)) toHome.set(from, [...(toHome.get(from) ?? []), o]);
  }
  const near = (index: Map<string, FareOffer[]>, airport: string) =>
    [...index.entries()].filter(([a]) => a === airport || ctx.sameCity(a, airport)).flatMap(([, list]) => list);
  const maxGap = limits.maxLayoverMinutes * 60000;
  const needBefore = 3 * 3600_000;
  const pick = (cands: FareOffer[]) => [...cands].sort((a, b) => ctx.approxCost(a) - ctx.approxCost(b)).slice(0, 2);
  for (const rt of multiSlice) {
    if (rt.slices.length !== 2) continue;
    const [s0, s1] = rt.slices;
    const hub = firstSeg(s0).origin;
    if (isHome(hub)) continue;
    const toDest = lastSeg(s0).destination;
    if (!(out.destinations.has(toDest) || out.altDestinations.has(toDest))) continue;
    if (!(back.origins.has(firstSeg(s1).origin) || back.altOrigins.has(firstSeg(s1).origin))) continue;
    if (!pairAllowed(spec, [depDate(s0), depDate(s1)])) continue;
    const ins = pick(
      near(fromHome, hub).filter((o) => {
        const gap = firstSeg(s0).departureUtc - lastSeg(o.slices[0]).arrivalUtc;
        return gap >= needBefore && gap <= maxGap;
      }),
    );
    if (!ins.length) continue;
    const outs = pick(
      near(toHome, lastSeg(s1).destination).filter((o) => {
        const gap = firstSeg(o.slices[0]).departureUtc - lastSeg(s1).arrivalUtc;
        return gap >= needBefore && gap <= maxGap;
      }),
    );
    for (const i of ins) for (const o of outs) drafts.push([[{ offer: i, slice: 0 }, { offer: rt, slice: 0 }], [{ offer: rt, slice: 1 }, { offer: o, slice: 0 }]]);
  }
  return drafts;
}
