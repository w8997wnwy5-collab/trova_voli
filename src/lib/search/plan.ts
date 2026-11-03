import { distanceKm, getAirport, metroOf, METRO_AREAS, nearbyAirports, resolveLocation } from '@/lib/data/airports';
import { CONNECTION_HUBS } from '@/lib/data/hubs';
import { addDays, daysBetween, DEFAULT_NIGHTS, monthDays, todayUtc, type SearchRequest } from '@/lib/domain/schemas';
import type { TripType } from '@/lib/domain/types';
import type { FlightProvider, ProviderQuery } from '@/lib/providers/types';

export interface AltAirport {
  km: number;
  /** Requested airport it is an alternative to. */
  from: string;
}

export interface JourneySpec {
  index: number;
  /** Location codes as requested (airports or metro codes) — used in provider queries. */
  originLocations: string[];
  destinationLocations: string[];
  /** Expanded airports for matching offers. */
  origins: Set<string>;
  destinations: Set<string>;
  altOrigins: Map<string, AltAirport>;
  altDestinations: Map<string, AltAirport>;
  dates: string[];
  centralDate: string;
}

export interface TripSpec {
  tripType: TripType;
  journeys: JourneySpec[];
  /** Allowed "outbound|return" date pairs (return and open-jaw trips). */
  datePairs?: Set<string>;
  passengers: SearchRequest['passengers'];
  cabin: SearchRequest['cabin'];
  currency: string;
  bags: SearchRequest['bags'];
  hubs: string[];
}

export type TaskPurpose = 'primary' | 'flex' | 'nearby' | 'hub' | 'positioning' | 'stopover';

export interface PlannedTask {
  key: string;
  kind: 'ow' | 'rt' | 'mc';
  purpose: TaskPurpose;
  /** Lower runs first; budgets cut from the end. */
  priority: number;
  query: ProviderQuery;
}

export interface PlanLimits {
  nearbyPerSide: number;
  hubs: number;
  maxRtPairs: number;
}

const expand = (codes: string[]) => new Set(codes.flatMap(resolveLocation));

function datesAround(date: string, flex: number, today: string): string[] {
  const out: string[] = [];
  for (let d = -flex; d <= flex; d++) {
    const x = addDays(date, d);
    if (x >= today) out.push(x);
  }
  return out;
}

function byCloseness(dates: string[], central: string): string[] {
  return [...dates].sort((a, b) => Math.abs(daysBetween(central, a)) - Math.abs(daysBetween(central, b)) || a.localeCompare(b));
}

function altMap(reference: Set<string>, radiusKm: number, limit: number, exclude: Set<string>): Map<string, AltAirport> {
  const found = nearbyAirports([...reference], radiusKm, limit + exclude.size).filter((a) => !exclude.has(a.code));
  return new Map(found.slice(0, limit).map((a) => [a.code, { km: a.km, from: a.from }]));
}

/** Expands the request into journeys, date sets and alternative airports. */
export function buildTripSpec(req: SearchRequest, now = Date.now()): TripSpec {
  const today = todayUtc(now);
  const { dates } = req;
  const flex = dates.mode === 'flexible' ? dates.flexDays : 0;
  const manyDates = dates.mode === 'window' || dates.mode === 'month';
  const nearbyLimit = manyDates ? 2 : 3;
  const journeys: JourneySpec[] = [];
  let datePairs: Set<string> | undefined;

  const makeJourney = (index: number, from: string[], to: string[], journeyDates: string[], central: string): JourneySpec => {
    const origins = expand(from);
    const destinations = expand(to);
    const exclude = new Set([...origins, ...destinations]);
    return {
      index,
      originLocations: from,
      destinationLocations: to,
      origins,
      destinations,
      altOrigins: altMap(origins, req.nearbyRadiusKm, nearbyLimit, exclude),
      altDestinations: altMap(destinations, req.nearbyRadiusKm, nearbyLimit, exclude),
      dates: journeyDates,
      centralDate: central,
    };
  };

  if (req.tripType === 'one-way' || req.tripType === 'return') {
    const slice = req.slices[0];
    let outDates: string[] = [];
    let retDates: string[] = [];
    let outCentral = dates.depart ?? today;
    let retCentral = dates.return ?? outCentral;
    if (dates.mode === 'exact' || dates.mode === 'flexible') {
      outDates = datesAround(dates.depart!, flex, today);
      if (req.tripType === 'return') {
        retDates = datesAround(dates.return!, flex, today);
        datePairs = new Set(outDates.flatMap((x) => retDates.filter((y) => y >= x).map((y) => `${x}|${y}`)));
      }
    } else {
      const all = dates.mode === 'window' ? Array.from({ length: daysBetween(dates.windowStart!, dates.windowEnd!) + 1 }, (_, i) => addDays(dates.windowStart!, i)) : monthDays(dates.month!);
      outDates = all.filter((d) => d >= today);
      outCentral = outDates[0] ?? today;
      if (req.tripType === 'return') {
        const nights = dates.nights ?? DEFAULT_NIGHTS;
        datePairs = new Set<string>();
        const ret = new Set<string>();
        for (const x of outDates) {
          for (let n = nights.min; n <= nights.max; n++) {
            const y = addDays(x, n);
            datePairs.add(`${x}|${y}`);
            ret.add(y);
          }
        }
        retDates = [...ret].sort();
        retCentral = retDates[0] ?? outCentral;
      }
    }
    journeys.push(makeJourney(0, slice.from, slice.to, byCloseness(outDates, outCentral), outCentral));
    if (req.tripType === 'return') journeys.push(makeJourney(1, slice.to, slice.from, byCloseness(retDates, retCentral), retCentral));
  } else {
    req.slices.forEach((s, i) => {
      journeys.push(makeJourney(i, s.from, s.to, byCloseness(datesAround(s.date!, flex, today), s.date!), s.date!));
    });
    if (req.tripType === 'open-jaw') {
      datePairs = new Set(journeys[0].dates.flatMap((x) => journeys[1].dates.filter((y) => y >= x).map((y) => `${x}|${y}`)));
    }
  }

  return {
    tripType: req.tripType,
    journeys,
    datePairs,
    passengers: req.passengers,
    cabin: req.cabin,
    currency: req.currency,
    bags: req.bags,
    hubs: [],
  };
}

/** Candidate self-transfer/positioning hubs between two airport sets, best first. */
export function pickHubs(origins: Set<string>, destinations: Set<string>, exclude: Set<string>, limit: number, unusual: boolean): { code: string; positioning: boolean }[] {
  const o = getAirport([...origins][0]);
  const d = getAirport([...destinations][0]);
  if (!o || !d) return [];
  const direct = distanceKm(o.code, d.code) ?? 0;
  if (direct < 250) return [];
  const excludedMetros = new Set([...exclude].map(metroOf).filter(Boolean));
  const maxDetour = (direct < 1200 ? 1.7 : direct < 4000 ? 1.45 : 1.3) + (unusual ? 0.3 : 0);
  const scored: { code: string; score: number; positioning: boolean }[] = [];
  for (const [code, weight] of Object.entries(CONNECTION_HUBS)) {
    if (exclude.has(code) || excludedMetros.has(metroOf(code))) continue;
    const a = distanceKm(o.code, code);
    const b = distanceKm(code, d.code);
    if (a === undefined || b === undefined || a < 150 || b < 150) continue;
    const detour = (a + b) / direct;
    if (detour > maxDetour) continue;
    const positioning = direct > 2500 && a < Math.min(1000, direct * 0.35) && weight >= 0.8;
    scored.push({ code, score: (weight / detour ** 3) * (positioning ? 1.3 : 1), positioning });
  }
  scored.sort((x, y) => y.score - x.score || x.code.localeCompare(y.code));
  return scored.slice(0, limit).map(({ code, positioning }) => ({ code, positioning }));
}

function siblingsOf(airport: string): string[] {
  const m = metroOf(airport);
  return m ? METRO_AREAS[m].airports.filter((a) => a !== airport) : [];
}

/** Turns the trip into prioritised provider tasks (before per-provider budgets). */
export function planTasks(spec: TripSpec, req: SearchRequest): PlannedTask[] {
  const tasks = new Map<string, PlannedTask>();
  // Only the two search-scope flags influence planning. Every other rule is a client-side filter, so
  // the same URL always produces the same candidates and "what if" impacts stay meaningful.
  const { unusualRoutes, longStopovers } = req.strategy;
  const manyDates = spec.journeys[0].dates.length > 10;
  const limits: PlanLimits = { nearbyPerSide: manyDates ? 2 : 3, hubs: unusualRoutes ? 5 : manyDates ? 2 : 3, maxRtPairs: 220 };

  const add = (kind: PlannedTask['kind'], purpose: TaskPurpose, priority: number, slices: ProviderQuery['slices']) => {
    const query: ProviderQuery = {
      slices,
      passengers: spec.passengers,
      cabin: spec.cabin,
      currency: spec.currency,
      maxConnections: kind === 'ow' && purpose === 'hub' ? 1 : 2,
    };
    const key = JSON.stringify([slices, spec.passengers, spec.cabin, spec.currency, query.maxConnections]);
    const existing = tasks.get(key);
    if (!existing || existing.priority > priority) tasks.set(key, { key, kind, purpose, priority, query });
  };
  const seg = (origin: string, destination: string, departureDate: string) => ({ origin, destination, departureDate });

  const hubSet = new Set<string>();
  for (const j of spec.journeys) {
    const altO = [...j.altOrigins.keys()].slice(0, limits.nearbyPerSide);
    const altD = [...j.altDestinations.keys()].slice(0, limits.nearbyPerSide);
    j.dates.forEach((date) => {
      const di = Math.abs(daysBetween(j.centralDate, date));
      for (const o of j.originLocations) {
        for (const d of j.destinationLocations) add('ow', di === 0 ? 'primary' : 'flex', di * 4, [seg(o, d, date)]);
        for (const d of altD) add('ow', 'nearby', 12 + di * 4, [seg(o, d, date)]);
      }
      for (const o of altO) {
        for (const d of j.destinationLocations) add('ow', 'nearby', 12 + di * 4, [seg(o, d, date)]);
        if (!manyDates) for (const d of altD) add('ow', 'nearby', 20 + di * 4, [seg(o, d, date)]);
      }
    });

    const exclude = new Set([...j.origins, ...j.destinations, ...j.altOrigins.keys(), ...j.altDestinations.keys()]);
    const hubs = pickHubs(j.origins, j.destinations, exclude, limits.hubs, unusualRoutes);
    hubs.forEach((h, rank) => {
      hubSet.add(h.code);
      j.dates.forEach((date) => {
        const di = Math.abs(daysBetween(j.centralDate, date));
        const base = 25 + rank * 3 + di * 4;
        for (const o of j.originLocations) add('ow', 'hub', base, [seg(o, h.code, date)]);
        for (const d of j.destinationLocations) {
          add('ow', 'hub', base, [seg(h.code, d, date)]);
          add('ow', 'hub', base + 15, [seg(h.code, d, addDays(date, 1))]);
          if (rank === 0) {
            for (const s of siblingsOf(h.code)) add('ow', 'hub', base + 20, [seg(s, d, date)]);
          }
          if (longStopovers) {
            for (let k = 1; k <= 3; k++) add('ow', 'stopover', 60 + rank * 3 + di * 4 + k, [seg(h.code, d, addDays(date, k))]);
          }
        }
      });
    });
  }
  spec.hubs = [...hubSet];

  // Single tickets covering several journeys.
  if (spec.tripType === 'return' && spec.datePairs) {
    const [out, back] = spec.journeys;
    const pairs = [...spec.datePairs]
      .map((p) => p.split('|') as [string, string])
      .sort(
        (a, b) =>
          Math.abs(daysBetween(out.centralDate, a[0])) + Math.abs(daysBetween(back.centralDate, a[1])) -
            (Math.abs(daysBetween(out.centralDate, b[0])) + Math.abs(daysBetween(back.centralDate, b[1]))) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
      )
      .slice(0, limits.maxRtPairs);
    pairs.forEach(([x, y]) => {
      const dist = Math.abs(daysBetween(out.centralDate, x)) + Math.abs(daysBetween(back.centralDate, y));
      for (const o of out.originLocations) {
        for (const d of out.destinationLocations) {
          add('rt', dist === 0 ? 'primary' : 'flex', dist * 3, [seg(o, d, x), seg(d, o, y)]);
          if (!manyDates) for (const alt of [...out.altDestinations.keys()].slice(0, 2)) add('rt', 'nearby', 16 + dist * 3, [seg(o, alt, x), seg(alt, o, y)]);
        }
        if (!manyDates) for (const alt of [...out.altOrigins.keys()].slice(0, 2)) for (const d of out.destinationLocations) add('rt', 'nearby', 16 + dist * 3, [seg(alt, d, x), seg(d, alt, y)]);
      }
    });
    // Positioning: a cheaper round trip from a big hub, reached with separate one-way flights.
    const longHaul = (distanceKm([...out.origins][0], [...out.destinations][0]) ?? 0) > 2500;
    if (longHaul) {
      const posHubs = pickHubs(out.origins, out.destinations, new Set([...out.origins, ...out.destinations]), 8, true)
        .filter((h) => h.positioning)
        .slice(0, 2);
      posHubs.forEach((h, rank) => {
        hubSet.add(h.code);
        pairs.slice(0, manyDates ? 14 : 25).forEach(([x, y]) => {
          const dist = Math.abs(daysBetween(out.centralDate, x)) + Math.abs(daysBetween(back.centralDate, y));
          const base = 50 + rank * 4 + dist * 3;
          for (const d of out.destinationLocations) add('rt', 'positioning', base, [seg(h.code, d, x), seg(d, h.code, y)]);
          for (const o of out.originLocations) {
            add('ow', 'positioning', base, [seg(o, h.code, x)]);
            add('ow', 'positioning', base + 2, [seg(o, h.code, addDays(x, -1))]);
            add('ow', 'positioning', base, [seg(h.code, o, y)]);
            add('ow', 'positioning', base + 2, [seg(h.code, o, addDays(y, 1))]);
          }
        });
      });
      spec.hubs = [...hubSet];
    }
  }

  if (spec.tripType === 'open-jaw' || spec.tripType === 'multi-city') {
    // A handful of single-ticket date combinations, central dates first.
    const lists = spec.journeys.map((j) => j.dates.slice(0, spec.journeys.length > 2 ? 2 : 3));
    const combos = lists.reduce<string[][]>((acc, l) => acc.flatMap((p) => l.map((d) => [...p, d])), [[]]);
    combos
      .filter((c) => c.every((d, i) => i === 0 || d >= c[i - 1]))
      .slice(0, 12)
      .forEach((c) => {
        const dist = c.reduce((s, d, i) => s + Math.abs(daysBetween(spec.journeys[i].centralDate, d)), 0);
        const slices = spec.journeys.map((j, i) => seg(j.originLocations[0], j.destinationLocations[0], c[i]));
        add('mc', dist === 0 ? 'primary' : 'flex', dist * 3, slices);
      });
  }

  return [...tasks.values()].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

/** Tasks each provider can serve (capabilities + route coverage). */
export function assignTasks(tasks: PlannedTask[], providers: FlightProvider[]): Map<string, PlannedTask[]> {
  const out = new Map<string, PlannedTask[]>();
  for (const p of providers) {
    const cap = p.capabilities;
    out.set(
      p.id,
      tasks.filter((t) => {
        const n = t.query.slices.length;
        if (n > cap.maxSlices) return false;
        if (t.kind === 'rt' && !cap.roundTrip) return false;
        if (t.kind === 'mc' && !cap.multiCity) return false;
        if (!p.supportsRoute) return true;
        return t.query.slices.every((s) => locationsSupported(p, s.origin, s.destination));
      }),
    );
  }
  return out;
}

function locationsSupported(p: FlightProvider, origin: string, destination: string): boolean {
  const os = resolveLocation(origin);
  const ds = resolveLocation(destination);
  return os.some((o) => ds.some((d) => p.supportsRoute!(o, d)));
}
