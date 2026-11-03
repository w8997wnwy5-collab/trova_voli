// Browser-only search used by the static (GitHub Pages) build. Loaded lazily, so the airport dataset
// and the demo network are never part of the normal bundle. Only demo providers can run here: live
// providers need secret API keys, which must never be shipped to a browser.
import { describeLocation, getAirport, isMetroCode, searchLocations, type LocationSuggestion } from '@/lib/data/airports';
import { SearchRequestSchema, type SearchRequestInput } from '@/lib/domain/schemas';
import type { SearchResponse } from '@/lib/domain/types';
import { MockProvider } from '@/lib/providers/mock/provider';
import { MemoryOfferCache } from '@/lib/search/cache';
import { searchCore } from '@/lib/search/core';
import { BUNDLED_RATES } from '@/lib/util/fx';

const providers = {
  active: [
    // A few ms of simulated latency yields to the event loop so the page keeps painting during big searches.
    new MockProvider({ id: 'demo-network', name: 'Demo Air Network', personality: 'network', latencyMs: [1, 4] }),
    new MockProvider({ id: 'demo-budget', name: 'Demo Budget Finder', personality: 'budget', latencyMs: [1, 4] }),
  ],
  inactive: [{ id: 'duffel', name: 'Duffel', reason: 'Needs a server: not available in the static GitHub Pages version' }],
};
const cache = new MemoryOfferCache(1500);

export type BrowserSearchResult =
  | { ok: true; data: SearchResponse }
  | { ok: false; message: string; issues?: { path: string; message: string }[] };

export async function runBrowserSearch(input: SearchRequestInput): Promise<BrowserSearchResult> {
  const parsed = SearchRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Some search fields need attention.',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  // Let the loading state paint before the CPU-heavy combination step.
  await new Promise((r) => setTimeout(r, 30));
  const data = await searchCore(parsed.data, globalThis.crypto?.randomUUID?.() ?? String(Date.now()), {
    providers,
    cache,
    fx: BUNDLED_RATES,
    now: Date.now(),
    maxCandidates: 250,
    deadlineMs: 25_000,
    allowFaultInjection: true,
  });
  return { ok: true, data };
}

export function suggestLocations(query: string): LocationSuggestion[] {
  return searchLocations(query.slice(0, 60), 8);
}

export function locationLabels(codes: string[]): { code: string; label: string }[] {
  return codes.filter((c) => isMetroCode(c) || getAirport(c)).map((code) => ({ code, label: describeLocation(code) }));
}
