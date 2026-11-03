'use client';

import { Copy, Pencil, SlidersHorizontal } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formFromUrl } from '@/components/search/form-state';
import { SearchForm } from '@/components/search/search-form';
import { PresetChips, type PresetSummary } from '@/components/strategy/preset-chips';
import { StrategyDrawer } from '@/components/strategy/strategy-drawer';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { useFavorites } from '@/lib/client/favorites';
import { fmtMoney } from '@/lib/client/format';
import { useSearch } from '@/lib/client/use-search';
import { PRESET_IDS, presetStrategy, type PresetId, type TripStrategy } from '@/lib/domain/strategy';
import type { Itinerary } from '@/lib/domain/types';
import { explain } from '@/lib/engine/explain';
import { applyStrategy, effectiveTotal } from '@/lib/engine/filters';
import { computeImpacts, CONTROL_LABELS, suggestRelaxations } from '@/lib/engine/impact';
import { rank, type SortKey } from '@/lib/engine/rank';
import { formatDay } from '@/lib/util/format';
import { decodeSearch, encodeSearch, searchKey, type UrlState } from '@/lib/url/search-url';
import { CalendarHeatmap } from './calendar-heatmap';
import { CompareDialog } from './compare-dialog';
import { ItineraryCard } from './itinerary-card';
import { ProviderStatusBar } from './provider-status';
import { EmptyState, ErrorState, LoadingState } from './states';
import { SummaryCards } from './summary-cards';

const EMPTY: Itinerary[] = [];
const PAGE = 15;
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'best', label: 'Best value' },
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'fastest', label: 'Fastest' },
  { value: 'stops', label: 'Fewest stops' },
  { value: 'risk', label: 'Lowest risk' },
];

function useLocationLabels(codes: string[]): Record<string, string> {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const key = codes.join(',');
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    fetch(`/api/airports?codes=${key}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((j: { results: { code: string; label: string }[] }) => setLabels(Object.fromEntries(j.results.map((r) => [r.code, r.label]))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [key]);
  return labels;
}

function describeTrip(url: UrlState, labels: Record<string, string>): string {
  const r = url.request;
  const name = (c?: string) => (c ? (labels[c] ?? c) : '?');
  const route = r.slices.map((s) => `${name(s.from[0])} → ${name(s.to[0])}`).join(', ');
  const d = r.dates;
  let dates = '';
  if (r.tripType === 'multi-city' || r.tripType === 'open-jaw') dates = r.slices.map((s) => (s.date ? formatDay(s.date) : '')).join(' · ');
  else if (d?.mode === 'window') dates = `leave ${d.windowStart ? formatDay(d.windowStart) : ''} – ${d.windowEnd ? formatDay(d.windowEnd) : ''}`;
  else if (d?.mode === 'month') dates = `any day in ${d.month}`;
  else dates = `${d?.depart ? formatDay(d.depart) : ''}${r.tripType === 'return' && d?.return ? ` – ${formatDay(d.return)}` : ''}${d?.mode === 'flexible' ? ` (±${d.flexDays}d)` : ''}`;
  const p = r.passengers;
  const pax = (p?.adults ?? 1) + (p?.children ?? 0) + (p?.infants ?? 0);
  return `${route} · ${dates} · ${pax} traveller${pax > 1 ? 's' : ''}`;
}

export function SearchExperience() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const url = useMemo(() => decodeSearch(new URLSearchParams(query)), [query]);
  const key = useMemo(() => `${searchKey(url)}|${url.simulate ?? ''}`, [url]);
  const ready = url.request.slices.length > 0 && url.request.slices.every((s) => s.from.length > 0 && s.to.length > 0);
  const [attempt, setAttempt] = useState(0);
  const apiRequest = useMemo(() => {
    if (!ready) return null;
    const fail = url.simulate?.startsWith('fail:') ? url.simulate.slice(5).split('+') : undefined;
    return { ...url.request, simulate: fail ? { failProviders: fail } : undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the search identity is `key`
  }, [key, ready]);
  const state = useSearch(apiRequest, key, attempt);
  const codes = useMemo(() => [...new Set(url.request.slices.flatMap((s) => [...s.from, ...s.to]))], [url]);
  const labels = useLocationLabels(codes);

  const [editing, setEditing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [toast, setToast] = useState<string | null>(null);
  const favorites = useFavorites();
  const focusHandled = useRef<string | null>(null);

  const strategy = url.request.strategy;
  const data = state.status === 'success' ? state.data : undefined;
  const candidates = data?.candidates ?? EMPTY;
  const currency = data?.currency ?? url.request.currency ?? 'EUR';
  const fmt = useCallback((n: number) => fmtMoney(n, currency), [currency]);
  const now = data?.generatedAt ?? 0;

  const replaceUrl = useCallback(
    (patch: Partial<Omit<UrlState, 'request'>> & { strategy?: TripStrategy }) => {
      const { strategy: s, ...rest } = patch;
      const next: UrlState = { ...url, ...rest, request: s ? { ...url.request, strategy: s } : url.request };
      window.history.replaceState(null, '', `/search?${encodeSearch(next)}`);
    },
    [url],
  );
  const setStrategy = useCallback((s: TripStrategy) => replaceUrl({ strategy: s }), [replaceUrl]);

  const filtered = useMemo(() => applyStrategy(candidates, strategy, { date: url.date }), [candidates, strategy, url.date]);
  const ranking = useMemo(() => rank(filtered.kept, strategy, url.sort), [filtered, strategy, url.sort]);
  const baselineTotal = useMemo(() => {
    const kept = filtered.kept.filter((e) => e.it.attrs.conventional).map((e) => e.total);
    if (kept.length) return Math.min(...kept);
    const all = candidates.filter((c) => c.attrs.conventional && (!url.date || c.attrs.outboundDate === url.date)).map((c) => effectiveTotal(c, strategy));
    return all.length ? Math.min(...all) : undefined;
  }, [filtered, candidates, url.date, strategy]);
  const impacts = useMemo(
    () => (data && (drawerOpen || ranking.items.length === 0) ? computeImpacts(candidates, strategy, { date: url.date }) : undefined),
    [data, drawerOpen, ranking.items.length, candidates, strategy, url.date],
  );
  const presetSummaries = useMemo(() => {
    if (!data) return undefined;
    const out: Partial<Record<PresetId, PresetSummary>> = {};
    for (const id of PRESET_IDS) {
      if (id === 'custom') continue;
      const r = applyStrategy(candidates, presetStrategy(id), { date: url.date });
      out[id] = { count: r.kept.length, cheapest: r.kept.length ? fmtMoney(Math.min(...r.kept.map((k) => k.total)), currency, true) : null };
    }
    return out;
  }, [data, candidates, url.date, currency]);
  const calendarCells = useMemo(() => {
    if (!data || data.searchedDates.length < 2) return [];
    const mins = new Map<string, number>();
    for (const e of applyStrategy(candidates, strategy).kept) {
      const d = e.it.attrs.outboundDate;
      mins.set(d, Math.min(mins.get(d) ?? Number.POSITIVE_INFINITY, e.total));
    }
    return data.searchedDates.map((date) => ({ date, min: mins.get(date) ?? null }));
  }, [data, candidates, strategy]);
  const suggestions = useMemo(() => {
    if (!data || ranking.items.length > 0 || candidates.length === 0) return [];
    return suggestRelaxations(candidates, strategy, { date: url.date }).map((s) => ({
      label: `${CONTROL_LABELS[s.key]}: ${s.label}`,
      detail: `${s.count} options${s.cheapest !== null ? ` from ${fmtMoney(s.cheapest, currency)}` : ''}`,
      apply: () => {
        const current = strategy[s.key as keyof TripStrategy];
        const value = typeof current === 'object' && current !== null && 'mode' in current ? { ...current, value: s.value } : s.value;
        setStrategy({ ...strategy, preset: 'custom', [s.key]: value } as TripStrategy);
      },
    }));
  }, [data, ranking.items.length, candidates, strategy, url.date, currency, setStrategy]);

  // Shared links: open and scroll to the focused itinerary once.
  const focusFound = url.focus ? ranking.items.some((i) => i.it.id === url.focus) : false;
  useEffect(() => {
    if (!url.focus || !data || focusHandled.current === `${key}|${url.focus}` || !focusFound) return;
    focusHandled.current = `${key}|${url.focus}`;
    const target = url.focus;
    queueMicrotask(() => setExpanded((prev) => new Set(prev).add(target)));
    setTimeout(() => document.getElementById(`it-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [url.focus, data, key, focusFound]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(msg);
    } catch {
      showToast('Copy failed — use the address bar instead');
    }
  };
  const itineraryLink = (id: string) => `${window.location.origin}/search?${encodeSearch({ ...url, focus: id, date: undefined })}`;
  const showItinerary = (id: string) => {
    const index = ranking.items.findIndex((i) => i.it.id === id);
    if (index >= limit) setLimit(index + 1);
    setExpanded((prev) => new Set(prev).add(id));
    setTimeout(() => document.getElementById(`it-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const focusIndex = url.focus ? ranking.items.findIndex((i) => i.it.id === url.focus) : -1;
  const visible = ranking.items.slice(0, Math.max(limit, focusIndex + 1));
  const compared = ranking.items.filter((i) => compare.includes(i.it.id));
  const formOpen = editing || !ready;

  return (
    <div className="grid gap-5">
      <section aria-label="Your search" className="rounded-2xl border border-line bg-surface p-4">
        {formOpen ? (
          <SearchForm
            key={`${key}|${Object.keys(labels).length}`}
            initial={formFromUrl(url, labels)}
            submitLabel={ready ? 'Update search' : 'Search flights'}
            onOpenStrategy={() => setDrawerOpen(true)}
            onSubmit={(request) => {
              setEditing(false);
              setLimit(PAGE);
              router.push(`/search?${encodeSearch({ request, sort: url.sort })}`);
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">{describeTrip(url, labels)}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit search
              </Button>
              <Button variant="outline" size="sm" onClick={() => copy(window.location.href, 'Search link copied')}>
                <Copy className="h-4 w-4" aria-hidden /> Copy search link
              </Button>
            </div>
          </div>
        )}
      </section>

      {ready && (
        <section aria-label="Strategy" className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <PresetChips value={strategy} onChange={setStrategy} summaries={presetSummaries} />
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Trip strategy
            {strategy.preset === 'custom' && <span className="rounded-full bg-brand px-1.5 text-xs text-brand-ink">custom</span>}
          </Button>
        </section>
      )}

      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState message={state.message} issues={state.issues} onRetry={() => setAttempt((a) => a + 1)} />}

      {data && (
        <>
          <ProviderStatusBar data={data} now={now} />
          {calendarCells.length > 1 && <CalendarHeatmap cells={calendarCells} currency={currency} selected={url.date} onSelect={(date) => replaceUrl({ date })} />}
          {ranking.items.length > 0 && <SummaryCards ranking={ranking} currency={currency} baselineTotal={baselineTotal} onShow={showItinerary} />}

          <section aria-labelledby="results-title" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="results-title" className="text-lg font-semibold" aria-live="polite">
                {ranking.items.length} option{ranking.items.length === 1 ? '' : 's'}
                {filtered.excluded > 0 && <span className="ml-2 text-sm font-normal text-ink-muted">· {filtered.excluded} hidden by your rules</span>}
                {url.date && <span className="ml-2 text-sm font-normal text-ink-muted">· departing {formatDay(url.date)}</span>}
              </h2>
              <Segmented<SortKey> label="Sort results" size="sm" value={url.sort} onChange={(sort) => replaceUrl({ sort })} options={SORT_OPTIONS} />
            </div>
            {baselineTotal !== undefined && ranking.items.length > 0 && (
              <p className="text-sm text-ink-muted">
                Best conventional itinerary (one ticket, your airports, no self-transfer): <strong className="tabular text-ink">{fmt(baselineTotal)}</strong>.
                Savings below are measured against it.
              </p>
            )}
            {url.focus && !focusFound && (
              <p role="status" className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
                The shared itinerary is not in the current results (prices or availability may have changed, or your rules hide it).
              </p>
            )}
            {ranking.items.length === 0 ? (
              <EmptyState total={candidates.length} suggestions={suggestions} />
            ) : (
              <ol className="grid gap-3">
                {visible.map((s) => (
                  <li key={s.it.id}>
                    <ItineraryCard
                      scored={s}
                      ranking={ranking}
                      explanation={explain(s, { ranking, baselineTotal, formatMoney: fmt })}
                      airports={data.airports}
                      strategy={strategy}
                      tripType={url.request.tripType ?? 'return'}
                      expanded={expanded.has(s.it.id)}
                      onToggle={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.it.id)) next.delete(s.it.id);
                          else next.add(s.it.id);
                          return next;
                        })
                      }
                      compared={compare.includes(s.it.id)}
                      compareDisabled={compare.length >= 3}
                      onCompare={(on) => setCompare((prev) => (on ? [...prev, s.it.id].slice(0, 3) : prev.filter((x) => x !== s.it.id)))}
                      favorite={favorites.isFavorite(s.it.id)}
                      onFavorite={() => {
                        const was = favorites.isFavorite(s.it.id);
                        favorites.toggle({
                          id: s.it.id,
                          search: encodeSearch({ ...url, focus: s.it.id, date: undefined }),
                          title: s.it.journeys.map((j) => `${j.origin} → ${j.destination}`).join(', '),
                          itinerary: s.it,
                        });
                        showToast(was ? 'Removed from favourites' : 'Saved to favourites (this browser only)');
                      }}
                      onShare={() => copy(itineraryLink(s.it.id), 'Itinerary link copied')}
                      focused={url.focus === s.it.id}
                      now={now}
                    />
                  </li>
                ))}
              </ol>
            )}
            {ranking.items.length > visible.length && (
              <Button variant="outline" className="justify-self-center" onClick={() => setLimit(visible.length + PAGE)}>
                Show {Math.min(PAGE, ranking.items.length - visible.length)} more
              </Button>
            )}
          </section>
        </>
      )}

      {compare.length > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 shadow-xl">
          <span className="text-sm">{compare.length} selected</span>
          <Button size="sm" disabled={compare.length < 2} onClick={() => setCompareOpen(true)}>
            Compare {compare.length}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCompare([])}>
            Clear
          </Button>
        </div>
      )}

      <StrategyDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        strategy={strategy}
        onChange={setStrategy}
        impacts={impacts}
        summary={data ? { count: ranking.items.length, cheapest: ranking.items.length ? ranking.minTotal : null } : undefined}
        formatMoney={fmt}
      />
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} items={compared} currency={currency} />
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
        {toast && <div className="rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-lg">{toast}</div>}
      </div>
    </div>
  );
}
