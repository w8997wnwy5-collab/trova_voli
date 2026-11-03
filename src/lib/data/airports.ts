import 'server-only';
import type { AirportInfo } from '@/lib/domain/types';
import { haversineKm } from '@/lib/util/geo';
import rawAirports from './airports.json';
import countries from './countries.json';

// Tuple layout written by scripts/build-airports.mjs
type RawAirport = [string, string, string, string, string, number, number, string, 'L' | 'M'];

export interface Airport extends AirportInfo {
  tz: string;
  lat: number;
  lon: number;
  size: 'L' | 'M';
  continent: string;
}

/** Metropolitan areas with their own IATA city code (only codes that are not also airport codes). */
export const METRO_AREAS: Record<string, { name: string; country: string; airports: string[] }> = {
  LON: { name: 'London', country: 'GB', airports: ['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN'] },
  PAR: { name: 'Paris', country: 'FR', airports: ['CDG', 'ORY', 'BVA'] },
  MIL: { name: 'Milan', country: 'IT', airports: ['MXP', 'LIN', 'BGY'] },
  ROM: { name: 'Rome', country: 'IT', airports: ['FCO', 'CIA'] },
  STO: { name: 'Stockholm', country: 'SE', airports: ['ARN', 'BMA', 'NYO'] },
  BUH: { name: 'Bucharest', country: 'RO', airports: ['OTP', 'BBU'] },
  MOW: { name: 'Moscow', country: 'RU', airports: ['SVO', 'DME', 'VKO'] },
  NYC: { name: 'New York', country: 'US', airports: ['JFK', 'EWR', 'LGA'] },
  WAS: { name: 'Washington', country: 'US', airports: ['IAD', 'DCA', 'BWI'] },
  CHI: { name: 'Chicago', country: 'US', airports: ['ORD', 'MDW'] },
  QDF: { name: 'Dallas', country: 'US', airports: ['DFW', 'DAL'] },
  YTO: { name: 'Toronto', country: 'CA', airports: ['YYZ', 'YTZ'] },
  SAO: { name: 'São Paulo', country: 'BR', airports: ['GRU', 'CGH', 'VCP'] },
  RIO: { name: 'Rio de Janeiro', country: 'BR', airports: ['GIG', 'SDU'] },
  BUE: { name: 'Buenos Aires', country: 'AR', airports: ['EZE', 'AEP'] },
  TYO: { name: 'Tokyo', country: 'JP', airports: ['HND', 'NRT'] },
  OSA: { name: 'Osaka', country: 'JP', airports: ['KIX', 'ITM'] },
  SEL: { name: 'Seoul', country: 'KR', airports: ['ICN', 'GMP'] },
  BJS: { name: 'Beijing', country: 'CN', airports: ['PEK', 'PKX'] },
  JKT: { name: 'Jakarta', country: 'ID', airports: ['CGK', 'HLP'] },
  TCI: { name: 'Tenerife', country: 'ES', airports: ['TFS', 'TFN'] },
};

/** Airports whose municipality in the source data is a suburb or a messy label. */
const CITY_OVERRIDES: Record<string, string> = {
  ATH: 'Athens', BGY: 'Milan Bergamo', BRU: 'Brussels', BSL: 'Basel/Mulhouse', BVA: 'Paris Beauvais', CDG: 'Paris',
  CGN: 'Cologne', CIA: 'Rome', CRL: 'Brussels Charleroi', EDI: 'Edinburgh', EZE: 'Buenos Aires', FLR: 'Florence',
  GOA: 'Genoa', HEL: 'Helsinki', HHN: 'Frankfurt-Hahn', IAD: 'Washington', KRK: 'Kraków', KUL: 'Kuala Lumpur',
  LCY: 'London', LGW: 'London', LHR: 'London', LIN: 'Milan', LTN: 'London', LYS: 'Lyon', MLA: 'Malta',
  MRS: 'Marseille', MXP: 'Milan', NAP: 'Naples', NRT: 'Tokyo', NYO: 'Stockholm Skavsta', ORY: 'Paris',
  OSL: 'Oslo', OTP: 'Bucharest', PSA: 'Pisa', PVG: 'Shanghai', SAW: 'Istanbul', SEN: 'London', SKP: 'Skopje',
  STN: 'London', SYD: 'Sydney', TIA: 'Tirana', TLS: 'Toulouse', TRF: 'Oslo Torp', RYG: 'Oslo Rygge',
  WMI: 'Warsaw Modlin', ZAG: 'Zagreb', VRN: 'Verona', TSF: 'Treviso', TRN: 'Turin', BLQ: 'Bologna', VCE: 'Venice',
  BHX: 'Birmingham', MAN: 'Manchester', NCE: 'Nice', FUE: 'Fuerteventura', ACE: 'Lanzarote', LPA: 'Gran Canaria',
  IBZ: 'Ibiza', TFS: 'Tenerife', TFN: 'Tenerife', OLB: 'Olbia', GIG: 'Rio de Janeiro', KEF: 'Reykjavík',
  JFK: 'New York', EWR: 'New York', LGA: 'New York', DCA: 'Washington', BWI: 'Baltimore', DMK: 'Bangkok',
  HND: 'Tokyo', ICN: 'Seoul', GMP: 'Seoul', KIX: 'Osaka', ITM: 'Osaka', PEK: 'Beijing', PKX: 'Beijing',
  CGK: 'Jakarta', DEL: 'Delhi', BMA: 'Stockholm', ARN: 'Stockholm', DME: 'Moscow', SVO: 'Moscow', VKO: 'Moscow',
  GRU: 'São Paulo', CGH: 'São Paulo', VCP: 'Campinas', SDU: 'Rio de Janeiro', AEP: 'Buenos Aires',
  YYZ: 'Toronto', YTZ: 'Toronto', YUL: 'Montréal', DFW: 'Dallas', DAL: 'Dallas', ORD: 'Chicago', MDW: 'Chicago',
};

function cleanCity(code: string, municipality: string, name: string): string {
  const override = CITY_OVERRIDES[code];
  if (override) return override;
  let city = municipality.replace(/\s*\(.*?\)\s*/g, ' ').split(/[,/]/)[0].trim();
  if (!city) city = name.replace(/\s+(International\s+)?Airport.*$/i, '').trim();
  return city;
}

const METRO_BY_AIRPORT = new Map<string, string>();
for (const [code, m] of Object.entries(METRO_AREAS)) for (const a of m.airports) METRO_BY_AIRPORT.set(a, code);

const COUNTRY_NAMES = countries as Record<string, string>;

const AIRPORTS = new Map<string, Airport>();
for (const r of rawAirports as RawAirport[]) {
  const [code, name, municipality, country, continent, lat, lon, tz, size] = r;
  AIRPORTS.set(code, {
    code,
    name,
    city: cleanCity(code, municipality, name),
    country,
    countryName: COUNTRY_NAMES[country] ?? country,
    continent,
    lat,
    lon,
    tz,
    size,
    metro: METRO_BY_AIRPORT.get(code),
  });
}

export function getAirport(code: string): Airport | undefined {
  return AIRPORTS.get(code);
}

export function allAirports(): Iterable<Airport> {
  return AIRPORTS.values();
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

export function isMetroCode(code: string): boolean {
  return code in METRO_AREAS;
}

export function metroOf(airport: string): string | undefined {
  return METRO_BY_AIRPORT.get(airport);
}

const sameCityCache = new Map<string, boolean>();

/** Two airports serve the same city (same metro area, or same cleaned city name within 60 km). */
export function sameCity(a: string, b: string): boolean {
  if (a === b) return true;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  let v = sameCityCache.get(key);
  if (v === undefined) {
    v = computeSameCity(a, b);
    if (sameCityCache.size > 100_000) sameCityCache.clear();
    sameCityCache.set(key, v);
  }
  return v;
}

function computeSameCity(a: string, b: string): boolean {
  const ma = metroOf(a);
  if (ma && ma === metroOf(b)) return true;
  const x = getAirport(a);
  const y = getAirport(b);
  if (!x || !y) return false;
  return x.city === y.city && haversineKm(x.lat, x.lon, y.lat, y.lon) < 60;
}

/** Expands a city or airport code into airport codes known to the dataset. */
export function resolveLocation(code: string): string[] {
  const metro = METRO_AREAS[code];
  if (metro) return metro.airports.filter((a) => AIRPORTS.has(a));
  return AIRPORTS.has(code) ? [code] : [];
}

export function distanceKm(a: string, b: string): number | undefined {
  const x = getAirport(a);
  const y = getAirport(b);
  if (!x || !y) return undefined;
  return haversineKm(x.lat, x.lon, y.lat, y.lon);
}

/** Alternative airports within `radiusKm` of any reference airport, closest first. */
export function nearbyAirports(reference: string[], radiusKm: number, limit = 4): { code: string; km: number; from: string }[] {
  if (radiusKm <= 0) return [];
  const refs = reference.map(getAirport).filter((a): a is Airport => Boolean(a));
  const out: { code: string; km: number; from: string; size: 'L' | 'M' }[] = [];
  for (const a of AIRPORTS.values()) {
    if (reference.includes(a.code)) continue;
    let best: { km: number; from: string } | undefined;
    for (const r of refs) {
      const km = haversineKm(r.lat, r.lon, a.lat, a.lon);
      if (km <= radiusKm && (!best || km < best.km)) best = { km, from: r.code };
    }
    if (best) out.push({ code: a.code, km: Math.round(best.km), from: best.from, size: a.size });
  }
  // Prefer large airports, then distance; deterministic tie-break on code.
  out.sort((x, y) => (x.size === y.size ? x.km - y.km || x.code.localeCompare(y.code) : x.size === 'L' ? -1 : 1));
  return out.slice(0, limit).map(({ code, km, from }) => ({ code, km, from }));
}

export interface LocationSuggestion {
  code: string;
  kind: 'city' | 'airport';
  label: string;
  detail: string;
  country: string;
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Autocomplete over metro areas and airports. */
export function searchLocations(query: string, limit = 8): LocationSuggestion[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const results: { s: LocationSuggestion; score: number }[] = [];
  for (const [code, m] of Object.entries(METRO_AREAS)) {
    const name = fold(m.name);
    let score = -1;
    if (fold(code) === q) score = 100;
    else if (name === q) score = 95;
    else if (name.startsWith(q)) score = 80;
    if (score >= 0) {
      results.push({
        score,
        s: { code, kind: 'city', label: `${m.name} (all airports)`, detail: m.airports.join(', '), country: m.country },
      });
    }
  }
  for (const a of AIRPORTS.values()) {
    const city = fold(a.city);
    const name = fold(a.name);
    let score = -1;
    if (fold(a.code) === q) score = 90;
    else if (city === q) score = 70;
    else if (city.startsWith(q)) score = 60;
    else if (name.startsWith(q)) score = 50;
    else if (q.length >= 3 && (name.includes(q) || city.includes(q))) score = 30;
    if (score >= 0) {
      if (a.size === 'L') score += 5;
      results.push({
        score,
        s: { code: a.code, kind: 'airport', label: `${a.city} (${a.code})`, detail: a.name, country: a.country },
      });
    }
  }
  results.sort((x, y) => y.score - x.score || x.s.code.localeCompare(y.s.code));
  return results.slice(0, limit).map((r) => r.s);
}

export function describeLocation(code: string): string {
  const metro = METRO_AREAS[code];
  if (metro) return `${metro.name} (all airports)`;
  const a = AIRPORTS.get(code);
  return a ? `${a.city} (${a.code})` : code;
}

export function airportInfo(code: string): AirportInfo {
  const a = AIRPORTS.get(code);
  if (!a) return { code, name: code, city: code, country: '' };
  return { code: a.code, name: a.name, city: a.city, country: a.country, countryName: a.countryName, tz: a.tz, lat: a.lat, lon: a.lon, metro: a.metro };
}
