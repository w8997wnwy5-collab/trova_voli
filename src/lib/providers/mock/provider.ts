import 'server-only';
import type { CabinClass, FareOffer, FareSlice, PassengerCounts } from '@/lib/domain/types';
import { getAirport, resolveLocation } from '@/lib/data/airports';
import { BUNDLED_RATES, convert } from '@/lib/util/fx';
import { rand01, shortHash } from '@/lib/util/hash';
import { money } from '@/lib/util/money';
import type { FlightProvider, ProviderCapabilities, ProviderContext, ProviderLimits, ProviderQuery } from '../types';
import { ProviderError } from '../types';
import type { DemoAirline } from './airlines';
import { airlinesSoldBy, flightsOn, isLongHaul, routeExists, sliceOptions, type DemoItinerary } from './world';

export type MockPersonality = 'network' | 'budget';

export interface MockProviderOptions {
  id: string;
  name: string;
  personality: MockPersonality;
  /** Simulated latency range in ms. */
  latencyMs?: [number, number];
}

const OFFER_TTL_MS = 30 * 60_000;
const CABIN_MULTIPLIER: Record<CabinClass, number> = { economy: 1, premium_economy: 1.75, business: 3.4, first: 6.5 };
const OTA_NAME = 'Demo Budget Finder (OTA)';
const DEMO_NOTE = 'Demo data — fictional airline, not bookable';

interface PricedOption {
  slices: DemoItinerary[];
  adultEur: number;
  brand: { name: string; checked: number; carryOn: number; changeable: boolean; refundable: boolean };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ProviderError('Aborted', 'timeout'));
    });
  });
}

function toSlice(it: DemoItinerary, cabin: CabinClass, brand?: string): FareSlice {
  return {
    fareBrand: brand,
    segments: it.flights.map((f) => ({
      marketingCarrier: { code: f.airline.code, name: f.airline.name },
      flightNumber: f.flightNumber,
      origin: f.origin,
      destination: f.destination,
      departureLocal: f.departureLocal,
      arrivalLocal: f.arrivalLocal,
      departureUtc: f.departureUtc,
      arrivalUtc: f.arrivalUtc,
      durationMinutes: f.durationMinutes,
      cabin,
      aircraft: f.aircraft,
      distanceKm: f.distanceKm,
    })),
  };
}

function cheapest(options: DemoItinerary[], n: number): DemoItinerary[] {
  const price = (o: DemoItinerary) => o.flights.reduce((s, f) => s + f.legFareEur, 0) * (o.flights.length > 1 ? 0.8 : 1);
  return [...options].sort((a, b) => price(a) - price(b)).slice(0, n);
}

/** Deterministic demo provider over the synthetic network. Two personalities model a GDS-like
 * full-service source and a low-cost aggregator, so concurrency, de-duplication and partial
 * failures can be exercised without credentials. */
export class MockProvider implements FlightProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  readonly limits: ProviderLimits;
  private readonly personality: MockPersonality;
  private readonly latency: [number, number];

  constructor(opts: MockProviderOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.personality = opts.personality;
    this.latency = opts.latencyMs ?? [0, 0];
    const network = opts.personality === 'network';
    this.capabilities = {
      oneWay: true,
      roundTrip: network,
      multiCity: network,
      maxSlices: network ? 5 : 1,
      maxConnections: network ? 1 : 0,
      dataQuality: 'demo',
      booking: 'none',
    };
    this.limits = { maxConcurrency: 16, maxCallsPerSearch: network ? 900 : 700, timeoutMs: 8000, cacheTtlSeconds: 900 };
  }

  supportsRoute(origin: string, destination: string): boolean {
    if (!getAirport(origin) || !getAirport(destination)) return false;
    if (origin === destination) return false;
    if (this.personality === 'budget') {
      return airlinesSoldBy('budget').some((a) => routeExists(a, origin, destination)) ||
        airlinesSoldBy('network').some((a) => routeExists(a, origin, destination));
    }
    // Network: reachable when both ends connect to a hub of the same airline.
    return airlinesSoldBy('network').some(
      (a) =>
        routeExists(a, origin, destination) ||
        a.hubs.some((h) => (h === origin || routeExists(a, origin, h)) && (h === destination || routeExists(a, h, destination))),
    );
  }

  async search(query: ProviderQuery, ctx: ProviderContext): Promise<FareOffer[]> {
    const key = JSON.stringify(query);
    const [min, max] = this.latency;
    await sleep(Math.round(min + rand01('latency', this.id, key) * (max - min)), ctx.signal);
    if (ctx.signal.aborted) throw new ProviderError('Aborted', 'timeout');
    if (query.slices.length > this.capabilities.maxSlices) {
      throw new ProviderError(`${this.name} supports at most ${this.capabilities.maxSlices} slice(s)`, 'invalid-request');
    }
    const offers = this.personality === 'network' ? this.networkOffers(query, ctx.now) : this.budgetOffers(query, ctx.now);
    return offers.sort((a, b) => a.price.total.amount - b.price.total.amount).slice(0, 25);
  }

  // -------------------------------------------------------------------------

  private networkOffers(q: ProviderQuery, now: number): FareOffer[] {
    const results: FareOffer[] = [];
    const isRoundTrip =
      q.slices.length === 2 && q.slices[0].origin === q.slices[1].destination && q.slices[0].destination === q.slices[1].origin;
    for (const airline of airlinesSoldBy('network')) {
      const perSlice = q.slices.map((s) =>
        airportPairs(s.origin, s.destination)
          .flatMap(([o, d]) => sliceOptions(airline, o, d, s.departureDate, q.maxConnections, now))
          .filter((o) => o.flights.length - 1 <= q.maxConnections),
      );
      if (perSlice.some((o) => o.length === 0)) continue;
      const combos: DemoItinerary[][] =
        q.slices.length === 1 ? perSlice[0].map((o) => [o]) : cartesian(perSlice.map((o) => cheapest(o, q.slices.length > 2 ? 2 : 3))).slice(0, 9);
      for (const combo of combos) {
        const longHaul = combo.some(isLongHaul);
        const legSum = combo.reduce((s, it) => s + it.flights.reduce((x, f) => x + f.legFareEur, 0) * (it.flights.length > 1 ? 0.8 : 1), 0);
        const ticketFactor =
          q.slices.length === 1 ? (longHaul ? 1.45 : 1.12) : isRoundTrip ? (longHaul ? 0.62 : 0.8) : q.slices.length === 2 ? 0.86 : 0.92;
        const adultEur = legSum * ticketFactor * CABIN_MULTIPLIER[q.cabin];
        if (q.cabin === 'first' && !longHaul) continue;
        for (const brand of this.brands(airline, q.cabin, longHaul, combo)) {
          results.push(this.buildOffer(q, now, { slices: combo, adultEur: adultEur + brand.extra * combo.length, brand }, 'network'));
        }
      }
    }
    return results;
  }

  private brands(airline: DemoAirline, cabin: CabinClass, longHaul: boolean, combo: DemoItinerary[]) {
    if (cabin !== 'economy') {
      return [{ name: cabin === 'premium_economy' ? 'Premium' : cabin === 'business' ? 'Business' : 'First', checked: 2, carryOn: 1, changeable: true, refundable: cabin !== 'premium_economy', extra: 0 }];
    }
    if (longHaul) return [{ name: 'Economy', checked: 1, carryOn: 1, changeable: true, refundable: false, extra: 0 }];
    const light = { name: 'Light', checked: airline.bags.checkedIncluded, carryOn: 1, changeable: false, refundable: false, extra: 0 };
    if (airline.bags.checkedIncluded) return [light];
    const classicExtra = 28 + Math.round(rand01('classic', airline.code, combo[0].flights[0].flightNumber) * 18);
    return [light, { name: 'Classic', checked: 1, carryOn: 1, changeable: true, refundable: false, extra: classicExtra }];
  }

  private budgetOffers(q: ProviderQuery, now: number): FareOffer[] {
    if (q.slices.length !== 1 || q.cabin !== 'economy') return [];
    const s = q.slices[0];
    const pairs = airportPairs(s.origin, s.destination);
    const results: FareOffer[] = [];
    for (const airline of airlinesSoldBy('budget')) {
      for (const f of pairs.flatMap(([o, d]) => flightsOn(airline, o, d, s.departureDate, now))) {
        results.push(
          this.buildOffer(
            q,
            now,
            {
              slices: [{ airline, flights: [f] }],
              adultEur: f.legFareEur,
              brand: { name: 'Basic', checked: 0, carryOn: airline.bags.carryOnIncluded ? 1 : 0, changeable: false, refundable: false },
            },
            'lcc',
          ),
        );
      }
    }
    // Resold full-service nonstop fares (same flights as the network provider, OTA fees apply).
    for (const airline of airlinesSoldBy('network')) {
      for (const f of pairs.flatMap(([o, d]) => flightsOn(airline, o, d, s.departureDate, now))) {
        if (f.distanceKm > 4200) continue;
        const discount = 0.93 + rand01('ota', f.flightNumber, s.departureDate) * 0.05;
        results.push(
          this.buildOffer(
            q,
            now,
            {
              slices: [{ airline, flights: [f] }],
              adultEur: f.legFareEur * 1.12 * discount,
              brand: { name: 'Light', checked: airline.bags.checkedIncluded, carryOn: 1, changeable: false, refundable: false },
            },
            'ota',
          ),
        );
      }
    }
    return results;
  }

  private buildOffer(q: ProviderQuery, now: number, opt: PricedOption, kind: 'network' | 'lcc' | 'ota'): FareOffer {
    const airline = opt.slices[0].airline;
    const pax: PassengerCounts = q.passengers;
    const lcc = kind === 'lcc';
    const childFactor = lcc ? 1 : 0.78;
    const infantEur = lcc ? 25 * opt.slices.length : opt.adultEur * 0.1;
    const roundTo = (n: number) => (lcc ? Math.max(9.99, Math.round(n) - 0.01) : Math.round(n * 100) / 100);
    const adult = roundTo(opt.adultEur);
    const totalEur = adult * pax.adults + roundTo(opt.adultEur * childFactor) * pax.children + roundTo(infantEur) * pax.infants;
    // Network fares are quoted in the requested currency; the budget source always quotes EUR.
    const currency = this.personality === 'network' ? q.currency : 'EUR';
    const total = convert(money(totalEur.toFixed(2), 'EUR'), currency, BUNDLED_RATES).money;
    const flights = opt.slices.flatMap((s) => s.flights);
    const offerKey = `${this.id}|${flights.map((f) => `${f.flightNumber}@${f.departureLocal}`).join(',')}|${opt.brand.name}|${kind}`;
    const eur = (n: number) => convert(money(n.toFixed(2), 'EUR'), currency, BUNDLED_RATES).money;
    const bagFees = lcc
      ? {
          carryOn: airline.bags.carryOnFeeEur ? eur(airline.bags.carryOnFeeEur) : undefined,
          checked: eur(airline.bags.checkedFeeEur),
          source: 'provider' as const,
        }
      : { checked: eur(airline.bags.checkedFeeEur), source: 'provider' as const };
    return {
      id: `${this.id}:${shortHash(offerKey)}`,
      providerId: this.id,
      providerName: this.name,
      providerOfferId: shortHash(offerKey),
      slices: opt.slices.map((s) => toSlice(s, q.cabin, opt.brand.name)),
      price: { total },
      passengers: pax,
      validatingCarrier: { code: airline.code, name: airline.name },
      baggage: { carryOn: opt.brand.carryOn, checked: opt.brand.checked },
      bagFees,
      bookingFee: kind === 'ota' ? eur(8.5) : undefined,
      paymentFee: kind === 'ota' ? { percent: 1.4 } : undefined,
      booking:
        kind === 'ota'
          ? { channel: 'ota', sellerName: OTA_NAME, note: DEMO_NOTE }
          : { channel: 'airline', sellerName: `${airline.name} (demo)`, note: DEMO_NOTE },
      conditions: { refundable: opt.brand.refundable, changeable: opt.brand.changeable },
      fetchedAt: now,
      expiresAt: now + OFFER_TTL_MS,
      dataQuality: 'demo',
      seatsLeft: Math.min(...flights.map((f) => f.seatsLeft)),
    };
  }
}

/** Expands metro codes (e.g. LON) into airport pairs. */
function airportPairs(origin: string, destination: string): [string, string][] {
  const os = resolveLocation(origin);
  const ds = resolveLocation(destination);
  return os.flatMap((o) => ds.filter((d) => d !== o).map((d) => [o, d] as [string, string]));
}

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])), [[]]);
}
