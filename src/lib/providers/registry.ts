import 'server-only';
import { getAirport } from '@/lib/data/airports';
import { config } from '@/lib/server/config';
import { DuffelProvider } from './duffel/provider';
import { MockProvider } from './mock/provider';
import type { FlightProvider, InactiveProvider } from './types';

export type { InactiveProvider } from './types';

let cache: { active: FlightProvider[]; inactive: InactiveProvider[] } | undefined;

/** Providers enabled by configuration. Secrets never leave the server. */
export function getProviders(): { active: FlightProvider[]; inactive: InactiveProvider[] } {
  if (cache) return cache;
  const cfg = config();
  const active: FlightProvider[] = [];
  const inactive: InactiveProvider[] = [];
  const [min, max] = cfg.MOCK_LATENCY_MS.split('-').map(Number);

  if (cfg.ENABLE_DEMO_PROVIDERS) {
    active.push(
      new MockProvider({ id: 'demo-network', name: 'Demo Air Network', personality: 'network', latencyMs: [min, max] }),
      new MockProvider({ id: 'demo-budget', name: 'Demo Budget Finder', personality: 'budget', latencyMs: [min, max] }),
    );
  }

  if (cfg.DUFFEL_ACCESS_TOKEN) {
    active.push(
      new DuffelProvider({
        accessToken: cfg.DUFFEL_ACCESS_TOKEN,
        maxCallsPerSearch: cfg.DUFFEL_MAX_CALLS_PER_SEARCH,
        maxConcurrency: cfg.DUFFEL_MAX_CONCURRENCY,
        supplierTimeoutMs: cfg.DUFFEL_SUPPLIER_TIMEOUT_MS,
        tzOf: (code) => getAirport(code)?.tz,
      }),
    );
  } else {
    inactive.push({ id: 'duffel', name: 'Duffel', reason: 'Not configured (set DUFFEL_ACCESS_TOKEN)' });
  }

  cache = { active, inactive };
  return cache;
}

export function resetProviders(): void {
  cache = undefined;
}
