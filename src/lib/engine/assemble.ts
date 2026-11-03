import { daysBetween } from '@/lib/domain/schemas';
import type {
  ConnectionView,
  FareOffer,
  GroundTransferEstimate,
  Itinerary,
  ItineraryAttributes,
  ItineraryTag,
  JourneyView,
  RiskFlag,
  SegmentView,
  TicketView,
} from '@/lib/domain/types';
import { convert } from '@/lib/util/fx';
import { shortHash } from '@/lib/util/hash';
import { money } from '@/lib/util/money';
import { minutesOfDay } from '@/lib/util/time';
import type { CombineJourney, CombineSpec, DraftItinerary } from './combine';
import { bagNeeds, computeCost, seatedTravellers, type CostContext, type ExtraCost } from './cost';
import { assessRisk, isOvernightFlight, isOvernightLayover, missProbability, requiredConnectionMinutes } from './risk';

/** Fixed airport overhead in door-to-door estimates: ~90 min before departure, ~30 min after arrival. */
export const AIRPORT_OVERHEAD_MINUTES = 120;
const STALE_AFTER_MS = 20 * 60_000;

export interface AltRef {
  km: number;
  from: string;
}

export interface AssembleJourney extends CombineJourney {
  altOrigins: Map<string, AltRef>;
  altDestinations: Map<string, AltRef>;
}

export interface AssembleSpec {
  tripType: CombineSpec['tripType'];
  journeys: AssembleJourney[];
  datePairs?: Set<string>;
}

export interface AssembleContext extends CostContext {
  spec: AssembleSpec;
  now: number;
  airport: (code: string) => { country: string; city: string; countryName?: string } | undefined;
  sameCity: (a: string, b: string) => boolean;
  transfer: (from: string, to: string) => { minutes: number; costEur: number; source: 'curated' | 'heuristic'; description: string };
  hotelNightEur: (country: string) => number;
  distanceKm: (a: string, b: string) => number | undefined;
  entryZone: (country: string) => string;
  noAirsideTransit: (country: string) => boolean;
}

const fmtDuration = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? ` ${String(Math.round(min % 60)).padStart(2, '0')}m` : ''}`;

function toEstimate(ctx: AssembleContext, from: string, to: string): GroundTransferEstimate {
  const t = ctx.transfer(from, to);
  return {
    from,
    to,
    minutes: t.minutes,
    cost: convert(money(t.costEur, 'EUR'), ctx.currency, ctx.fx).money,
    source: t.source,
    description: t.description,
  };
}

/** Turns a draft (legs per journey) into a fully described, priced and risk-assessed itinerary. */
export function assemble(draft: DraftItinerary, ctx: AssembleContext): Itinerary | null {
  const offers: FareOffer[] = [];
  const ticketOf = new Map<string, number>();
  for (const legs of draft) {
    for (const leg of legs) {
      if (!ticketOf.has(leg.offer.id)) {
        ticketOf.set(leg.offer.id, offers.length);
        offers.push(leg.offer);
      }
    }
  }
  const travellers = seatedTravellers(ctx.passengers);
  const rooms = Math.max(1, Math.ceil(travellers / 2));
  const checkedBags = ctx.bags.checked > 0;
  const flags: RiskFlag[] = [];
  const extras: ExtraCost[] = [];
  const selfMiss: number[] = [];
  const protMiss: number[] = [];
  let overnightFlights = 0;
  let requiresEntry = false;
  let transitVisaRisk = false;
  let positioning = false;
  let detour = false;

  const journeys: JourneyView[] = draft.map((legs, ji) => {
    const spec = ctx.spec.journeys[ji];
    const segments: SegmentView[] = [];
    const legOf: number[] = [];
    legs.forEach((leg, li) => {
      for (const seg of leg.offer.slices[leg.slice].segments) {
        segments.push({ ...seg, ticket: ticketOf.get(leg.offer.id)! });
        legOf.push(li);
      }
    });
    const first = segments[0];
    const last = segments[segments.length - 1];
    const originZone = ctx.entryZone(ctx.airport(first.origin)?.country ?? '');
    const destZone = ctx.entryZone(ctx.airport(last.destination)?.country ?? '');
    const connections: ConnectionView[] = [];

    for (const seg of segments) {
      if (isOvernightFlight(seg)) {
        overnightFlights++;
        flags.push({ code: 'red-eye', severity: 'info', message: `${seg.flightNumber} ${seg.origin}→${seg.destination} flies overnight.` });
      }
    }

    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const next = segments[i];
      const selfTransfer = legOf[i] !== legOf[i - 1];
      const airportChange = prev.destination !== next.origin;
      const transfer = airportChange ? toEstimate(ctx, prev.destination, next.origin) : undefined;
      const layover = Math.round((next.departureUtc - prev.arrivalUtc) / 60000);
      const conn = ctx.airport(prev.destination);
      const country = conn?.country ?? '';
      const zone = ctx.entryZone(country);
      const passportControl =
        ctx.entryZone(ctx.airport(prev.origin)?.country ?? '') !== zone || (selfTransfer && zone !== ctx.entryZone(ctx.airport(next.destination)?.country ?? ''));
      const input = { prev, next, selfTransfer, transferMinutes: transfer?.minutes ?? 0, checkedBags, passportControl };
      const required = requiredConnectionMinutes(input);
      const miss = missProbability(input, layover);
      const overnight = isOvernightLayover(prev.arrivalLocal, next.departureLocal);
      const longStopover = layover >= 20 * 60;
      const entry = (selfTransfer || airportChange) && zone !== originZone && zone !== destZone;
      const transitVisa = ctx.noAirsideTransit(country) && zone !== originZone && zone !== destZone;
      const notes: string[] = [];
      const city = conn?.city ?? prev.destination;
      const place = airportChange ? `${city} (${prev.destination} → ${next.origin})` : `${city} (${prev.destination})`;

      (selfTransfer ? selfMiss : protMiss).push(miss);
      if (selfTransfer) {
        notes.push('Separate tickets: collect bags, exit and check in again.');
        flags.push({
          code: 'self-transfer',
          severity: layover < required ? 'critical' : 'warning',
          message: `Self-transfer at ${place}: ${fmtDuration(layover)} between flights (recommended ≥ ${fmtDuration(required)}); ≈${Math.max(1, Math.round(miss * 100))}% chance of missing it, with no airline protection.`,
        });
        if (checkedBags) flags.push({ code: 'bag-recheck', severity: 'info', message: `Re-check your bags at ${place}.` });
      }
      if (layover < required && !selfTransfer) {
        flags.push({ code: 'tight-connection', severity: 'warning', message: `Tight connection at ${place}: ${fmtDuration(layover)} (comfortable ≥ ${fmtDuration(required)}).` });
      }
      if (airportChange && transfer) {
        notes.push(`Change airports: ${prev.destination} → ${next.origin}, ${transfer.description.toLowerCase()} (~${fmtDuration(transfer.minutes)}).`);
        flags.push({ code: 'airport-change', severity: 'warning', message: `Airport change ${prev.destination} → ${next.origin} (~${fmtDuration(transfer.minutes)} by ground, estimate).` });
        extras.push({ kind: 'transfer', label: `Ground transfer ${prev.destination} → ${next.origin}`, eurPerUnit: ctx.transfer(prev.destination, next.origin).costEur, units: travellers, note: `${transfer.description}, per person` });
      }
      if (longStopover) {
        const nights = Math.max(1, Math.round(layover / 1440));
        flags.push({ code: 'long-stopover', severity: 'info', message: `Stopover of ${fmtDuration(layover)} in ${conn?.city ?? prev.destination} — time to visit.` });
        extras.push({ kind: 'hotel', label: `Hotel in ${conn?.city ?? prev.destination} (stopover)`, eurPerUnit: ctx.hotelNightEur(country), units: rooms * nights, note: `${rooms} room${rooms > 1 ? 's' : ''} × ${nights} night${nights > 1 ? 's' : ''}, estimate` });
      } else if (overnight) {
        flags.push({ code: 'overnight-layover', severity: selfTransfer ? 'warning' : 'info', message: `Overnight connection at ${place} (arrive ${prev.arrivalLocal.slice(11)}, depart ${next.departureLocal.slice(11)}).` });
        if (layover >= 7 * 60) {
          extras.push({ kind: 'hotel', label: `Hotel in ${conn?.city ?? prev.destination} (overnight)`, eurPerUnit: ctx.hotelNightEur(country), units: rooms, note: `${rooms} room${rooms > 1 ? 's' : ''} × 1 night, estimate` });
        }
      }
      if (entry) {
        requiresEntry = true;
        flags.push({ code: 'entry-required', severity: 'warning', message: `You must enter ${conn?.countryName ?? country} at ${prev.destination}: check visa/ETA rules for your passport.` });
      }
      if (transitVisa) {
        transitVisaRisk = true;
        flags.push({ code: 'transit-visa', severity: 'warning', message: `Connections in ${conn?.countryName ?? country} require clearing immigration (ESTA/eTA or visa) even when transiting.` });
      }
      connections.push({
        kind: selfTransfer ? 'self-transfer' : 'protected',
        arrivalAirport: prev.destination,
        departureAirport: next.origin,
        layoverMinutes: layover,
        requiredMinutes: required,
        airportChange,
        groundTransfer: transfer,
        overnight,
        longStopover,
        missProbability: Math.round(miss * 1000) / 1000,
        country,
        requiresEntry: entry || transitVisa,
        notes,
      });
    }

    // Positioning/detour detection (per journey).
    const direct = ctx.distanceKm(first.origin, last.destination) ?? 0;
    if (legs.length > 1 && direct > 0) {
      const legKm = legs.map((l) => {
        const s = l.offer.slices[l.slice].segments;
        return ctx.distanceKm(s[0].origin, s[s.length - 1].destination) ?? 0;
      });
      const flown = legKm.reduce((a, b) => a + b, 0);
      if (direct >= 2500 && (legKm[0] <= 0.35 * flown || legKm[legKm.length - 1] <= 0.35 * flown)) positioning = true;
      if (flown > direct * 1.35) detour = true;
    }

    const access: GroundTransferEstimate[] = [];
    const altO = spec.altOrigins.get(first.origin);
    if (altO) {
      const t = toEstimate(ctx, altO.from, first.origin);
      access.push(t);
      extras.push({ kind: 'transfer', label: `Getting to ${first.origin} (nearby airport, ${altO.km} km from ${altO.from})`, eurPerUnit: ctx.transfer(altO.from, first.origin).costEur, units: travellers, note: `${t.description}, per person` });
    }
    const altD = spec.altDestinations.get(last.destination);
    if (altD) {
      const t = toEstimate(ctx, last.destination, altD.from);
      access.push(t);
      extras.push({ kind: 'transfer', label: `From ${last.destination} to the ${altD.from} area (nearby airport)`, eurPerUnit: ctx.transfer(last.destination, altD.from).costEur, units: travellers, note: `${t.description}, per person` });
    }
    const flightTime = Math.round((last.arrivalUtc - first.departureUtc) / 60000);
    return {
      index: ji,
      origin: first.origin,
      destination: last.destination,
      departureLocal: first.departureLocal,
      arrivalLocal: last.arrivalLocal,
      departureUtc: first.departureUtc,
      arrivalUtc: last.arrivalUtc,
      flightTimeMinutes: flightTime,
      doorToDoorMinutes: flightTime + AIRPORT_OVERHEAD_MINUTES + access.reduce((s, a) => s + a.minutes, 0),
      stops: segments.length - 1,
      segments,
      connections,
      accessTransfers: access,
    };
  });

  // Tickets
  const tickets: TicketView[] = offers.map((o, i) => {
    const fare = convert(o.price.total, ctx.currency, ctx.fx);
    const journeysCovered = draft.map((legs, ji) => (legs.some((l) => l.offer.id === o.id) ? ji : -1)).filter((x) => x >= 0);
    const ends = o.slices.map((s) => `${s.segments[0].origin}→${s.segments[s.segments.length - 1].destination}`);
    const carriers = new Map<string, string>();
    o.slices.forEach((s) => s.segments.forEach((g) => carriers.set(g.marketingCarrier.code, g.marketingCarrier.name)));
    return {
      index: i,
      offerId: o.id,
      providerId: o.providerId,
      providerName: o.providerName,
      booking: o.booking,
      carriers: [...carriers].map(([code, name]) => ({ code, name })),
      price: fare.money,
      originalPrice: fare.converted ? o.price.total : undefined,
      baggage: o.baggage,
      bagFees: o.bagFees,
      conditions: o.conditions,
      fetchedAt: o.fetchedAt,
      expiresAt: o.expiresAt,
      dataQuality: o.dataQuality,
      journeys: journeysCovered,
      route: ends.join(', '),
      fareBrand: o.slices[0].fareBrand,
      seatsLeft: o.seatsLeft,
    };
  });

  const ticketLabel = (o: FareOffer, i: number) => {
    const brand = o.slices[0].fareBrand ? ` ${o.slices[0].fareBrand}` : '';
    return `Ticket ${i + 1} · ${tickets[i].carriers.map((c) => c.name).join(' + ')}${brand} (${tickets[i].route})`;
  };
  let cost;
  try {
    cost = computeCost(offers.map((o, i) => ({ offer: o, label: ticketLabel(o, i) })), extras, ctx);
  } catch {
    return null; // unknown currency etc. — never show an itinerary we cannot price
  }

  // Ticket-level flags
  const needs = offers.map((o) => bagNeeds(o, ctx));
  const bagsUnknown = needs.some((n) => n.unknownAllowance);
  if (bagsUnknown) flags.push({ code: 'unknown-baggage', severity: 'info', message: 'The provider did not confirm the baggage allowance for every flight; fees are estimated.' });
  const selfTransfers = journeys.reduce((s, j) => s + j.connections.filter((c) => c.kind === 'self-transfer').length, 0);
  if (offers.length > 1 && selfTransfers === 0) {
    flags.push({ code: 'separate-tickets', severity: 'info', message: `${offers.length} separate tickets: a change or cancellation on one does not carry over to the other.` });
  }
  const oldest = Math.min(...offers.map((o) => o.fetchedAt));
  if (offers.some((o) => o.dataQuality !== 'demo' && ctx.now - o.fetchedAt > STALE_AFTER_MS)) {
    flags.push({ code: 'stale-price', severity: 'warning', message: `Prices were checked ${Math.round((ctx.now - oldest) / 60000)} min ago and may have changed.` });
  }
  const minSeats = Math.min(...offers.map((o) => o.seatsLeft ?? 99));
  if (minSeats <= 3) flags.push({ code: 'few-seats', severity: 'info', message: `Only ${minSeats} seat${minSeats > 1 ? 's' : ''} left at this price on one ticket.` });

  const allConnections = journeys.flatMap((j) => j.connections);
  const airportChanges = allConnections.filter((c) => c.airportChange).length;
  const overnightLayovers = allConnections.filter((c) => c.overnight && !c.longStopover).length;
  const longStopovers = allConnections.filter((c) => c.longStopover).length;
  const uniqueFlags = flags.filter((f, i) => flags.findIndex((g) => g.message === f.message) === i);
  const risk = assessRisk({ selfTransferMiss: selfMiss, protectedMiss: protMiss, airportChanges, overnightLayovers, overnightFlights, requiresEntry, transitVisaRisk, flags: uniqueFlags });

  const usesNearbyAirport = journeys.some((j) => j.accessTransfers.length > 0);
  const selfConns = allConnections.filter((c) => c.kind === 'self-transfer');
  const outbound = journeys[0];
  const ret = ctx.spec.journeys.length === 2 && (ctx.spec.tripType === 'return' || ctx.spec.tripType === 'open-jaw') ? journeys[1] : undefined;
  const attrs: ItineraryAttributes = {
    totalCost: cost.total.amount,
    totalMinutes: journeys.reduce((s, j) => s + j.doorToDoorMinutes, 0),
    maxStops: Math.max(...journeys.map((j) => j.stops)),
    totalStops: journeys.reduce((s, j) => s + j.stops, 0),
    maxDoorToDoorMinutes: Math.max(...journeys.map((j) => j.doorToDoorMinutes)),
    ticketCount: offers.length,
    selfTransfers,
    selfTransfersSafe: selfConns.every((c) => !c.airportChange && !c.overnight && c.layoverMinutes >= c.requiredMinutes * 1.25),
    airportChanges,
    airportChangesSameCityOnly: allConnections.filter((c) => c.airportChange).every((c) => ctx.sameCity(c.arrivalAirport, c.departureAirport)),
    overnightFlights,
    overnightLayovers,
    longStopovers,
    minSelfTransferRatio: Math.min(99, ...selfConns.map((c) => c.layoverMinutes / c.requiredMinutes)),
    minProtectedRatio: Math.min(99, ...allConnections.filter((c) => c.kind === 'protected').map((c) => c.layoverMinutes / c.requiredMinutes)),
    bagsIncluded: needs.every((n) => n.included),
    bagsUnknown,
    usesNearbyAirport,
    positioning,
    unusual: positioning || detour || longStopovers > 0,
    requiresEntry,
    transitVisaRisk,
    changeableFare: offers.every((o) => o.conditions?.changeable === true),
    conventional: offers.length === 1 && !usesNearbyAirport && selfTransfers === 0 && airportChanges === 0,
    outboundDate: outbound.departureLocal.slice(0, 10),
    returnDate: ret?.departureLocal.slice(0, 10),
    nights: ret ? daysBetween(outbound.departureLocal.slice(0, 10), ret.departureLocal.slice(0, 10)) : undefined,
    outboundDepartMinutes: minutesOfDay(outbound.departureLocal),
    outboundWeekday: new Date(`${outbound.departureLocal.slice(0, 10)}T00:00:00Z`).getUTCDay(),
    returnDepartMinutes: ret ? minutesOfDay(ret.departureLocal) : undefined,
    returnWeekday: ret ? new Date(`${ret.departureLocal.slice(0, 10)}T00:00:00Z`).getUTCDay() : undefined,
    riskScore: risk.score,
  };

  const tags: ItineraryTag[] = [];
  if (attrs.conventional) tags.push('conventional');
  if (offers.length > 1) tags.push('split-ticket');
  if (selfTransfers > 0) tags.push('self-transfer');
  if (airportChanges > 0) tags.push('airport-change');
  if (usesNearbyAirport) tags.push('nearby-airport');
  if (positioning) tags.push('positioning');
  if (overnightLayovers > 0) tags.push('overnight-layover');
  if (overnightFlights > 0) tags.push('red-eye');
  if (longStopovers > 0) tags.push('long-stopover');
  if (ret && ctx.spec.tripType === 'return' && (!ctx.sameCity(ret.origin, outbound.destination) || !ctx.sameCity(ret.destination, outbound.origin))) {
    tags.push('different-return-airport');
  }
  if (offers.some((o) => o.dataQuality === 'demo')) tags.push('demo');
  if (offers.some((o) => o.dataQuality === 'test')) tags.push('test');

  const reasons: string[] = [];
  let level: 'high' | 'medium' | 'low' = 'high';
  const demote = (to: 'medium' | 'low') => {
    if (to === 'low' || level === 'high') level = to;
  };
  if (tags.includes('demo')) reasons.push('Demo data: synthetic prices and schedules.');
  if (tags.includes('test')) {
    reasons.push('Provider test mode: not real fares.');
    demote('low');
  }
  const ageMin = Math.round((ctx.now - oldest) / 60000);
  if (!tags.includes('demo') && ageMin > 10) {
    reasons.push(`Prices checked ${ageMin} min ago.`);
    demote(ageMin > 30 ? 'low' : 'medium');
  }
  if (cost.estimatedShare > 0.05) {
    reasons.push(`${Math.round(cost.estimatedShare * 100)}% of the total is estimated (bags, transfers or hotel).`);
    demote(cost.estimatedShare > 0.25 ? 'low' : 'medium');
  }
  if (cost.fxNote) {
    reasons.push('Includes a currency conversion.');
    demote('medium');
  }
  if (bagsUnknown) {
    reasons.push('Baggage allowance not confirmed by the provider.');
    demote('medium');
  }
  if (offers.length > 1) {
    reasons.push('Separate tickets are priced independently and can change between bookings.');
    demote('medium');
  }

  const id = shortHash(journeys.map((j) => j.segments.map((s) => `${s.flightNumber}@${s.departureLocal}#${s.ticket}`).join(',')).join('|'));
  return {
    id,
    journeys,
    tickets,
    cost,
    risk,
    attrs,
    tags,
    alternatives: [],
    confidence: { level, reasons, oldestFetchAt: oldest },
  };
}
