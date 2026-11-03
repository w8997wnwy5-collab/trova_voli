import { airportInfo, distanceKm, getAirport, sameCity } from '@/lib/data/airports';
import { entryZone, NO_AIRSIDE_TRANSIT } from '@/lib/data/entry';
import { hotelNightEur } from '@/lib/data/hotels';
import { estimateTransfer } from '@/lib/data/transfers';
import type { SearchRequest } from '@/lib/domain/schemas';
import type { AirportInfo, Itinerary, ProviderStatus, SearchResponse } from '@/lib/domain/types';
import { assemble, type AssembleContext } from '@/lib/engine/assemble';
import { combine } from '@/lib/engine/combine';
import { approxOfferCost, type CostContext } from '@/lib/engine/cost';
import { conventionalBaseline, dedupe, prune } from '@/lib/engine/select';
import type { FlightProvider, InactiveProvider } from '@/lib/providers/types';
import { canConvert, type FxRates } from '@/lib/util/fx';
import { shortHash } from '@/lib/util/hash';
import { NO_LOG, type LogSink } from '@/lib/util/log';
import type { OfferCache } from './cache';
import { runProviderTasks } from './orchestrator';
import { assignTasks, buildTripSpec, planTasks } from './plan';

// Search pipeline shared by the server API and the browser-only (GitHub Pages) build. Every
// dependency is injected, so this module never touches secrets, environment variables or Node APIs.

export interface CoreDeps {
  providers: { active: FlightProvider[]; inactive: InactiveProvider[] };
  cache: OfferCache;
  fx: FxRates;
  now: number;
  maxCandidates: number;
  deadlineMs: number;
  allowFaultInjection: boolean;
  logger?: LogSink;
}

/** End-to-end search: plan → providers → combine → assemble → de-duplicate → prune. */
export async function searchCore(req: SearchRequest, requestId: string, deps: CoreDeps): Promise<SearchResponse> {
  const started = Date.now();
  const log = deps.logger ?? NO_LOG;
  const { now, fx } = deps;
  const { active, inactive } = deps.providers;

  const spec = buildTripSpec(req, now);
  const tasks = planTasks(spec, req);
  const assignment = assignTasks(tasks, active);
  const orchestrated = await runProviderTasks(active, assignment, {
    cache: deps.cache,
    requestId,
    now,
    deadlineMs: deps.deadlineMs,
    failProviders: deps.allowFaultInjection ? req.simulate?.failProviders : undefined,
    logger: log,
  });

  const costCtx: CostContext = { currency: req.currency, fx, passengers: req.passengers, bags: req.bags };
  const offers = orchestrated.offers.filter(
    (o) => canConvert(o.price.total.currency, req.currency, fx) && (o.expiresAt === undefined || o.expiresAt > now),
  );
  const transferMinutes = (a: string, b: string) => estimateTransfer(a, b).minutes;
  const approx = new Map<string, number>();
  const combined = combine(offers, {
    spec,
    approxCost: (o) => {
      let v = approx.get(o.id);
      if (v === undefined) {
        v = approxOfferCost(o, costCtx);
        approx.set(o.id, v);
      }
      return v;
    },
    sameCity,
    transferMinutes,
    allowStopovers: req.strategy.longStopovers,
  });

  const assembleCtx: AssembleContext = {
    ...costCtx,
    spec,
    now,
    airport: (code) => {
      const a = getAirport(code);
      return a ? { country: a.country, city: a.city, countryName: a.countryName } : undefined;
    },
    sameCity,
    transfer: estimateTransfer,
    hotelNightEur,
    distanceKm,
    entryZone,
    noAirsideTransit: (c) => NO_AIRSIDE_TRANSIT.has(c),
  };
  const built: Itinerary[] = [];
  for (const d of combined.drafts) {
    const it = assemble(d, assembleCtx);
    if (it) built.push(it);
  }
  const unique = dedupe(built);
  const candidates = prune(unique, deps.maxCandidates);
  const baseline = conventionalBaseline(candidates);

  const airports: Record<string, AirportInfo> = {};
  const addAirport = (code: string) => {
    if (!airports[code]) airports[code] = airportInfo(code);
  };
  for (const it of candidates) {
    for (const j of it.journeys) {
      j.segments.forEach((s) => {
        addAirport(s.origin);
        addAirport(s.destination);
      });
      j.accessTransfers.forEach((t) => {
        addAirport(t.from);
        addAirport(t.to);
      });
    }
  }
  for (const j of spec.journeys) [...j.origins, ...j.destinations].forEach(addAirport);

  const statuses: ProviderStatus[] = [
    ...orchestrated.statuses,
    ...inactive.map((p) => ({
      id: p.id,
      name: p.name,
      status: 'not-configured' as const,
      dataQuality: 'live' as const,
      callsPlanned: 0,
      callsMade: 0,
      cacheHits: 0,
      failures: 0,
      skippedByBudget: 0,
      offers: 0,
      durationMs: 0,
      message: p.reason,
    })),
  ];
  const qualities = new Set(orchestrated.statuses.filter((s) => s.offers > 0).map((s) => (s.dataQuality === 'demo' ? 'demo' : 'live')));
  const dataMode: SearchResponse['dataMode'] = qualities.size === 0 ? 'none' : qualities.size === 2 ? 'mixed' : qualities.has('demo') ? 'demo' : 'live';

  const warnings: string[] = [];
  if (dataMode === 'demo' || dataMode === 'mixed') {
    warnings.push('Demo data: results marked "Demo" are generated by a fictional network for illustration. They are not real fares or flights.');
  }
  for (const s of orchestrated.statuses) {
    if (s.status === 'failed' || s.status === 'timeout' || s.status === 'partial') warnings.push(`${s.name}: ${s.message ?? s.status}`);
  }
  if (active.length === 0) warnings.push('No flight data source is enabled. Configure a provider (see README).');

  const stats = {
    tasksPlanned: tasks.length,
    tasksExecuted: orchestrated.tasksExecuted,
    offersReceived: orchestrated.offers.length,
    itinerariesBuilt: built.length,
    itinerariesAfterDedupe: unique.length,
    candidatesReturned: candidates.length,
    durationMs: Date.now() - started,
  };
  log.info('search.done', {
    tripType: req.tripType,
    dateMode: req.dates.mode,
    route: spec.journeys.map((j) => `${j.originLocations.join('/')}-${j.destinationLocations.join('/')}`).join(','),
    ...stats,
    journeyOptions: combined.stats.journeyOptions,
  });

  return {
    searchId: shortHash(`${requestId}|${now}`),
    generatedAt: now,
    currency: req.currency,
    dataMode,
    airports,
    candidates,
    baselineId: baseline?.id,
    providers: statuses,
    searchedDates: [...spec.journeys[0].dates].sort(),
    stats,
    warnings,
    fx: { source: fx.source, asOf: fx.asOf },
  };
}
