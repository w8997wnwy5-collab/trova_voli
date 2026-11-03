import { addDays, weekday, type SearchRequestInput, type SupportedCurrency } from '@/lib/domain/schemas';
import { presetStrategy, type TripStrategy } from '@/lib/domain/strategy';
import type { CabinClass, TripType } from '@/lib/domain/types';
import type { UrlState } from '@/lib/url/search-url';
import type { LocationValue } from './location-input';

export type DateMode = 'exact' | 'flexible' | 'window' | 'month';

export interface FormLeg {
  from: LocationValue | null;
  to: LocationValue | null;
  /** '' = use the default. */
  date: string;
}

export interface SearchFormState {
  tripType: TripType;
  legs: FormLeg[];
  dateMode: DateMode;
  depart: string;
  ret: string;
  flexDays: number;
  windowStart: string;
  windowEnd: string;
  month: string;
  nights: { min: number; max: number };
  adults: number;
  children: number;
  infants: number;
  cabin: CabinClass;
  carryOn: boolean;
  checked: number;
  currency: SupportedCurrency;
  nearby: boolean;
  radiusKm: number;
  strategy: TripStrategy;
}

/** Sensible defaults relative to today: a long weekend about four weeks out. */
export function defaultDates(today: string) {
  let depart = addDays(today, 28);
  while (weekday(depart) !== 5) depart = addDays(depart, 1);
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return {
    depart,
    ret: addDays(depart, 3),
    windowStart: addDays(today, 14),
    windowEnd: addDays(today, 41),
    month: next.toISOString().slice(0, 7),
  };
}

export function emptyForm(): SearchFormState {
  return {
    tripType: 'return',
    legs: [{ from: null, to: null, date: '' }],
    dateMode: 'exact',
    depart: '',
    ret: '',
    flexDays: 2,
    windowStart: '',
    windowEnd: '',
    month: '',
    nights: { min: 3, max: 5 },
    adults: 1,
    children: 0,
    infants: 0,
    cabin: 'economy',
    carryOn: true,
    checked: 0,
    currency: 'EUR',
    nearby: true,
    radiusKm: 120,
    strategy: presetStrategy('balanced'),
  };
}

const loc = (codes: string[] | undefined, labels: Record<string, string>): LocationValue | null =>
  codes && codes[0] ? { code: codes[0], label: labels[codes[0]] ?? codes[0] } : null;

export function formFromUrl(state: UrlState, labels: Record<string, string> = {}): SearchFormState {
  const r = state.request;
  const d = r.dates ?? { mode: 'exact' as const };
  const multi = r.tripType === 'multi-city' || r.tripType === 'open-jaw';
  return {
    ...emptyForm(),
    tripType: r.tripType ?? 'return',
    legs: r.slices.length
      ? r.slices.map((s) => ({ from: loc(s.from, labels), to: loc(s.to, labels), date: s.date ?? '' }))
      : [{ from: null, to: null, date: '' }],
    dateMode: multi && (d.mode === 'window' || d.mode === 'month') ? 'exact' : (d.mode ?? 'exact'),
    depart: d.depart ?? '',
    ret: d.return ?? '',
    flexDays: d.flexDays || 2,
    windowStart: d.windowStart ?? '',
    windowEnd: d.windowEnd ?? '',
    month: d.month ?? '',
    nights: d.nights ?? { min: 3, max: 5 },
    adults: r.passengers?.adults ?? 1,
    children: r.passengers?.children ?? 0,
    infants: r.passengers?.infants ?? 0,
    cabin: r.cabin ?? 'economy',
    carryOn: r.bags?.carryOn ?? true,
    checked: r.bags?.checked ?? 0,
    currency: (r.currency as SupportedCurrency) ?? 'EUR',
    nearby: r.strategy.nearbyAirports.value,
    radiusKm: r.nearbyRadiusKm ?? 120,
    strategy: r.strategy,
  };
}

/** Builds the API request; empty dates fall back to the defaults for `today`. */
export function formToRequest(f: SearchFormState, today: string): SearchRequestInput & { strategy: TripStrategy } {
  const defs = defaultDates(today);
  const multi = f.tripType === 'multi-city' || f.tripType === 'open-jaw';
  const legs = multi ? f.legs : f.legs.slice(0, 1);
  const slices = legs.map((l, i) => ({
    from: l.from ? [l.from.code] : [],
    to: l.to ? [l.to.code] : [],
    date: multi ? l.date || addDays(defs.depart, i * 3) : undefined,
  }));
  const mode = multi && (f.dateMode === 'window' || f.dateMode === 'month') ? 'exact' : f.dateMode;
  const strategy: TripStrategy = { ...f.strategy, nearbyAirports: { ...f.strategy.nearbyAirports, value: f.nearby } };
  return {
    tripType: f.tripType,
    slices,
    dates: {
      mode,
      depart: f.depart || defs.depart,
      return: f.tripType === 'return' ? f.ret || defs.ret : undefined,
      flexDays: mode === 'flexible' ? f.flexDays : 0,
      windowStart: f.windowStart || defs.windowStart,
      windowEnd: f.windowEnd || defs.windowEnd,
      month: f.month || defs.month,
      nights: f.tripType === 'return' ? f.nights : undefined,
    },
    passengers: { adults: f.adults, children: f.children, infants: f.infants },
    cabin: f.cabin,
    bags: { carryOn: f.carryOn, checked: f.checked },
    currency: f.currency,
    nearbyRadiusKm: f.radiusKm,
    strategy,
  };
}
