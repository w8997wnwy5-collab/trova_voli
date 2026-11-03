import type { CabinClass, FareOffer, FlightSegment, PassengerCounts } from '@/lib/domain/types';
import { money } from '@/lib/util/money';
import { localToUtc, parseIsoDuration } from '@/lib/util/time';
import type { ProviderQuery } from '../types';

// Subset of Duffel API v2 types we rely on (see duffelhq/duffel-api-javascript OfferTypes.ts).

interface DuffelPlace {
  iata_code: string;
  name?: string;
  time_zone?: string | null;
  city_name?: string | null;
  iata_country_code?: string | null;
}

interface DuffelCarrier {
  iata_code: string | null;
  name: string;
}

interface DuffelSegmentPassenger {
  passenger_id: string;
  cabin_class: CabinClass;
  baggages: { type: 'carry_on' | 'checked'; quantity: number }[];
}

interface DuffelSegment {
  origin: DuffelPlace;
  destination: DuffelPlace;
  departing_at: string;
  arriving_at: string;
  duration: string | null;
  marketing_carrier: DuffelCarrier;
  marketing_carrier_flight_number: string;
  operating_carrier?: DuffelCarrier | null;
  aircraft?: { name?: string | null } | null;
  distance?: string | null;
  passengers: DuffelSegmentPassenger[];
}

interface DuffelCondition {
  allowed: boolean;
}

export interface DuffelOffer {
  id: string;
  live_mode: boolean;
  total_amount: string;
  total_currency: string;
  base_amount?: string | null;
  base_currency?: string | null;
  tax_amount?: string | null;
  tax_currency?: string | null;
  expires_at?: string | null;
  owner: DuffelCarrier;
  passengers: { id: string; type?: string | null; age?: number | null }[];
  slices: { fare_brand_name?: string | null; segments: DuffelSegment[] }[];
  conditions?: { refund_before_departure?: DuffelCondition | null; change_before_departure?: DuffelCondition | null } | null;
  partial?: boolean;
}

export interface DuffelOfferRequestResponse {
  data: { id: string; live_mode: boolean; offers?: DuffelOffer[] };
}

/** Assumed age for children when building Duffel passenger lists (we do not collect ages). */
export const DEFAULT_CHILD_AGE = 8;

export function buildOfferRequestBody(q: ProviderQuery, childAge = DEFAULT_CHILD_AGE) {
  const passengers = [
    ...Array.from({ length: q.passengers.adults }, () => ({ type: 'adult' as const })),
    ...Array.from({ length: q.passengers.children }, () => ({ age: childAge })),
    ...Array.from({ length: q.passengers.infants }, () => ({ age: 1 })),
  ];
  return {
    data: {
      slices: q.slices.map((s) => ({
        origin: s.origin,
        destination: s.destination,
        departure_date: s.departureDate,
        departure_time: null,
        arrival_time: null,
      })),
      passengers,
      cabin_class: q.cabin,
      max_connections: q.maxConnections,
    },
  };
}

function toLocal(value: string): string {
  // "2026-12-12T08:35:00" → "2026-12-12T08:35"
  return value.slice(0, 16);
}

export interface MapContext {
  providerId: string;
  providerName: string;
  now: number;
  passengers: PassengerCounts;
  /** Fallback time zone lookup for airports (when Duffel omits time_zone). */
  tzOf: (code: string) => string | undefined;
}

function mapSegment(s: DuffelSegment, ctx: MapContext): FlightSegment | null {
  const originTz = s.origin.time_zone || ctx.tzOf(s.origin.iata_code);
  const destTz = s.destination.time_zone || ctx.tzOf(s.destination.iata_code);
  if (!originTz || !destTz || !s.marketing_carrier?.iata_code) return null;
  const departureLocal = toLocal(s.departing_at);
  const arrivalLocal = toLocal(s.arriving_at);
  const departureUtc = localToUtc(departureLocal, originTz);
  const arrivalUtc = localToUtc(arrivalLocal, destTz);
  const duration = parseIsoDuration(s.duration) ?? Math.round((arrivalUtc - departureUtc) / 60000);
  const cabin = s.passengers[0]?.cabin_class ?? 'economy';
  const operating = s.operating_carrier?.iata_code ? { code: s.operating_carrier.iata_code, name: s.operating_carrier.name } : undefined;
  return {
    marketingCarrier: { code: s.marketing_carrier.iata_code, name: s.marketing_carrier.name },
    operatingCarrier: operating && operating.code !== s.marketing_carrier.iata_code ? operating : undefined,
    flightNumber: `${s.marketing_carrier.iata_code} ${s.marketing_carrier_flight_number}`,
    origin: s.origin.iata_code,
    destination: s.destination.iata_code,
    departureLocal,
    arrivalLocal,
    departureUtc,
    arrivalUtc,
    durationMinutes: duration,
    cabin,
    aircraft: s.aircraft?.name ?? undefined,
    distanceKm: s.distance ? Math.round(Number(s.distance)) : undefined,
  };
}

/** Baggage included for the first adult, minimum across all segments (conservative). */
function includedBags(o: DuffelOffer): { carryOn: number | null; checked: number | null } {
  const adult = o.passengers.find((p) => p.type === 'adult' || (p.age ?? 0) >= 12) ?? o.passengers[0];
  if (!adult) return { carryOn: null, checked: null };
  let carryOn: number | null = null;
  let checked: number | null = null;
  for (const slice of o.slices) {
    for (const seg of slice.segments) {
      const entry = seg.passengers.find((p) => p.passenger_id === adult.id);
      if (!entry) return { carryOn: null, checked: null };
      const c = entry.baggages.filter((b) => b.type === 'carry_on').reduce((s, b) => s + b.quantity, 0);
      const k = entry.baggages.filter((b) => b.type === 'checked').reduce((s, b) => s + b.quantity, 0);
      carryOn = carryOn === null ? c : Math.min(carryOn, c);
      checked = checked === null ? k : Math.min(checked, k);
    }
  }
  return { carryOn, checked };
}

export function mapDuffelOffer(o: DuffelOffer, ctx: MapContext): FareOffer | null {
  if (o.partial) return null; // partial offers need a second selection step we do not implement
  const slices = [];
  for (const slice of o.slices) {
    const segments = slice.segments.map((s) => mapSegment(s, ctx));
    if (segments.some((s) => s === null) || segments.length === 0) return null;
    slices.push({ segments: segments as FlightSegment[], fareBrand: slice.fare_brand_name ?? undefined });
  }
  const total = money(o.total_amount, o.total_currency);
  const owner = o.owner?.iata_code ? { code: o.owner.iata_code, name: o.owner.name } : undefined;
  return {
    id: `${ctx.providerId}:${o.id}`,
    providerId: ctx.providerId,
    providerName: ctx.providerName,
    providerOfferId: o.id,
    slices,
    price: {
      total,
      base: o.base_amount && o.base_currency ? money(o.base_amount, o.base_currency) : undefined,
      taxes: o.tax_amount && o.tax_currency ? money(o.tax_amount, o.tax_currency) : undefined,
    },
    passengers: ctx.passengers,
    validatingCarrier: owner,
    baggage: includedBags(o),
    booking: {
      channel: 'api',
      sellerName: `${o.owner?.name ?? 'Airline'} via Duffel`,
      note: 'Bookable through the Duffel Orders API; booking is not implemented in Flight Hacker.',
    },
    conditions: {
      refundable: o.conditions?.refund_before_departure ? o.conditions.refund_before_departure.allowed : null,
      changeable: o.conditions?.change_before_departure ? o.conditions.change_before_departure.allowed : null,
    },
    fetchedAt: ctx.now,
    expiresAt: o.expires_at ? Date.parse(o.expires_at) : undefined,
    dataQuality: o.live_mode ? 'live' : 'test',
  };
}
