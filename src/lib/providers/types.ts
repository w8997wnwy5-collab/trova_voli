import type { CabinClass, DataQuality, FareOffer, Money, PassengerCounts } from '@/lib/domain/types';

/** A single request to a provider: one ticket covering 1..n slices. */
export interface ProviderQuery {
  slices: { origin: string; destination: string; departureDate: string }[];
  passengers: PassengerCounts;
  cabin: CabinClass;
  /** Preferred currency (providers may ignore it). */
  currency: string;
  maxConnections: 0 | 1 | 2;
  /** Bags per traveller; providers that can price them in return fares that include them. */
  bags?: { carryOn: boolean; checked: number };
}

export interface ProviderCapabilities {
  oneWay: boolean;
  roundTrip: boolean;
  multiCity: boolean;
  maxSlices: number;
  maxConnections: 0 | 1 | 2;
  dataQuality: Exclude<DataQuality, 'cached'>;
  /** How the user books: provider deep link, provider order API (not implemented here), booking links
   * fetched on demand, or not bookable. */
  booking: 'deeplink' | 'api-order' | 'links' | 'none';
  /** False when the provider only accepts airport codes (metro codes like LON are expanded first). */
  cityCodes?: boolean;
}

/** A page where the traveller can buy a ticket, as returned by the provider (never constructed by us). */
export interface BookingLink {
  providerName: string;
  /** e.g. "airline" or "agency". */
  providerType?: string;
  fareName?: string;
  price?: Money;
  url: string;
  /** Which flights this link books, e.g. "MXP → LGW" (self-transfer trips have one option per leg). */
  legs?: string;
}

export interface ProviderLimits {
  maxConcurrency: number;
  /** Hard cap on provider calls per user search. */
  maxCallsPerSearch: number;
  timeoutMs: number;
  /** Longest time a response may be reused (provider terms/offer expiry). */
  cacheTtlSeconds: number;
}

export interface ProviderContext {
  signal: AbortSignal;
  requestId: string;
  now: number;
}

/** Contract every flight source implements. Provider-specific logic stays inside the adapter. */
export interface FlightProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  readonly limits: ProviderLimits;
  /** Cheap local pre-check to avoid calls for routes the provider cannot serve. */
  supportsRoute?(origin: string, destination: string): boolean;
  search(query: ProviderQuery, ctx: ProviderContext): Promise<FareOffer[]>;
  /** Booking pages for an offer's `booking.handle` (providers with `booking: 'links'`). */
  bookingLinks?(handle: string, ctx: { signal: AbortSignal }): Promise<BookingLink[]>;
}

/** A known source that is not active in this deployment (shown honestly in the status bar). */
export interface InactiveProvider {
  id: string;
  name: string;
  reason: string;
}

export type ProviderErrorKind = 'auth' | 'billing' | 'rate-limit' | 'timeout' | 'upstream' | 'invalid-request' | 'network' | 'simulated';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
