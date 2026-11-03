import 'server-only';
import type { SearchRequest } from '@/lib/domain/schemas';
import type { SearchResponse } from '@/lib/domain/types';
import { getProviders } from '@/lib/providers/registry';
import type { FlightProvider, InactiveProvider } from '@/lib/providers/types';
import { config } from '@/lib/server/config';
import { getFxRates } from '@/lib/server/fx-source';
import { logger as rootLogger, type Logger } from '@/lib/server/logger';
import type { FxRates } from '@/lib/util/fx';
import { getOfferCache } from './cache-instance';
import type { OfferCache } from './cache';
import { searchCore } from './core';

export interface SearchDeps {
  providers?: { active: FlightProvider[]; inactive: InactiveProvider[] };
  cache?: OfferCache;
  fx?: FxRates;
  now?: number;
  logger?: Logger;
  maxCandidates?: number;
  deadlineMs?: number;
  allowFaultInjection?: boolean;
}

/** Server entry point: wires configuration, configured providers, shared cache and logging. */
export async function runSearch(req: SearchRequest, requestId: string, deps: SearchDeps = {}): Promise<SearchResponse> {
  const cfg = config();
  return searchCore(req, requestId, {
    providers: deps.providers ?? getProviders(),
    cache: deps.cache ?? getOfferCache(),
    fx: deps.fx ?? (await getFxRates()),
    now: deps.now ?? Date.now(),
    maxCandidates: deps.maxCandidates ?? cfg.MAX_CANDIDATES,
    deadlineMs: deps.deadlineMs ?? cfg.SEARCH_DEADLINE_MS,
    allowFaultInjection: deps.allowFaultInjection ?? cfg.ALLOW_FAULT_INJECTION,
    logger: (deps.logger ?? rootLogger).child({ requestId }),
  });
}
