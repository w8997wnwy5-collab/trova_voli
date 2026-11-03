import { SUPPORTED_CURRENCIES, type SearchRequest, type SearchRequestInput } from '@/lib/domain/schemas';
import {
  PRESET_IDS,
  RULE_KEYS,
  TripStrategySchema,
  presetStrategy,
  type PresetId,
  type RuleKey,
  type TripStrategy,
} from '@/lib/domain/strategy';
import type { SortKey } from '@/lib/engine/rank';

// Shareable, human-readable search URLs. Strategy rules are stored as differences from the preset.

const RULE_CODES: Record<RuleKey, string> = {
  maxStops: 'ms',
  maxDoorToDoorHours: 'dd',
  selfTransfer: 'st',
  airportChange: 'ac',
  connectionSafety: 'cs',
  overnightFlights: 'of',
  overnightLayovers: 'ol',
  bagsIncluded: 'bi',
  splitTickets: 'sp',
  nearbyAirports: 'na',
  avoidEntryRequirements: 'ae',
  flexibleTicket: 'ft',
  weekendTiming: 'wt',
};

const ENUMS: Partial<Record<RuleKey, readonly string[]>> = {
  selfTransfer: ['never', 'safe-only', 'allowed'],
  airportChange: ['never', 'same-city', 'allowed'],
  connectionSafety: ['standard', 'comfortable', 'very-safe'],
  overnightFlights: ['avoid', 'allowed'],
  overnightLayovers: ['avoid', 'allowed'],
};

const SORTS: SortKey[] = ['best', 'cheapest', 'fastest', 'stops', 'risk'];
const CODE = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface UrlState {
  request: SearchRequestInput & { strategy: TripStrategy };
  sort: SortKey;
  date?: string;
  focus?: string;
  simulate?: string;
}

function encodeRuleValue(v: unknown): string {
  if (v === null) return 'none';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

function decodeRuleValue(key: RuleKey, raw: string): unknown {
  if (key === 'maxStops') {
    const n = Number(raw);
    return [0, 1, 2, 3].includes(n) ? n : undefined;
  }
  if (key === 'maxDoorToDoorHours') {
    if (raw === 'none') return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 2 && n <= 72 ? n : undefined;
  }
  const options = ENUMS[key];
  if (options) return options.includes(raw) ? raw : undefined;
  return raw === '1' ? true : raw === '0' ? false : undefined;
}

export function encodeStrategy(s: TripStrategy): [string, string][] {
  const base = presetStrategy(s.preset);
  const out: [string, string][] = [['preset', s.preset]];
  if (s.priority !== base.priority) out.push(['pri', String(s.priority)]);
  for (const key of RULE_KEYS) {
    const r = s[key];
    const b = base[key];
    if (r.value !== b.value || r.mode !== b.mode) out.push([RULE_CODES[key], `${encodeRuleValue(r.value)}.${r.mode === 'hard' ? 'h' : 's'}`]);
  }
  if (s.unusualRoutes !== base.unusualRoutes) out.push(['ur', s.unusualRoutes ? '1' : '0']);
  if (s.longStopovers !== base.longStopovers) out.push(['ls', s.longStopovers ? '1' : '0']);
  if (s.includeHotel !== base.includeHotel) out.push(['ht', s.includeHotel ? '1' : '0']);
  if (s.weights) {
    const w = s.weights;
    out.push(['w', [w.cost, w.duration, w.stops, w.risk, w.airportChanges, w.preferences].map((n) => Math.round(n)).join('.')]);
  }
  return out;
}

export function decodeStrategy(p: URLSearchParams): TripStrategy {
  const presetRaw = p.get('preset');
  const preset: PresetId = (PRESET_IDS as readonly string[]).includes(presetRaw ?? '') ? (presetRaw as PresetId) : 'balanced';
  const s = presetStrategy(preset) as TripStrategy & Record<string, unknown>;
  const pri = Number(p.get('pri'));
  if (p.has('pri') && Number.isInteger(pri) && pri >= 0 && pri <= 100) s.priority = pri;
  for (const key of RULE_KEYS) {
    const raw = p.get(RULE_CODES[key]);
    if (!raw) continue;
    const dot = raw.lastIndexOf('.');
    const value = decodeRuleValue(key, dot > 0 ? raw.slice(0, dot) : raw);
    const mode = raw.slice(dot + 1) === 's' ? 'soft' : 'hard';
    if (value !== undefined) (s as Record<string, unknown>)[key] = { value, mode };
  }
  for (const [code, key] of [['ur', 'unusualRoutes'], ['ls', 'longStopovers'], ['ht', 'includeHotel']] as const) {
    const raw = p.get(code);
    if (raw === '1' || raw === '0') s[key] = raw === '1';
  }
  const w = p.get('w')?.split('.').map(Number);
  if (w && w.length === 6 && w.every((n) => Number.isFinite(n) && n >= 0 && n <= 100) && w.some((n) => n > 0)) {
    s.weights = { cost: w[0], duration: w[1], stops: w[2], risk: w[3], airportChanges: w[4], preferences: w[5] };
  }
  const parsed = TripStrategySchema.safeParse(s);
  return parsed.success ? parsed.data : presetStrategy(preset);
}

const codes = (raw: string | null) =>
  (raw ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => CODE.test(c))
    .slice(0, 3);

const int = (raw: string | null, min: number, max: number, fallback: number) => {
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const date = (raw: string | null) => (raw && DATE.test(raw) ? raw : undefined);

export function decodeSearch(p: URLSearchParams): UrlState {
  const tripRaw = p.get('trip');
  const tripType = (['one-way', 'return', 'multi-city', 'open-jaw'] as const).find((t) => t === tripRaw) ?? 'return';
  let slices: SearchRequestInput['slices'];
  if (tripType === 'multi-city' || tripType === 'open-jaw') {
    slices = (p.get('legs') ?? '')
      .split(',')
      .map((leg) => leg.split(':'))
      .filter((parts) => parts.length === 3)
      .slice(0, 5)
      .map(([from, to, d]) => ({ from: codes(from), to: codes(to), date: date(d) }));
  } else {
    slices = [{ from: codes(p.get('from')), to: codes(p.get('to')) }];
  }
  const modeRaw = p.get('mode');
  const mode = (['exact', 'flexible', 'window', 'month'] as const).find((m) => m === modeRaw) ?? 'exact';
  const nightsRaw = p.get('nights')?.split('-').map(Number);
  const nights =
    nightsRaw && nightsRaw.length === 2 && nightsRaw.every((n) => Number.isInteger(n) && n >= 1 && n <= 30) ? { min: nightsRaw[0], max: nightsRaw[1] } : undefined;
  const month = p.get('month');
  const currency = (SUPPORTED_CURRENCIES as readonly string[]).includes(p.get('cur') ?? '') ? (p.get('cur') as SearchRequest['currency']) : 'EUR';
  const cabinRaw = p.get('cabin');
  const cabin = (['economy', 'premium_economy', 'business', 'first'] as const).find((c) => c === cabinRaw) ?? 'economy';
  const sortRaw = p.get('sort') as SortKey | null;
  return {
    request: {
      tripType,
      slices,
      dates: {
        mode,
        depart: date(p.get('depart')),
        return: date(p.get('return')),
        flexDays: int(p.get('flex'), 0, 3, mode === 'flexible' ? 2 : 0),
        windowStart: date(p.get('start')),
        windowEnd: date(p.get('end')),
        month: month && /^\d{4}-\d{2}$/.test(month) ? month : undefined,
        nights,
      },
      passengers: { adults: int(p.get('adults'), 1, 9, 1), children: int(p.get('children'), 0, 8, 0), infants: int(p.get('infants'), 0, 4, 0) },
      cabin,
      bags: { carryOn: p.get('cb') !== '0', checked: int(p.get('ck'), 0, 2, 0) },
      currency,
      nearbyRadiusKm: int(p.get('radius'), 0, 300, 120),
      strategy: decodeStrategy(p),
    },
    sort: sortRaw && SORTS.includes(sortRaw) ? sortRaw : 'best',
    date: date(p.get('date')),
    focus: p.get('focus')?.slice(0, 20) || undefined,
    simulate: p.get('simulate')?.slice(0, 60) || undefined,
  };
}

function q(pairs: [string, string | undefined][]): string {
  return pairs
    .filter((pair): pair is [string, string] => pair[1] !== undefined && pair[1] !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',').replace(/%3A/g, ':')}`)
    .join('&');
}

/** Query string (without "?") for a search. */
export function encodeSearch(state: Omit<UrlState, 'sort'> & { sort?: SortKey }): string {
  const r = state.request;
  const d = r.dates ?? { mode: 'exact' as const };
  const multi = r.tripType === 'multi-city' || r.tripType === 'open-jaw';
  const pairs: [string, string | undefined][] = [['trip', r.tripType ?? 'return']];
  if (multi) pairs.push(['legs', r.slices.map((s) => `${s.from[0] ?? ''}:${s.to[0] ?? ''}:${s.date ?? ''}`).join(',')]);
  else pairs.push(['from', r.slices[0]?.from.join(',')], ['to', r.slices[0]?.to.join(',')]);
  pairs.push(['mode', d.mode]);
  if (d.mode === 'exact' || d.mode === 'flexible' || multi) {
    if (!multi) pairs.push(['depart', d.depart], ['return', r.tripType === 'return' ? d.return : undefined]);
    if (d.mode === 'flexible') pairs.push(['flex', String(d.flexDays ?? 2)]);
  } else if (d.mode === 'window') pairs.push(['start', d.windowStart], ['end', d.windowEnd]);
  else pairs.push(['month', d.month]);
  if ((d.mode === 'window' || d.mode === 'month') && r.tripType === 'return' && d.nights) pairs.push(['nights', `${d.nights.min}-${d.nights.max}`]);
  const p = r.passengers ?? { adults: 1, children: 0, infants: 0 };
  pairs.push(['adults', String(p.adults ?? 1)]);
  if (p.children) pairs.push(['children', String(p.children)]);
  if (p.infants) pairs.push(['infants', String(p.infants)]);
  if (r.cabin && r.cabin !== 'economy') pairs.push(['cabin', r.cabin]);
  if (r.bags?.carryOn === false) pairs.push(['cb', '0']);
  if (r.bags?.checked) pairs.push(['ck', String(r.bags.checked)]);
  pairs.push(['cur', r.currency ?? 'EUR']);
  if (r.nearbyRadiusKm !== undefined && r.nearbyRadiusKm !== 120) pairs.push(['radius', String(r.nearbyRadiusKm)]);
  pairs.push(...encodeStrategy(r.strategy));
  if (state.sort && state.sort !== 'best') pairs.push(['sort', state.sort]);
  pairs.push(['date', state.date], ['focus', state.focus], ['simulate', state.simulate]);
  return q(pairs);
}

/** Identity of the provider search. Strategy rules are client-side filters, except the two flags
 * that widen the search scope. Sorting and view state are excluded. */
export function searchKey(state: UrlState): string {
  const { strategy, ...rest } = state.request;
  return JSON.stringify({ ...rest, scope: [strategy.unusualRoutes, strategy.longStopovers] });
}
