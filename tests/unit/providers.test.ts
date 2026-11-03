import { describe, expect, it, vi } from 'vitest';
import { buildOfferRequestBody, mapDuffelOffer, type DuffelOffer } from '@/lib/providers/duffel/mapper';
import { DuffelProvider } from '@/lib/providers/duffel/provider';
import { MockProvider } from '@/lib/providers/mock/provider';
import { ProviderError, type ProviderQuery } from '@/lib/providers/types';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const ctx = () => ({ signal: new AbortController().signal, requestId: 't', now: NOW });
const query = (slices: ProviderQuery['slices'], extra: Partial<ProviderQuery> = {}): ProviderQuery => ({
  slices,
  passengers: { adults: 1, children: 0, infants: 0 },
  cabin: 'economy',
  currency: 'EUR',
  maxConnections: 1,
  ...extra,
});

describe('demo providers', () => {
  const network = new MockProvider({ id: 'demo-network', name: 'Demo Air Network', personality: 'network' });
  const budget = new MockProvider({ id: 'demo-budget', name: 'Demo Budget Finder', personality: 'budget' });

  it('are deterministic, labelled as demo and honour the query', async () => {
    const q = query([{ origin: 'MXP', destination: 'LHR', departureDate: '2026-12-11' }]);
    const a = await network.search(q, ctx());
    const b = await network.search(q, ctx());
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((o) => [o.id, o.price.total.amount])).toEqual(b.map((o) => [o.id, o.price.total.amount]));
    for (const o of a) {
      expect(o.dataQuality).toBe('demo');
      expect(o.booking.url).toBeUndefined();
      expect(o.slices[0].segments[0].origin).toBe('MXP');
      expect(o.slices[0].segments.at(-1)!.destination).toBe('LHR');
      const segs = o.slices[0].segments;
      for (let i = 1; i < segs.length; i++) expect(segs[i].departureUtc).toBeGreaterThan(segs[i - 1].arrivalUtc);
    }
    const prices = a.map((o) => o.price.total.amount);
    expect([...prices].sort((x, y) => x - y)).toEqual(prices);
  });

  it('expands metro codes into their airports', async () => {
    const offers = await budget.search(query([{ origin: 'MIL', destination: 'LON', departureDate: '2026-12-11' }]), ctx());
    const origins = new Set(offers.map((o) => o.slices[0].segments[0].origin));
    expect(origins.size).toBeGreaterThan(1);
    expect([...origins].every((c) => ['MXP', 'LIN', 'BGY'].includes(c))).toBe(true);
  });

  it('models round-trip tickets and low-cost one-ways with bag fees', async () => {
    const rt = await network.search(
      query([
        { origin: 'MXP', destination: 'JFK', departureDate: '2027-01-12' },
        { origin: 'JFK', destination: 'MXP', departureDate: '2027-01-19' },
      ]),
      ctx(),
    );
    expect(rt.length).toBeGreaterThan(0);
    expect(rt.every((o) => o.slices.length === 2)).toBe(true);
    const lcc = (await budget.search(query([{ origin: 'BGY', destination: 'STN', departureDate: '2026-12-11' }]), ctx())).filter((o) => o.booking.channel === 'airline');
    expect(lcc.length).toBeGreaterThan(0);
    expect(lcc[0].bagFees?.checked).toBeDefined();
    expect(lcc[0].baggage.checked).toBe(0);
  });

  it('declares and enforces capabilities', async () => {
    expect(budget.capabilities.roundTrip).toBe(false);
    await expect(
      budget.search(
        query([
          { origin: 'BGY', destination: 'STN', departureDate: '2026-12-11' },
          { origin: 'STN', destination: 'BGY', departureDate: '2026-12-14' },
        ]),
        ctx(),
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(await budget.search(query([{ origin: 'BGY', destination: 'STN', departureDate: '2026-12-11' }], { cabin: 'business' }), ctx())).toEqual([]);
    expect(network.supportsRoute!('MXP', 'MXP')).toBe(false);
  });
});

const duffelOffer: DuffelOffer = {
  id: 'off_123',
  live_mode: false,
  total_amount: '245.60',
  total_currency: 'GBP',
  base_amount: '200.00',
  base_currency: 'GBP',
  tax_amount: '45.60',
  tax_currency: 'GBP',
  expires_at: '2026-11-03T10:30:00Z',
  owner: { iata_code: 'ZZ', name: 'Duffel Airways' },
  passengers: [{ id: 'pas_1', type: 'adult' }],
  conditions: { refund_before_departure: { allowed: false }, change_before_departure: { allowed: true } },
  slices: [
    {
      fare_brand_name: 'Basic',
      segments: [
        {
          origin: { iata_code: 'LHR', time_zone: 'Europe/London' },
          destination: { iata_code: 'JFK', time_zone: 'America/New_York' },
          departing_at: '2026-12-11T09:00:00',
          arriving_at: '2026-12-11T12:00:00',
          duration: 'PT8H',
          marketing_carrier: { iata_code: 'ZZ', name: 'Duffel Airways' },
          marketing_carrier_flight_number: '123',
          operating_carrier: { iata_code: 'ZZ', name: 'Duffel Airways' },
          aircraft: { name: 'Airbus A380' },
          passengers: [{ passenger_id: 'pas_1', cabin_class: 'economy', baggages: [{ type: 'carry_on', quantity: 1 }, { type: 'checked', quantity: 1 }] }],
        },
      ],
    },
  ],
};

describe('Duffel adapter', () => {
  it('builds offer requests with adults, child ages and infants', () => {
    const body = buildOfferRequestBody(query([{ origin: 'LHR', destination: 'JFK', departureDate: '2026-12-11' }], { passengers: { adults: 2, children: 1, infants: 1 } }), 9);
    expect(body.data.passengers).toEqual([{ type: 'adult' }, { type: 'adult' }, { age: 9 }, { age: 1 }]);
    expect(body.data.slices[0]).toMatchObject({ origin: 'LHR', destination: 'JFK', departure_date: '2026-12-11' });
    expect(body.data.max_connections).toBe(1);
  });

  it('maps offers to the normalized model with UTC times, bags and conditions', () => {
    const o = mapDuffelOffer(duffelOffer, { providerId: 'duffel', providerName: 'Duffel', now: NOW, passengers: { adults: 1, children: 0, infants: 0 }, tzOf: () => undefined })!;
    expect(o.price.total).toEqual({ amount: 24560, currency: 'GBP' });
    expect(o.dataQuality).toBe('test');
    const s = o.slices[0].segments[0];
    expect(new Date(s.departureUtc).toISOString()).toBe('2026-12-11T09:00:00.000Z');
    expect(new Date(s.arrivalUtc).toISOString()).toBe('2026-12-11T17:00:00.000Z');
    expect(s.durationMinutes).toBe(480);
    expect(s.flightNumber).toBe('ZZ 123');
    expect(o.baggage).toEqual({ carryOn: 1, checked: 1 });
    expect(o.conditions).toEqual({ refundable: false, changeable: true });
    expect(o.booking.channel).toBe('api');
    expect(mapDuffelOffer({ ...duffelOffer, partial: true }, { providerId: 'duffel', providerName: 'Duffel', now: NOW, passengers: { adults: 1, children: 0, infants: 0 }, tzOf: () => undefined })).toBeNull();
  });

  it('calls the API with the right headers and maps errors', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['Duffel-Version']).toBe('v2');
      expect(headers.Authorization).toBe('Bearer duffel_test_abc');
      return new Response(JSON.stringify({ data: { id: 'orq_1', live_mode: false, offers: [duffelOffer] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const p = new DuffelProvider({ accessToken: 'duffel_test_abc', tzOf: () => undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    const offers = await p.search(query([{ origin: 'LHR', destination: 'JFK', departureDate: '2026-12-11' }]), ctx());
    expect(offers).toHaveLength(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/air/offer_requests?return_offers=true&supplier_timeout=');

    const unauthorized = new DuffelProvider({ accessToken: 'bad_token_123', tzOf: () => undefined, fetchImpl: (async () => new Response(JSON.stringify({ errors: [{ code: 'unauthorized', title: 'Unauthorized' }] }), { status: 401 })) as unknown as typeof fetch });
    await expect(unauthorized.search(query([{ origin: 'LHR', destination: 'JFK', departureDate: '2026-12-11' }]), ctx())).rejects.toMatchObject({ kind: 'auth' });

    let calls = 0;
    const limited = new DuffelProvider({
      accessToken: 'duffel_test_abc',
      tzOf: () => undefined,
      fetchImpl: (async () => {
        calls++;
        return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
      }) as unknown as typeof fetch,
    });
    await expect(limited.search(query([{ origin: 'LHR', destination: 'JFK', departureDate: '2026-12-11' }]), ctx())).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(calls).toBe(2); // one retry, then give up
  });
});
