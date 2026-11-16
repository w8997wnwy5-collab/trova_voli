import 'server-only';
import type { FareOffer } from '@/lib/domain/types';
import type { BookingLink, FlightProvider, ProviderCapabilities, ProviderContext, ProviderLimits, ProviderQuery } from '../types';
import { ProviderError } from '../types';
import { buildIgnavSearch, mapBookingLinks, mapIgnavItinerary } from './mapper';

export interface IgnavOptions {
  apiKey: string;
  baseUrl?: string;
  /** Country whose point of sale and currency are used (Ignav `market`), e.g. "IT". */
  market?: string;
  maxCallsPerSearch?: number;
  maxConcurrency?: number;
  tzOf: (code: string) => string | undefined;
  fetchImpl?: typeof fetch;
}

/**
 * Ignav: live fares (including its own self-transfer combinations) and booking links that open the
 * airline's or an agency's booking page with the flight selected. Every successful request is billed
 * after the free allowance, so searches are budgeted and booking links are fetched only on demand.
 */
export class IgnavProvider implements FlightProvider {
  readonly id = 'ignav';
  readonly name = 'Ignav';
  readonly capabilities: ProviderCapabilities = {
    oneWay: true,
    roundTrip: true,
    multiCity: false,
    maxSlices: 2,
    maxConnections: 2,
    dataQuality: 'live',
    booking: 'links',
    cityCodes: false,
  };
  readonly limits: ProviderLimits;
  private readonly opts: Required<Omit<IgnavOptions, 'fetchImpl'>> & Pick<IgnavOptions, 'fetchImpl'>;

  constructor(opts: IgnavOptions) {
    this.opts = { baseUrl: 'https://ignav.com/api', market: 'IT', maxCallsPerSearch: 24, maxConcurrency: 6, ...opts };
    this.limits = {
      maxConcurrency: this.opts.maxConcurrency,
      maxCallsPerSearch: this.opts.maxCallsPerSearch,
      timeoutMs: 45_000,
      // Live fares: reuse a response for 10 minutes at most.
      cacheTtlSeconds: 600,
    };
  }

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${this.opts.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'X-Api-Key': this.opts.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw new ProviderError('Ignav request timed out', 'timeout', true);
      throw new ProviderError(`Ignav network error: ${(err as Error).message}`, 'network', true);
    }
    if (res.ok) return res.json();
    throw await toProviderError(res);
  }

  async search(query: ProviderQuery, ctx: ProviderContext): Promise<FareOffer[]> {
    let request;
    try {
      request = buildIgnavSearch(query, this.opts.market);
    } catch (err) {
      throw new ProviderError((err as Error).message, 'invalid-request');
    }
    const json = await this.post(request.path, request.body, ctx.signal);
    const itineraries = (json as { itineraries?: unknown }).itineraries;
    if (!Array.isArray(itineraries)) return [];
    const mapCtx = { now: ctx.now, passengers: query.passengers, bags: query.bags, tzOf: this.opts.tzOf };
    return itineraries
      .map((it) => (typeof it === 'object' && it ? mapIgnavItinerary(it as Record<string, unknown>, mapCtx, query.cabin) : null))
      .filter((o): o is FareOffer => o !== null);
  }

  async bookingLinks(handle: string, ctx: { signal: AbortSignal }): Promise<BookingLink[]> {
    return mapBookingLinks(await this.post('/fares/booking-links', { ignav_id: handle }, ctx.signal));
  }
}

async function toProviderError(res: Response): Promise<ProviderError> {
  let detail = '';
  try {
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    // Short error descriptors only: never echo request data back into logs or the UI.
    detail = json.error?.code ?? '';
  } catch {
    /* non-JSON body */
  }
  const suffix = detail ? ` (${detail})` : '';
  switch (res.status) {
    case 401:
      return new ProviderError(`Ignav rejected the API key${suffix}`, 'auth', false, 401);
    case 402:
      return new ProviderError(`Ignav needs billing set up or the free allowance is used up${suffix}`, 'billing', false, 402);
    case 403:
      return new ProviderError(`Ignav account email is not verified${suffix}`, 'auth', false, 403);
    case 404:
      return new ProviderError(`Ignav could not find that itinerary any more${suffix}`, 'invalid-request', false, 404);
    case 424:
      return new ProviderError(`Ignav could not complete the search${suffix}`, 'upstream', true, 424);
    case 429:
      return new ProviderError(`Ignav rate limit reached${suffix}`, 'rate-limit', true, 429);
    case 400:
      return new ProviderError(`Ignav rejected the search${suffix}`, 'invalid-request', false, 400);
    default:
      return new ProviderError(`Ignav error ${res.status}${suffix}`, 'upstream', res.status >= 500, res.status);
  }
}
