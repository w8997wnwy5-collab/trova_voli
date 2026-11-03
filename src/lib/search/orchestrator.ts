import 'server-only';
import type { FareOffer, ProviderStatus } from '@/lib/domain/types';
import type { Logger } from '@/lib/server/logger';
import { ProviderError, type FlightProvider } from '@/lib/providers/types';
import type { OfferCache } from './cache';
import type { PlannedTask } from './plan';

export interface OrchestratorOptions {
  cache: OfferCache;
  requestId: string;
  now: number;
  /** Whole-search deadline; unfinished calls are aborted and reported. */
  deadlineMs: number;
  /** Fault injection (tests/demos). */
  failProviders?: string[];
  logger?: Logger;
}

export interface OrchestratorResult {
  offers: FareOffer[];
  statuses: ProviderStatus[];
  tasksExecuted: number;
}

// Identical provider calls running at the same time (e.g. two users, same route) share one request.
const inflight = new Map<string, Promise<FareOffer[]>>();

function singleFlight(key: string, fn: () => Promise<FareOffer[]>): Promise<FareOffer[]> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Error && err.name === 'AbortError') return new ProviderError('Request aborted', 'timeout', true);
  return new ProviderError(err instanceof Error ? err.message : 'Unknown provider error', 'upstream');
}

async function callWithTimeout(p: FlightProvider, task: PlannedTask, opts: OrchestratorOptions, deadline: AbortSignal): Promise<FareOffer[]> {
  if (opts.failProviders?.includes(p.id)) {
    await new Promise((r) => setTimeout(r, 20));
    throw new ProviderError(`${p.name} is unavailable (simulated outage)`, 'simulated');
  }
  const controller = new AbortController();
  const onDeadline = () => controller.abort();
  deadline.addEventListener('abort', onDeadline);
  const timer = setTimeout(() => controller.abort(), p.limits.timeoutMs);
  try {
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new ProviderError(`${p.name} timed out`, 'timeout', true)));
    });
    return await Promise.race([p.search(task.query, { signal: controller.signal, requestId: opts.requestId, now: opts.now }), aborted]);
  } finally {
    clearTimeout(timer);
    deadline.removeEventListener('abort', onDeadline);
  }
}

/** Marks offers served from cache. Demo/test data keep their label. */
function fromCache(offers: FareOffer[]): FareOffer[] {
  return offers.map((o) => (o.dataQuality === 'live' ? { ...o, dataQuality: 'cached' as const } : o));
}

async function runForProvider(
  p: FlightProvider,
  tasks: PlannedTask[],
  opts: OrchestratorOptions,
  deadline: AbortSignal,
): Promise<{ status: ProviderStatus; offers: FareOffer[]; executed: number }> {
  const started = Date.now();
  const runnable = tasks.slice(0, p.limits.maxCallsPerSearch);
  const skippedByBudget = tasks.length - runnable.length;
  const offers: FareOffer[] = [];
  let next = 0;
  let callsMade = 0;
  let cacheHits = 0;
  let succeeded = 0;
  let failures = 0;
  let timeouts = 0;
  let stopped = false;
  let lastError: ProviderError | undefined;

  const worker = async () => {
    while (!stopped && !deadline.aborted) {
      const i = next++;
      if (i >= runnable.length) return;
      const task = runnable[i];
      const cacheKey = `${p.id}:${task.key}`;
      const injected = opts.failProviders?.includes(p.id);
      try {
        const cached = injected ? undefined : await opts.cache.get(cacheKey);
        if (cached) {
          cacheHits++;
          succeeded++;
          offers.push(...fromCache(cached));
          continue;
        }
        callsMade++;
        const result = await singleFlight(cacheKey, () => callWithTimeout(p, task, opts, deadline));
        succeeded++;
        offers.push(...result);
        await opts.cache.set(cacheKey, result, p.limits.cacheTtlSeconds);
      } catch (err) {
        const e = toProviderError(err);
        failures++;
        if (e.kind === 'timeout') timeouts++;
        lastError = e;
        // Circuit breaker: do not hammer a provider that rejects us.
        if (e.kind === 'auth' || e.kind === 'rate-limit' || e.kind === 'simulated') stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(p.limits.maxConcurrency, runnable.length)) }, worker));

  const attempted = succeeded + failures;
  const notRun = runnable.length - attempted;
  let status: ProviderStatus['status'] = 'ok';
  let message: string | undefined;
  if (tasks.length === 0) {
    status = 'skipped';
    message = 'No route in this search is covered by this source';
  } else if (succeeded === 0) {
    status = failures > 0 && timeouts === failures ? 'timeout' : 'failed';
    message = lastError?.message ?? 'Stopped at the search deadline';
  } else if (failures > 0 || notRun > 0) {
    status = 'partial';
    message = lastError ? `${failures} of ${attempted} calls failed: ${lastError.message}` : `Stopped at the search deadline (${notRun} calls not made)`;
  } else if (skippedByBudget > 0) {
    message = `Searched the ${runnable.length} most promising of ${tasks.length} route/date combinations (call budget)`;
  }

  opts.logger?.info('provider.done', {
    provider: p.id,
    status,
    calls: callsMade,
    cacheHits,
    failures,
    skippedByBudget,
    offers: offers.length,
    ms: Date.now() - started,
    errorKind: lastError?.kind,
  });

  return {
    offers,
    executed: attempted,
    status: {
      id: p.id,
      name: p.name,
      status,
      dataQuality: p.capabilities.dataQuality,
      callsPlanned: tasks.length,
      callsMade,
      cacheHits,
      failures,
      skippedByBudget,
      offers: offers.length,
      durationMs: Date.now() - started,
      message,
    },
  };
}

/** Runs every provider concurrently; one provider failing never discards the others' results. */
export async function runProviderTasks(
  providers: FlightProvider[],
  assignment: Map<string, PlannedTask[]>,
  opts: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), opts.deadlineMs);
  try {
    const settled = await Promise.allSettled(providers.map((p) => runForProvider(p, assignment.get(p.id) ?? [], opts, deadline.signal)));
    const offers = new Map<string, FareOffer>();
    const statuses: ProviderStatus[] = [];
    let tasksExecuted = 0;
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        for (const o of r.value.offers) if (!offers.has(o.id)) offers.set(o.id, o);
        statuses.push(r.value.status);
        tasksExecuted += r.value.executed;
      } else {
        const p = providers[i];
        statuses.push({
          id: p.id,
          name: p.name,
          status: 'failed',
          dataQuality: p.capabilities.dataQuality,
          callsPlanned: assignment.get(p.id)?.length ?? 0,
          callsMade: 0,
          cacheHits: 0,
          failures: 1,
          skippedByBudget: 0,
          offers: 0,
          durationMs: 0,
          message: 'Unexpected error',
        });
      }
    });
    return { offers: [...offers.values()], statuses, tasksExecuted };
  } finally {
    clearTimeout(timer);
  }
}
