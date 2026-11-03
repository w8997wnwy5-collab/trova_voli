import 'server-only';
import type { FareOffer } from '@/lib/domain/types';
import type { FlightProvider, ProviderCapabilities, ProviderContext, ProviderLimits, ProviderQuery } from '../types';
import { ProviderError } from '../types';
import { buildOfferRequestBody, mapDuffelOffer, type DuffelOfferRequestResponse } from './mapper';

export interface DuffelOptions {
  accessToken: string;
  baseUrl?: string;
  maxCallsPerSearch?: number;
  maxConcurrency?: number;
  supplierTimeoutMs?: number;
  childAge?: number;
  tzOf: (code: string) => string | undefined;
  fetchImpl?: typeof fetch;
}

/** Duffel Flights API (v2) adapter: search only (offer requests). Booking requires the Orders API
 * and payments, which are intentionally out of scope. */
export class DuffelProvider implements FlightProvider {
  readonly id = 'duffel';
  readonly name = 'Duffel';
  readonly capabilities: ProviderCapabilities = {
    oneWay: true,
    roundTrip: true,
    multiCity: true,
    maxSlices: 5,
    maxConnections: 2,
    dataQuality: 'live',
    booking: 'api-order',
  };
  readonly limits: ProviderLimits;
  private readonly opts: Required<Omit<DuffelOptions, 'fetchImpl' | 'tzOf'>> & Pick<DuffelOptions, 'fetchImpl' | 'tzOf'>;

  constructor(opts: DuffelOptions) {
    this.opts = {
      baseUrl: 'https://api.duffel.com',
      maxCallsPerSearch: 12,
      maxConcurrency: 2,
      supplierTimeoutMs: 15_000,
      childAge: 8,
      ...opts,
    };
    this.limits = {
      maxConcurrency: this.opts.maxConcurrency,
      maxCallsPerSearch: this.opts.maxCallsPerSearch,
      timeoutMs: this.opts.supplierTimeoutMs + 8_000,
      // Offers usually expire after ~30 minutes; we reuse responses for 5 minutes at most.
      cacheTtlSeconds: 300,
    };
  }

  async search(query: ProviderQuery, ctx: ProviderContext): Promise<FareOffer[]> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const url = `${this.opts.baseUrl}/air/offer_requests?return_offers=true&supplier_timeout=${this.opts.supplierTimeoutMs}`;
    const body = JSON.stringify(buildOfferRequestBody(query, this.opts.childAge));
    let attempt = 0;
    for (;;) {
      attempt++;
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'Content-Type': 'application/json',
            'Duffel-Version': 'v2',
            Authorization: `Bearer ${this.opts.accessToken}`,
          },
          body,
          signal: ctx.signal,
        });
      } catch (err) {
        if (ctx.signal.aborted) throw new ProviderError('Duffel request timed out', 'timeout', true);
        throw new ProviderError(`Duffel network error: ${(err as Error).message}`, 'network', true);
      }
      if (res.ok) {
        const json = (await res.json()) as DuffelOfferRequestResponse;
        const offers = json.data?.offers ?? [];
        return offers
          .map((o) =>
            mapDuffelOffer(o, { providerId: this.id, providerName: this.name, now: ctx.now, passengers: query.passengers, tzOf: this.opts.tzOf }),
          )
          .filter((o): o is FareOffer => o !== null);
      }
      const error = await toProviderError(res);
      if (error.retryable && attempt < 2 && !ctx.signal.aborted) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2000) : 400));
        continue;
      }
      throw error;
    }
  }
}

async function toProviderError(res: Response): Promise<ProviderError> {
  let detail = '';
  try {
    const json = (await res.json()) as { errors?: { title?: string; message?: string; code?: string }[] };
    const first = json.errors?.[0];
    // Only short, non-personal error descriptors are kept for logs/UI.
    detail = first ? `${first.code ?? ''} ${first.title ?? ''}`.trim() : '';
  } catch {
    /* non-JSON body */
  }
  const suffix = detail ? `: ${detail}` : '';
  if (res.status === 401 || res.status === 403) return new ProviderError(`Duffel rejected the access token${suffix}`, 'auth', false, res.status);
  if (res.status === 429) return new ProviderError(`Duffel rate limit reached${suffix}`, 'rate-limit', true, res.status);
  if (res.status === 400 || res.status === 422) return new ProviderError(`Duffel rejected the search${suffix}`, 'invalid-request', false, res.status);
  if (res.status >= 500) return new ProviderError(`Duffel is unavailable (${res.status})${suffix}`, 'upstream', true, res.status);
  return new ProviderError(`Duffel error ${res.status}${suffix}`, 'upstream', false, res.status);
}
