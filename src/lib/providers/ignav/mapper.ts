import type { FareOffer, FlightSegment, Money, PassengerCounts } from '@/lib/domain/types';
import { money } from '@/lib/util/money';
import { localToUtc } from '@/lib/util/time';
import type { BookingLink, ProviderQuery } from '../types';

// Ignav REST API (https://ignav.com/docs): POST /api/fares/one-way | /api/fares/round-trip, then
// POST /api/fares/booking-links with the itinerary's ignav_id. Field names follow Ignav's published
// docs; the readers below also accept close variants so a renamed field degrades gracefully.

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(o: Json, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (isObj(v)) {
      const inner = text(v, ['code', 'iata_code', 'iata', 'id']);
      if (inner) return inner;
    }
  }
  return undefined;
}

function num(o: Json, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return undefined;
}

/** "2026-12-11T07:05:00+01:00" → "2026-12-11T07:05" (wall-clock part). */
const wallClock = (v: string) => v.slice(0, 16);

/** UTC timestamp; strings without an offset are read as UTC. */
function utcMs(v: string): number {
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`);
}

export function parsePrice(v: unknown): Money | undefined {
  if (isObj(v)) {
    const amount = num(v, ['amount', 'total', 'value']);
    const currency = text(v, ['currency', 'currency_code']);
    if (amount !== undefined && currency && /^[A-Z]{3}$/.test(currency)) return money(amount, currency);
  }
  return undefined;
}

export function buildIgnavSearch(q: ProviderQuery, market: string): { path: string; body: Json } {
  const [out, back] = q.slices;
  const body: Json = {
    origin: out.origin,
    destination: out.destination,
    departure_date: out.departureDate,
    adults: q.passengers.adults,
    cabin_class: q.cabin,
    max_stops: q.maxConnections,
    market,
  };
  // Only send optional fields that are set: Ignav rejects unexpected or empty values.
  if (q.passengers.children) body.children = q.passengers.children;
  if (q.passengers.infants) body.infants_on_lap = q.passengers.infants;
  if (q.bags?.carryOn) body.min_carry_on_bags = 1;
  if (q.bags?.checked) body.min_checked_bags = q.bags.checked;
  if (back) {
    if (back.origin !== out.destination || back.destination !== out.origin) {
      throw new Error('Ignav adapter only supports one-way and round trips');
    }
    return { path: '/fares/round-trip', body: { ...body, return_date: back.departureDate } };
  }
  return { path: '/fares/one-way', body };
}

export interface MapContext {
  now: number;
  passengers: PassengerCounts;
  bags?: ProviderQuery['bags'];
  tzOf: (code: string) => string | undefined;
}

function mapSegment(s: Json, ctx: MapContext): FlightSegment | null {
  const carrier = text(s, ['marketing_carrier_code', 'carrier_code', 'airline_code']);
  const carrierName = text(s, ['marketing_carrier_name', 'carrier_name', 'airline_name']) ?? carrier;
  const flight = text(s, ['flight_number', 'number']);
  const origin = text(s, ['origin', 'departure_airport', 'departure_airport_code', 'origin_airport', 'from']);
  const destination = text(s, ['destination', 'arrival_airport', 'arrival_airport_code', 'destination_airport', 'to']);
  const depLocal = text(s, ['departure_time_local', 'departure_local', 'departure_time']);
  const arrLocal = text(s, ['arrival_time_local', 'arrival_local', 'arrival_time']);
  if (!carrier || !flight || !origin || !destination || !depLocal || !arrLocal) return null;
  const depTz = text(s, ['departure_timezone', 'departure_time_zone', 'origin_timezone']) ?? ctx.tzOf(origin);
  const arrTz = text(s, ['arrival_timezone', 'arrival_time_zone', 'destination_timezone']) ?? ctx.tzOf(destination);
  const depUtcRaw = text(s, ['departure_time_utc', 'departure_utc']);
  const arrUtcRaw = text(s, ['arrival_time_utc', 'arrival_utc']);
  const departureUtc = depUtcRaw ? utcMs(depUtcRaw) : depTz ? localToUtc(wallClock(depLocal), depTz) : NaN;
  const arrivalUtc = arrUtcRaw ? utcMs(arrUtcRaw) : arrTz ? localToUtc(wallClock(arrLocal), arrTz) : NaN;
  if (!Number.isFinite(departureUtc) || !Number.isFinite(arrivalUtc)) return null;
  const operating = text(s, ['operating_carrier_code']);
  return {
    marketingCarrier: { code: carrier, name: carrierName ?? carrier },
    operatingCarrier: operating && operating !== carrier ? { code: operating, name: text(s, ['operating_carrier_name']) ?? operating } : undefined,
    flightNumber: flight.toUpperCase().startsWith(carrier) ? flight : `${carrier} ${flight}`,
    origin,
    destination,
    departureLocal: wallClock(depLocal),
    arrivalLocal: wallClock(arrLocal),
    departureUtc,
    arrivalUtc,
    durationMinutes: num(s, ['duration_minutes', 'duration']) ?? Math.round((arrivalUtc - departureUtc) / 60000),
    cabin: 'economy',
    aircraft: text(s, ['aircraft', 'aircraft_name']),
  };
}

/** Maps one Ignav itinerary to a normalized offer; null when essential data is missing. */
export function mapIgnavItinerary(it: Json, ctx: MapContext, cabin: FareOffer['slices'][number]['segments'][number]['cabin']): FareOffer | null {
  const id = text(it, ['ignav_id']);
  const price = parsePrice(it.price);
  if (!id || !price) return null;
  const legs = [it.outbound, it.inbound].filter(isObj);
  if (!legs.length) return null;
  const slices = [];
  for (const leg of legs) {
    const segs = Array.isArray(leg.segments) ? leg.segments.filter(isObj).map((s) => mapSegment(s, ctx)) : [];
    if (!segs.length || segs.some((s) => s === null)) return null;
    slices.push({ segments: (segs as FlightSegment[]).map((s) => ({ ...s, cabin })) });
  }
  const bags = isObj(it.bags) ? it.bags : {};
  const included = (keys: string[], requested?: number) => {
    const n = num(bags, keys);
    if (n !== undefined) return n;
    // Searched with the user's bags as a filter: the price already covers them.
    return requested ? requested : null;
  };
  const first = slices[0].segments[0];
  return {
    id: `ignav:${id}`,
    providerId: 'ignav',
    providerName: 'Ignav',
    providerOfferId: id,
    slices,
    price: { total: price },
    passengers: ctx.passengers,
    validatingCarrier: first.marketingCarrier,
    baggage: {
      carryOn: included(['carry_on', 'carry_on_bags', 'cabin'], ctx.bags?.carryOn ? 1 : 0),
      checked: included(['checked', 'checked_bags'], ctx.bags?.checked ?? 0),
    },
    booking: {
      channel: 'links',
      sellerName: 'Airline or travel agency',
      handle: id,
      note: 'Live booking pages (airline or agency) are listed when you ask for them.',
    },
    conditions: { refundable: null, changeable: null },
    fetchedAt: ctx.now,
    expiresAt: ctx.now + 30 * 60_000,
    dataQuality: 'live',
    selfTransfer: it.requires_self_transfer === true,
  };
}

function describeLegs(legs: unknown): string | undefined {
  if (!Array.isArray(legs)) return undefined;
  const parts = legs
    .filter(isObj)
    .map((l) => {
      const o = text(l, ['origin', 'departure_airport', 'from']);
      const d = text(l, ['destination', 'arrival_airport', 'to']);
      return o && d ? `${o} → ${d}` : undefined;
    })
    .filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

/** Booking links from `{itinerary, booking_options: [{legs, links: [{provider_name, provider_type, fare_name, price, url}]}]}`. */
export function mapBookingLinks(json: unknown): BookingLink[] {
  const options = isObj(json) && Array.isArray(json.booking_options) ? json.booking_options.filter(isObj) : [];
  const out: BookingLink[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    const legs = describeLegs(option.legs);
    const links = Array.isArray(option.links) ? option.links.filter(isObj) : [];
    for (const l of links) {
      const url = typeof l.url === 'string' ? l.url : '';
      // Only real web pages; keep the URL exactly as given (it carries the selected flight).
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({
        providerName: text(l, ['provider_name', 'name']) ?? 'Booking site',
        providerType: text(l, ['provider_type', 'type']),
        fareName: text(l, ['fare_name']),
        price: parsePrice(l.price),
        url,
        legs,
      });
    }
  }
  return out;
}
