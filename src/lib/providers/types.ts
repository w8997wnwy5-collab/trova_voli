import type { CabinClass, DataQuality, FareOffer, PassengerCounts } from '@/lib/domain/types';

/** A single request to a provider: one ticket covering 1..n slices. */
export interface ProviderQuery {
  slices: { origin: string; destination: string; departureDate: string }[];
  passengers: PassengerCounts;
  cabin: CabinClass;
  /** Preferred currency (providers may ignore it). */
  currency: string;
  maxConnections: 0 | 1 | 2;
}

export interface ProviderCapabilities {
  oneWay: boolean;
  roundTrip: boolean;
  multiCity: boolean;
  maxSlices: number;
  maxConnections: 0 | 1 | 2;
  dataQuality: Exclude<DataQuality, 'cached'>;
  /** How the user books: provider deep link, provider order API (not implemented here) or not bookable. */
  booking: 'deeplink' | 'api-order' | 'none';
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
}

export type ProviderErrorKind = 'auth' | 'rate-limit' | 'timeout' | 'upstream' | 'invalid-request' | 'network' | 'simulated';

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
