import 'server-only';
import { getAirport, type Airport } from '@/lib/data/airports';
import { GLOBAL_GATEWAYS } from '@/lib/data/hubs';
import { addDays, weekday } from '@/lib/domain/schemas';
import { haversineKm } from '@/lib/util/geo';
import { rand01 } from '@/lib/util/hash';
import { localToUtc, utcToLocal } from '@/lib/util/time';
import { DEMO_AIRLINES, type DemoAirline } from './airlines';

// Deterministic synthetic flight network used by the demo providers. The same inputs always yield the
// same schedule and fares, which keeps the UI, tests and screenshots stable.

const LONG_HAUL_KM = 4200;
const LCC_EXTRA_COUNTRIES = new Set(['ES', 'PT', 'MA', 'TN', 'EG', 'IL', 'JO', 'TR', 'CY', 'GE', 'AM', 'LB', 'DZ']);

export interface DemoFlight {
  airline: DemoAirline;
  flightNumber: string;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
  departureUtc: number;
  arrivalUtc: number;
  durationMinutes: number;
  distanceKm: number;
  aircraft: string;
  /** Adult economy one-way fare for this leg in EUR, before ticket-level multipliers. */
  legFareEur: number;
  seatsLeft: number;
}

export interface DemoItinerary {
  airline: DemoAirline;
  flights: DemoFlight[];
}

function km(a: Airport, b: Airport): number {
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}

const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const routeCache = new Map<string, boolean>();

function inLccArea(a: Airport): boolean {
  return a.continent === 'EU' || LCC_EXTRA_COUNTRIES.has(a.country);
}

function fscServes(airline: DemoAirline, hub: Airport, other: Airport): boolean {
  const d = km(hub, other);
  if (d < 280) return false;
  if (airline.hubs.includes(other.code)) return true;
  const p = rand01('fsc', airline.code, pairKey(hub.code, other.code));
  if (d > LONG_HAUL_KM) return airline.longHaul && GLOBAL_GATEWAYS.has(other.code) && p < 0.62;
  const home = airline.homeCountries.includes(other.country);
  if (other.size === 'L') return p < (home ? 0.95 : 0.7);
  return p < (home ? 0.6 : 0.08);
}

function lccServes(airline: DemoAirline, a: Airport, b: Airport): boolean {
  const aBase = airline.hubs.includes(a.code);
  const bBase = airline.hubs.includes(b.code);
  if (!aBase && !bBase) return false;
  const d = km(a, b);
  const p = rand01('lcc', airline.code, pairKey(a.code, b.code));
  if (airline.kind === 'lcc-longhaul') return aBase && bBase && d > 4000 && a.continent !== b.continent && p < 0.9;
  if (!inLccArea(a) || !inLccArea(b) || d < 300 || d > 3800) return false;
  if (aBase && bBase) return p < 0.7;
  const other = aBase ? b : a;
  if (other.size === 'L') return p < 0.45;
  return p < (airline.homeCountries.includes(other.country) ? 0.32 : 0.12);
}

/** Does the airline fly nonstop between the two airports (both directions)? */
export function routeExists(airline: DemoAirline, from: string, to: string): boolean {
  const key = `${airline.code}|${pairKey(from, to)}`;
  const cached = routeCache.get(key);
  if (cached !== undefined) return cached;
  const a = getAirport(from);
  const b = getAirport(to);
  let exists = false;
  if (a && b && from !== to) {
    if (airline.kind === 'fsc') {
      if (airline.hubs.includes(a.code)) exists = fscServes(airline, a, b);
      else if (airline.hubs.includes(b.code)) exists = fscServes(airline, b, a);
    } else {
      exists = lccServes(airline, a, b);
    }
  }
  routeCache.set(key, exists);
  return exists;
}

const round5 = (n: number) => Math.round(n / 5) * 5;
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

function blockMinutes(a: Airport, b: Airport, d: number): number {
  let lonDiff = b.lon - a.lon;
  if (lonDiff > 180) lonDiff -= 360;
  if (lonDiff < -180) lonDiff += 360;
  const dir = d > 2000 ? (lonDiff > 0 ? 0.97 : 1.06) : 1;
  return round5(28 + (d / 13) * dir);
}

const HUB_DEPARTURE_WAVES = [7 * 60 + 5, 9 * 60 + 40, 12 * 60 + 20, 15 * 60 + 10, 17 * 60 + 55, 20 * 60 + 30];
const HUB_ARRIVAL_WAVES = [8 * 60 + 20, 11 * 60, 13 * 60 + 45, 16 * 60 + 30, 19 * 60 + 15, 21 * 60 + 50];

function dailyFrequency(airline: DemoAirline, a: Airport, b: Airport, d: number, key: string): number {
  const r = rand01('freq', key);
  if (airline.kind === 'lcc-longhaul') return 1;
  if (airline.kind === 'lcc') return r < 0.3 ? 2 : 1;
  if (d > LONG_HAUL_KM) return r < 0.35 ? 2 : 1;
  const bothHubs = airline.hubs.includes(a.code) && airline.hubs.includes(b.code);
  if (bothHubs) return 3 + Math.floor(r * 3);
  const spoke = airline.hubs.includes(a.code) ? b : a;
  return spoke.size === 'L' ? 2 + Math.floor(r * 3) : 1 + Math.floor(r * 2);
}

function operatesOn(airline: DemoAirline, from: string, to: string, date: string): boolean {
  if (airline.kind === 'fsc') return true;
  const bases = airline.hubs.includes(from) && airline.hubs.includes(to);
  return rand01('op', airline.code, pairKey(from, to), weekday(date)) < (bases ? 0.95 : 0.75);
}

function aircraftFor(d: number, key: string): string {
  const r = rand01('ac', key);
  if (d > LONG_HAUL_KM) return r < 0.5 ? 'Airbus A350-900' : 'Boeing 787-9';
  if (d > 2500) return r < 0.5 ? 'Airbus A321neo' : 'Boeing 737 MAX 8';
  return r < 0.4 ? 'Airbus A320' : r < 0.75 ? 'Boeing 737-800' : 'Airbus A220-300';
}

/** Local departure time in minutes after midnight for flight `i` of `n`. */
function departureMinutes(airline: DemoAirline, a: Airport, b: Airport, d: number, duration: number, i: number, n: number, key: string): number {
  const jitter = Math.floor(rand01('jit', key, i) * 5) * 5;
  if (d > LONG_HAUL_KM) {
    let lonDiff = b.lon - a.lon;
    if (lonDiff > 180) lonDiff -= 360;
    if (lonDiff < -180) lonDiff += 360;
    const base = lonDiff > 0 ? 18 * 60 + 10 : 9 * 60 + 50; // eastbound overnight, westbound daytime
    return base + i * 210 + Math.floor(rand01('lh', key, i) * 8) * 15;
  }
  if (airline.kind !== 'fsc') {
    if (n === 1) return 6 * 60 + Math.floor(rand01('lcc', key, i) * 196) * 5;
    return i === 0 ? 6 * 60 + Math.floor(rand01('lcc', key, i) * 60) * 5 : 15 * 60 + 30 + Math.floor(rand01('lcc', key, i) * 70) * 5;
  }
  const fromHub = airline.hubs.includes(a.code);
  const slot = Math.min(HUB_DEPARTURE_WAVES.length - 1, Math.floor(((i + 0.5) * HUB_DEPARTURE_WAVES.length) / n));
  if (fromHub) return HUB_DEPARTURE_WAVES[slot] + jitter;
  // Spoke → hub: time the departure so the flight lands in an arrival wave at the hub.
  const dep = HUB_ARRIVAL_WAVES[slot] - duration - jitter;
  return dep < 5 * 60 + 45 ? dep + 180 : dep;
}

function demandFactor(date: string, depMinutes: number, now: number, key: string): number {
  const daysAhead = Math.max(0, Math.round((Date.parse(`${date}T12:00:00Z`) - now) / 86_400_000));
  const lead = daysAhead <= 3 ? 1.9 : daysAhead <= 7 ? 1.55 : daysAhead <= 14 ? 1.28 : daysAhead <= 30 ? 1.1 : daysAhead <= 60 ? 1 : 0.94;
  const dow = [1.18, 1.04, 0.9, 0.88, 1.0, 1.15, 0.95][weekday(date)];
  const md = date.slice(5);
  const season = md >= '12-18' || md <= '01-06' ? 1.35 : md >= '07-01' && md <= '08-31' ? 1.25 : ['11', '01', '02'].includes(date.slice(5, 7)) ? 0.9 : 1;
  const time = depMinutes < 6 * 60 + 30 || depMinutes > 21 * 60 ? 0.86 : depMinutes < 9 * 60 ? 1.1 : 1;
  const noise = 0.74 + rand01('noise', key) * 0.52;
  return lead * dow * season * time * noise;
}

function legFare(airline: DemoAirline, d: number): number {
  if (airline.kind === 'fsc' && d > LONG_HAUL_KM) return 150 + 0.052 * d;
  return airline.pricing.fixed + airline.pricing.perKm * d;
}

const flightCache = new Map<string, DemoFlight[]>();
const MAX_FLIGHT_CACHE = 50_000;

/** Nonstop flights operated by `airline` from `from` to `to` departing on local date `date`. */
export function flightsOn(airline: DemoAirline, from: string, to: string, date: string, now: number): DemoFlight[] {
  const cacheKey = `${airline.code}|${from}|${to}|${date}|${Math.floor(now / 86_400_000)}`;
  const hit = flightCache.get(cacheKey);
  if (hit) return hit;
  const flights: DemoFlight[] = [];
  const a = getAirport(from);
  const b = getAirport(to);
  if (a && b && routeExists(airline, from, to) && operatesOn(airline, from, to, date)) {
    const d = km(a, b);
    const duration = blockMinutes(a, b, d);
    const routeKey = `${airline.code}|${from}|${to}`;
    const n = dailyFrequency(airline, a, b, d, `${airline.code}|${pairKey(from, to)}`);
    for (let i = 0; i < n; i++) {
      const key = `${routeKey}|${date}|${i}`;
      const depMin = departureMinutes(airline, a, b, d, duration, i, n, `${routeKey}|${i}`);
      const depDate = depMin >= 24 * 60 ? addDays(date, 1) : depMin < 0 ? addDays(date, -1) : date;
      if (depDate !== date) continue;
      const departureLocal = `${date}T${hhmm(depMin)}`;
      const departureUtc = localToUtc(departureLocal, a.tz);
      const arrivalUtc = departureUtc + duration * 60_000;
      const number = 100 + Math.floor(rand01('fn', routeKey, i) * 8900);
      flights.push({
        airline,
        flightNumber: `${airline.code} ${number}`,
        origin: from,
        destination: to,
        departureLocal,
        arrivalLocal: utcToLocal(arrivalUtc, b.tz),
        departureUtc,
        arrivalUtc,
        durationMinutes: duration,
        distanceKm: Math.round(d),
        aircraft: aircraftFor(d, routeKey),
        legFareEur: legFare(airline, d) * demandFactor(date, depMin, now, key),
        seatsLeft: 1 + Math.floor(rand01('seats', key) * 9),
      });
    }
    flights.sort((x, y) => x.departureUtc - y.departureUtc);
  }
  if (flightCache.size > MAX_FLIGHT_CACHE) flightCache.clear();
  flightCache.set(cacheKey, flights);
  return flights;
}

const MIN_CONNECTION = 50;
const MAX_CONNECTION = 5 * 60;
const MAX_OVERNIGHT_CONNECTION = 14 * 60;

/** Single-airline options (nonstop + one connection at the airline's own hubs) for one slice. */
export function sliceOptions(airline: DemoAirline, from: string, to: string, date: string, maxConnections: number, now: number): DemoItinerary[] {
  const out: DemoItinerary[] = flightsOn(airline, from, to, date, now).map((f) => ({ airline, flights: [f] }));
  if (maxConnections < 1 || airline.kind !== 'fsc') return out;
  for (const hub of airline.hubs) {
    if (hub === from || hub === to) continue;
    const first = flightsOn(airline, from, hub, date, now);
    if (!first.length) continue;
    const second = [...flightsOn(airline, hub, to, date, now), ...flightsOn(airline, hub, to, addDays(date, 1), now)];
    if (!second.length) continue;
    for (const f1 of first) {
      const sameDay = second.filter((f2) => {
        const lay = (f2.departureUtc - f1.arrivalUtc) / 60_000;
        return lay >= MIN_CONNECTION && lay <= MAX_CONNECTION;
      });
      const pool = sameDay.length
        ? sameDay.slice(0, 2)
        : second.filter((f2) => {
            const lay = (f2.departureUtc - f1.arrivalUtc) / 60_000;
            return lay > MAX_CONNECTION && lay <= MAX_OVERNIGHT_CONNECTION;
          }).slice(0, 1);
      for (const f2 of pool) out.push({ airline, flights: [f1, f2] });
    }
  }
  return out;
}

export function airlinesSoldBy(soldBy: DemoAirline['soldBy']): DemoAirline[] {
  return DEMO_AIRLINES.filter((a) => a.soldBy === soldBy);
}

export function isLongHaul(it: DemoItinerary): boolean {
  return it.flights.some((f) => f.distanceKm > LONG_HAUL_KM);
}
