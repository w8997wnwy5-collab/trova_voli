import { describe, expect, it, vi } from 'vitest';
import { assemble } from '@/lib/engine/assemble';
import { buildIgnavSearch, mapBookingLinks, mapIgnavItinerary } from '@/lib/providers/ignav/mapper';
import { IgnavProvider } from '@/lib/providers/ignav/provider';
import type { FlightProvider, ProviderQuery } from '@/lib/providers/types';
import { assignTasks, expandToAirports, type PlannedTask } from '@/lib/search/plan';
import { googleFlightsUrl, skyscannerUrl } from '@/lib/util/deeplinks';
import { assembleCtx, journey } from '../support/fixtures';

const NOW = Date.parse('2026-11-16T10:00:00Z');
const tz = (c: string) => ({ MXP: 'Europe/Rome', BGY: 'Europe/Rome', STN: 'Europe/London', LGW: 'Europe/London', BCN: 'Europe/Madrid' })[c];
const query = (slices: ProviderQuery['slices'], extra: Partial<ProviderQuery> = {}): ProviderQuery => ({
  slices,
  passengers: { adults: 2, children: 0, infants: 0 },
  cabin: 'economy',
  currency: 'EUR',
  maxConnections: 1,
  ...extra,
});

// Shaped after Ignav's published docs: price {amount, currency}; outbound/inbound {carrier, segments[]};
// segments with marketing_carrier_code, flight_number, local/UTC times, timezones, duration_minutes.
const itinerary = {
  ignav_id: '5e4fcd2f1dc340649eb19f6ee2afb57a',
  price: { amount: 123.45, currency: 'EUR' },
  requires_self_transfer: true,
  cabin_class: 'economy',
  outbound: {
    carrier: 'FR',
    segments: [
      {
        marketing_carrier_code: 'FR',
        flight_number: '1234',
        origin: 'BGY',
        destination: 'STN',
        departure_time_local: '2026-12-11T06:30:00',
        arrival_time_local: '2026-12-11T07:30:00',
        departure_time_utc: '2026-12-11T05:30:00Z',
        arrival_time_utc: '2026-12-11T07:30:00Z',
        departure_timezone: 'Europe/Rome',
        arrival_timezone: 'Europe/London',
        duration_minutes: 120,
        aircraft: 'Boeing 737',
      },
      {
        marketing_carrier_code: 'U2',
        flight_number: 'U2 8000',
        departure_airport: { code: 'STN' },
        arrival_airport: { code: 'BCN' },
        departure_time_local: '2026-12-11T11:00:00+00:00',
        arrival_time_local: '2026-12-11T14:15:00+01:00',
        duration_minutes: 135,
      },
    ],
  },
};

describe('Ignav request building', () => {
  it('sends only set optional fields and maps bags, passengers and stops', () => {
    const { path, body } = buildIgnavSearch(query([{ origin: 'BGY', destination: 'STN', departureDate: '2026-12-11' }], { bags: { carryOn: true, checked: 1 } }), 'IT');
    expect(path).toBe('/fares/one-way');
    // Cabin bag priced by Ignav (only without max_stops); checked bags never sent (not priced by Ignav).
    expect(body).toEqual({
      origin: 'BGY',
      destination: 'STN',
      departure_date: '2026-12-11',
      adults: 2,
      cabin_class: 'economy',
      market: 'IT',
      min_carry_on_bags: 1,
    });
    const noBags = buildIgnavSearch(query([{ origin: 'BGY', destination: 'STN', departureDate: '2026-12-11' }], { bags: { carryOn: false, checked: 0 } }), 'IT');
    expect(noBags.body.max_stops).toBe(1);
    expect(noBags.body.min_carry_on_bags).toBeUndefined();
  });

  it('uses the round-trip endpoint and refuses open-jaw shapes', () => {
    const rt = buildIgnavSearch(
      query([
        { origin: 'MXP', destination: 'LGW', departureDate: '2026-12-11' },
        { origin: 'LGW', destination: 'MXP', departureDate: '2026-12-14' },
      ]),
      'IT',
    );
    expect(rt.path).toBe('/fares/round-trip');
    expect(rt.body.return_date).toBe('2026-12-14');
    expect(() =>
      buildIgnavSearch(
        query([
          { origin: 'MXP', destination: 'LGW', departureDate: '2026-12-11' },
          { origin: 'STN', destination: 'MXP', departureDate: '2026-12-14' },
        ]),
        'IT',
      ),
    ).toThrow();
  });
});

describe('Ignav mapping', () => {
  it('maps itineraries, times, self-transfers and bags bought through the search filter', () => {
    const o = mapIgnavItinerary(itinerary, { now: NOW, passengers: { adults: 2, children: 0, infants: 0 }, bags: { carryOn: true, checked: 0 }, tzOf: tz }, 'economy')!;
    expect(o.id).toBe('ignav:5e4fcd2f1dc340649eb19f6ee2afb57a');
    expect(o.price.total).toEqual({ amount: 12345, currency: 'EUR' });
    expect(o.selfTransfer).toBe(true);
    expect(o.booking).toMatchObject({ channel: 'links', handle: '5e4fcd2f1dc340649eb19f6ee2afb57a' });
    // Low-cost carriers: cabin bag priced in by the search filter, checked bag an estimated extra.
    expect(o.baggage).toEqual({ carryOn: 1, checked: 0 });
    expect(o.bagFees).toEqual({ checked: { amount: 3500, currency: 'EUR' }, source: 'estimate' });
    expect(o.baggageAssumed).toBe(true);
    const [a, b] = o.slices[0].segments;
    expect(a.flightNumber).toBe('FR 1234');
    expect(new Date(a.departureUtc).toISOString()).toBe('2026-12-11T05:30:00.000Z');
    expect(b.flightNumber).toBe('U2 8000');
    expect(b.origin).toBe('STN');
    expect(b.destination).toBe('BCN');
    expect(b.departureLocal).toBe('2026-12-11T11:00');
    expect(new Date(b.arrivalUtc).toISOString()).toBe('2026-12-11T13:15:00.000Z');
  });

  it('drops itineraries missing essentials', () => {
    const ctx = { now: NOW, passengers: { adults: 1, children: 0, infants: 0 }, tzOf: tz };
    expect(mapIgnavItinerary({ ...itinerary, ignav_id: undefined }, ctx, 'economy')).toBeNull();
    expect(mapIgnavItinerary({ ...itinerary, price: 12 }, ctx, 'economy')).toBeNull();
  });

  it('turns provider-built self-transfers into unprotected connections', () => {
    const offer = mapIgnavItinerary(itinerary, { now: NOW, passengers: { adults: 1, children: 0, infants: 0 }, tzOf: tz }, 'economy')!;
    const spec = { tripType: 'one-way' as const, journeys: [journey(0, ['BGY'], ['BCN'], ['2026-12-11'])] };
    const it = assemble([[{ offer, slice: 0 }]], { ...assembleCtx(spec), airport: (c) => ({ country: c === 'STN' ? 'GB' : c === 'BCN' ? 'ES' : 'IT', city: c }) })!;
    expect(it.journeys[0].connections[0].kind).toBe('self-transfer');
    expect(it.attrs.selfTransfers).toBe(1);
    expect(it.attrs.conventional).toBe(false);
  });

  it('extracts booking links exactly as given and ignores anything that is not a web page', () => {
    const links = mapBookingLinks({
      itinerary: {},
      booking_options: [
        {
          legs: [{ origin: 'BGY', destination: 'STN' }],
          links: [
            { provider_name: 'Ryanair', provider_type: 'airline', fare_name: 'Basic', price: { amount: 61.5, currency: 'EUR' }, url: 'https://www.ryanair.com/booking?x=1&y=2' },
            { provider_name: 'Evil', url: 'javascript:alert(1)' },
          ],
        },
        { legs: [], links: [{ provider_name: 'Dup', url: 'https://www.ryanair.com/booking?x=1&y=2' }] },
      ],
    });
    expect(links).toEqual([
      { providerName: 'Ryanair', providerType: 'airline', fareName: 'Basic', price: { amount: 6150, currency: 'EUR' }, url: 'https://www.ryanair.com/booking?x=1&y=2', legs: 'BGY → STN' },
    ]);
  });
});

describe('Ignav provider', () => {
  const ctx = () => ({ signal: new AbortController().signal, requestId: 't', now: NOW });

  it('calls the documented endpoints with the API key header', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Api-Key']).toBe('ignav_test_key');
      if (String(url).endsWith('/fares/booking-links')) {
        expect(JSON.parse(String(init?.body))).toEqual({ ignav_id: 'abc12345' });
        return Response.json({ booking_options: [{ links: [{ provider_name: 'easyJet', url: 'https://www.easyjet.com/x' }] }] });
      }
      expect(String(url)).toBe('https://ignav.com/api/fares/one-way');
      return Response.json({ itineraries: [itinerary, { broken: true }] });
    });
    const p = new IgnavProvider({ apiKey: 'ignav_test_key', tzOf: tz, fetchImpl: fetchImpl as unknown as typeof fetch });
    const offers = await p.search(query([{ origin: 'BGY', destination: 'BCN', departureDate: '2026-12-11' }]), ctx());
    expect(offers).toHaveLength(1);
    expect(await p.bookingLinks('abc12345', { signal: new AbortController().signal })).toEqual([{ providerName: 'easyJet', url: 'https://www.easyjet.com/x' }]);
  });

  it('maps billing, auth and retryable errors', async () => {
    const failing = (status: number) =>
      new IgnavProvider({
        apiKey: 'ignav_test_key',
        tzOf: tz,
        fetchImpl: (async () => Response.json({ error: { code: 'x' } }, { status })) as unknown as typeof fetch,
      });
    const q = query([{ origin: 'BGY', destination: 'BCN', departureDate: '2026-12-11' }]);
    await expect(failing(401).search(q, ctx())).rejects.toMatchObject({ kind: 'auth' });
    await expect(failing(402).search(q, ctx())).rejects.toMatchObject({ kind: 'billing' });
    await expect(failing(424).search(q, ctx())).rejects.toMatchObject({ kind: 'upstream', retryable: true });
  });
});

describe('airport-only providers', () => {
  const task: PlannedTask = {
    key: 'k',
    kind: 'rt',
    purpose: 'primary',
    priority: 0,
    query: query([
      { origin: 'MIL', destination: 'LON', departureDate: '2026-12-11' },
      { origin: 'LON', destination: 'MIL', departureDate: '2026-12-14' },
    ]),
  };

  it('expands metro codes into main-airport combinations, consistent in both directions', () => {
    const tasks = expandToAirports(task);
    expect(tasks).toHaveLength(9);
    for (const t of tasks) {
      expect(t.query.slices[1].origin).toBe(t.query.slices[0].destination);
      expect(t.query.slices[1].destination).toBe(t.query.slices[0].origin);
    }
    expect(new Set(tasks.map((t) => t.key)).size).toBe(9);
    expect(tasks.map((t) => t.query.slices[0].destination)).toContain('STN');
    expect(tasks.map((t) => t.query.slices[0].origin)).toContain('BGY');
  });

  it('expands only for providers that need airport codes', () => {
    const base = { name: 'x', limits: { maxConcurrency: 1, maxCallsPerSearch: 10, timeoutMs: 1000, cacheTtlSeconds: 0 }, search: async () => [] };
    const cap = { oneWay: true, roundTrip: true, multiCity: false, maxSlices: 2, maxConnections: 2 as const, dataQuality: 'live' as const, booking: 'links' as const };
    const airportOnly: FlightProvider = { ...base, id: 'a', capabilities: { ...cap, cityCodes: false } };
    const cityOk: FlightProvider = { ...base, id: 'c', capabilities: cap };
    const assigned = assignTasks([task], [airportOnly, cityOk]);
    expect(assigned.get('a')).toHaveLength(9);
    expect(assigned.get('c')).toHaveLength(1);
  });
});

describe('links to check and book elsewhere', () => {
  const search = {
    slices: [
      { origin: 'MXP', destination: 'LGW', date: '2026-12-11' },
      { origin: 'LGW', destination: 'MXP', date: '2026-12-14' },
    ],
    passengers: { adults: 2, children: 1, infants: 0 },
    cabin: 'economy' as const,
    currency: 'EUR',
  };

  it('builds pre-filled Google Flights and Skyscanner searches', () => {
    expect(googleFlightsUrl(search)).toBe(
      `https://www.google.com/travel/flights?q=${encodeURIComponent('Flights from MXP to LGW on 2026-12-11 through 2026-12-14 for 3 passengers')}&curr=EUR&hl=it`,
    );
    expect(skyscannerUrl(search)).toBe('https://www.skyscanner.it/trasporti/voli/mxp/lgw/261211/261214/?adultsv2=2&cabinclass=economy&rtn=1&childrenv2=8');
    expect(skyscannerUrl({ ...search, slices: [search.slices[0]] })).toContain('/mxp/lgw/261211/?');
  });
});

// Shape observed from the live API (one-way BGY→STN): leg-level carrier name, airport codes as strings,
// UTC times with Z, observed_at, booking legs as strings and link specificity.
describe('Ignav live response format', () => {
  const live = {
    origin: 'BGY',
    destination: 'STN',
    departure_date: '2026-12-11',
    observed_at: '2026-11-16T09:59:00Z',
    itineraries: [
      {
        price: { amount: 103.0, currency: 'EUR', status: 'verified' },
        outbound: {
          carrier: 'Ryanair',
          duration_minutes: 125,
          segments: [
            {
              marketing_carrier_code: 'FR',
              flight_number: '2735',
              operating_carrier_name: 'Ryanair',
              departure_airport: 'BGY',
              departure_time_local: '2026-12-11T06:35:00',
              departure_timezone: 'Europe/Rome',
              departure_time_utc: '2026-12-11T05:35:00Z',
              arrival_airport: 'STN',
              arrival_time_local: '2026-12-11T07:40:00',
              arrival_timezone: 'Europe/London',
              arrival_time_utc: '2026-12-11T07:40:00Z',
              duration_minutes: 125,
              aircraft: 'Boeing 737',
            },
          ],
        },
        cabin_class: 'economy',
        has_mixed_carriers: false,
        ignav_id: 'da0dda887a444c84bfffe662892e94d6',
      },
    ],
  };

  it('maps the live format', async () => {
    const p = new IgnavProvider({ apiKey: 'ignav_test_key', tzOf: tz, fetchImpl: (async () => Response.json(live)) as unknown as typeof fetch });
    const [o] = await p.search(query([{ origin: 'BGY', destination: 'STN', departureDate: '2026-12-11' }]), { signal: new AbortController().signal, requestId: 't', now: NOW });
    expect(o.price.total).toEqual({ amount: 10300, currency: 'EUR' });
    expect(o.passengers.adults).toBe(2);
    expect(o.fetchedAt).toBe(Date.parse('2026-11-16T09:59:00Z'));
    const s = o.slices[0].segments[0];
    expect(s).toMatchObject({ flightNumber: 'FR 2735', origin: 'BGY', destination: 'STN', departureLocal: '2026-12-11T06:35', arrivalLocal: '2026-12-11T07:40', durationMinutes: 125 });
    expect(s.marketingCarrier).toEqual({ code: 'FR', name: 'Ryanair' });
    expect(o.selfTransfer).toBe(false);
  });

  it('assumes checked bags are included on long-haul legacy flights, and flags the assumption', () => {
    const longHaul = structuredClone(live.itineraries[0]);
    const seg = longHaul.outbound.segments[0];
    Object.assign(seg, { marketing_carrier_code: 'AZ', flight_number: '608', arrival_airport: 'JFK', duration_minutes: 540, arrival_time_utc: '2026-12-11T14:35:00Z', arrival_timezone: 'America/New_York', arrival_time_local: '2026-12-11T09:35:00' });
    longHaul.outbound.carrier = 'ITA Airways';
    const o = mapIgnavItinerary(longHaul, { now: NOW, passengers: { adults: 1, children: 0, infants: 0 }, tzOf: tz }, 'economy')!;
    expect(o.baggage.checked).toBe(1);
    expect(o.baggageAssumed).toBe(true);
    expect(o.bagFees).toBeUndefined();
  });

  it('labels booking options and exact-flight links', () => {
    const links = mapBookingLinks({
      booking_options: [
        { legs: ['outbound'], links: [{ provider_name: 'Ryanair', provider_type: 'airline', specificity: 'exact_flight', url: 'https://www.ryanair.com/gb/en/trip/flights/select?originIata=BGY&outFlightNo=FR2735' }] },
        { legs: ['outbound', 'inbound'], links: [{ provider_name: 'Agency', provider_type: 'agency', specificity: 'search', url: 'https://agency.example/s?x=1' }] },
      ],
    });
    expect(links[0]).toMatchObject({ providerName: 'Ryanair', legs: 'Outbound', exactFlight: true });
    expect(links[1]).toMatchObject({ providerName: 'Agency', legs: undefined, exactFlight: false });
  });
});
