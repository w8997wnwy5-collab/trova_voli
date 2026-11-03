import type { CombineContext, CombineSpec } from '@/lib/engine/combine';
import type { AssembleContext, AssembleJourney } from '@/lib/engine/assemble';
import type { FareOffer, FlightSegment, PassengerCounts } from '@/lib/domain/types';
import { BUNDLED_RATES, convert } from '@/lib/util/fx';
import { haversineKm } from '@/lib/util/geo';
import { money } from '@/lib/util/money';

// Builders for engine tests. All fixture airports use UTC wall-clock times so arithmetic is obvious.

const COUNTRY: Record<string, string> = {
  MXP: 'IT', LIN: 'IT', BGY: 'IT', FCO: 'IT', TRN: 'IT', STN: 'GB', LGW: 'GB', LHR: 'GB', LTN: 'GB', BCN: 'ES', MAD: 'ES',
  CDG: 'FR', ORY: 'FR', JFK: 'US', EWR: 'US', AMS: 'NL', IST: 'TR', ATH: 'GR', ZRH: 'CH', YYZ: 'CA', MEX: 'MX',
};
const CITY: Record<string, string> = {
  MXP: 'Milan', LIN: 'Milan', BGY: 'Milan', STN: 'London', LGW: 'London', LHR: 'London', LTN: 'London', CDG: 'Paris', ORY: 'Paris', JFK: 'New York', EWR: 'New York',
};
const COORDS: Record<string, [number, number]> = {
  MXP: [45.63, 8.73], LIN: [45.45, 9.28], BGY: [45.67, 9.71], TRN: [45.2, 7.65], FCO: [41.8, 12.25], CDG: [49.01, 2.55], ORY: [48.73, 2.36],
  LGW: [51.15, -0.19], STN: [51.89, 0.24], LHR: [51.47, -0.46], LTN: [51.87, -0.37], BCN: [41.3, 2.08], AMS: [52.31, 4.76], JFK: [40.64, -73.78],
};
const METRO: Record<string, string> = { MXP: 'MIL', LIN: 'MIL', BGY: 'MIL', STN: 'LON', LGW: 'LON', LHR: 'LON', LTN: 'LON', CDG: 'PAR', ORY: 'PAR', JFK: 'NYC', EWR: 'NYC' };

export function seg(from: string, to: string, depLocal: string, minutes: number, carrier = 'XX', number = 100): FlightSegment {
  const departureUtc = Date.parse(`${depLocal}:00Z`);
  const arrivalUtc = departureUtc + minutes * 60000;
  return {
    marketingCarrier: { code: carrier, name: `${carrier} Air` },
    flightNumber: `${carrier} ${number}`,
    origin: from,
    destination: to,
    departureLocal: depLocal,
    arrivalLocal: new Date(arrivalUtc).toISOString().slice(0, 16),
    departureUtc,
    arrivalUtc,
    durationMinutes: minutes,
    cabin: 'economy',
  };
}

export interface OfferOpts {
  price: number;
  currency?: string;
  provider?: string;
  carryOn?: number | null;
  checked?: number | null;
  carryOnFee?: number;
  checkedFee?: number;
  bookingFee?: number;
  paymentPercent?: number;
  changeable?: boolean | null;
  seatsLeft?: number;
  dataQuality?: FareOffer['dataQuality'];
  fetchedAt?: number;
  passengers?: PassengerCounts;
  brand?: string;
}

export function offer(id: string, slices: FlightSegment[][], o: OfferOpts): FareOffer {
  const cur = o.currency ?? 'EUR';
  return {
    id,
    providerId: o.provider ?? 'test',
    providerName: o.provider ?? 'Test Provider',
    slices: slices.map((segments) => ({ segments, fareBrand: o.brand })),
    price: { total: money(o.price, cur) },
    passengers: o.passengers ?? { adults: 1, children: 0, infants: 0 },
    baggage: { carryOn: o.carryOn === undefined ? 1 : o.carryOn, checked: o.checked === undefined ? 0 : o.checked },
    bagFees:
      o.carryOnFee !== undefined || o.checkedFee !== undefined
        ? { carryOn: o.carryOnFee !== undefined ? money(o.carryOnFee, cur) : undefined, checked: o.checkedFee !== undefined ? money(o.checkedFee, cur) : undefined, source: 'provider' }
        : undefined,
    bookingFee: o.bookingFee ? money(o.bookingFee, cur) : undefined,
    paymentFee: o.paymentPercent ? { percent: o.paymentPercent } : undefined,
    booking: { channel: 'airline', sellerName: `${o.provider ?? 'Test'} seller` },
    conditions: { refundable: false, changeable: o.changeable ?? false },
    fetchedAt: o.fetchedAt ?? Date.parse('2026-11-03T10:00:00Z'),
    dataQuality: o.dataQuality ?? 'live',
    seatsLeft: o.seatsLeft,
  };
}

export function journey(index: number, origins: string[], destinations: string[], dates: string[], alt: { origins?: Record<string, string>; destinations?: Record<string, string> } = {}): AssembleJourney {
  return {
    index,
    origins: new Set(origins),
    destinations: new Set(destinations),
    altOrigins: new Map(Object.entries(alt.origins ?? {}).map(([code, from]) => [code, { km: 80, from }])),
    altDestinations: new Map(Object.entries(alt.destinations ?? {}).map(([code, from]) => [code, { km: 80, from }])),
    dates,
  };
}

export const sameCity = (a: string, b: string) => a === b || (METRO[a] !== undefined && METRO[a] === METRO[b]);

export function combineCtx(spec: CombineSpec, extra: Partial<CombineContext> = {}): CombineContext {
  return {
    spec,
    approxCost: (o) => convert(o.price.total, 'EUR', BUNDLED_RATES).money.amount,
    sameCity,
    transferMinutes: () => 90,
    allowStopovers: false,
    ...extra,
  };
}

export function assembleCtx(spec: CombineSpec & { journeys: AssembleJourney[] }, extra: Partial<AssembleContext> = {}): AssembleContext {
  return {
    spec,
    currency: 'EUR',
    fx: BUNDLED_RATES,
    passengers: { adults: 1, children: 0, infants: 0 },
    bags: { carryOn: true, checked: 0 },
    now: Date.parse('2026-11-03T10:05:00Z'),
    airport: (code) => (COUNTRY[code] ? { country: COUNTRY[code], city: CITY[code] ?? code, countryName: COUNTRY[code] } : undefined),
    sameCity,
    transfer: (from, to) => ({ minutes: from === to ? 0 : 90, costEur: from === to ? 0 : 20, source: 'heuristic', description: 'Bus' }),
    hotelNightEur: () => 100,
    distanceKm: (a, b) => (COORDS[a] && COORDS[b] ? haversineKm(...COORDS[a], ...COORDS[b]) : undefined),
    entryZone: (c) => (['IT', 'ES', 'FR', 'NL', 'GR', 'CH'].includes(c) ? 'SCHENGEN' : c),
    noAirsideTransit: (c) => c === 'US' || c === 'CA',
    ...extra,
  };
}
