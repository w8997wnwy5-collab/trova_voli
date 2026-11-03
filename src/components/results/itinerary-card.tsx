'use client';

import { ChevronDown, Heart, Link2 } from 'lucide-react';
import { useId } from 'react';
import { Badge, type Tone } from '@/components/ui/badge';
import { cn } from '@/components/ui/cn';
import { fmtMoney } from '@/lib/client/format';
import type { TripStrategy } from '@/lib/domain/strategy';
import type { AirportInfo, ItineraryTag, TripType } from '@/lib/domain/types';
import type { Explanation } from '@/lib/engine/explain';
import type { RankResult, Scored } from '@/lib/engine/rank';
import { dayOffset, formatDuration, formatTime } from '@/lib/util/format';
import { ItineraryDetails, journeyTitle } from './itinerary-details';

const TAG_LABEL: Partial<Record<ItineraryTag, { label: string; tone: Tone }>> = {
  conventional: { label: 'Conventional', tone: 'neutral' },
  'split-ticket': { label: 'Separate tickets', tone: 'brand' },
  'self-transfer': { label: 'Self-transfer', tone: 'warn' },
  'airport-change': { label: 'Airport change', tone: 'warn' },
  'nearby-airport': { label: 'Nearby airport', tone: 'brand' },
  positioning: { label: 'Positioning flight', tone: 'brand' },
  'overnight-layover': { label: 'Overnight layover', tone: 'warn' },
  'red-eye': { label: 'Overnight flight', tone: 'neutral' },
  'long-stopover': { label: 'Stopover', tone: 'brand' },
  'different-return-airport': { label: 'Different return airport', tone: 'neutral' },
  demo: { label: 'Demo data', tone: 'demo' },
  test: { label: 'Test mode', tone: 'warn' },
};

const RISK_TONE = { low: 'good', medium: 'warn', high: 'bad' } as const;

export interface CardProps {
  scored: Scored;
  ranking: RankResult;
  explanation: Explanation;
  airports: Record<string, AirportInfo>;
  strategy: TripStrategy;
  tripType: TripType;
  expanded: boolean;
  onToggle: () => void;
  compared: boolean;
  onCompare: (on: boolean) => void;
  compareDisabled: boolean;
  favorite: boolean;
  onFavorite: () => void;
  onShare: () => void;
  focused: boolean;
  now: number;
}

export function ItineraryCard(p: CardProps) {
  const { scored, ranking, explanation } = p;
  const it = scored.it;
  const id = useId();
  const cur = it.cost.total.currency;
  const travellers = it.cost.travelers;
  const labels: { label: string; tone: Tone }[] = [];
  if (ranking.bestValueId === it.id) labels.push({ label: 'Best value', tone: 'good' });
  if (ranking.cheapestId === it.id) labels.push({ label: 'Cheapest', tone: 'good' });
  if (ranking.fastestId === it.id) labels.push({ label: 'Fastest', tone: 'good' });
  const tags = it.tags.map((t) => TAG_LABEL[t]).filter((t): t is { label: string; tone: Tone } => Boolean(t));
  const savings = explanation.savingsVsBaseline;

  return (
    <article
      id={`it-${it.id}`}
      aria-labelledby={`${id}-title`}
      className={cn('rounded-2xl border bg-surface p-4 shadow-sm transition-shadow sm:p-5', p.focused ? 'border-brand ring-2 ring-brand/40' : 'border-line')}
    >
      <h3 id={`${id}-title`} className="sr-only">
        {it.journeys.map((j) => `${j.origin} to ${j.destination}`).join(', ')} for {fmtMoney(scored.total, cur)}
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l) => (
            <Badge key={l.label} tone={l.tone} className="font-semibold">
              {l.label}
            </Badge>
          ))}
          {tags.map((t) => (
            <Badge key={t.label} tone={t.tone}>
              {t.label}
            </Badge>
          ))}
        </div>
        <span className="text-xs text-ink-muted" title="Value score: weighted mix of cost, time, stops, risk, airport changes and your preferences">
          Value <strong className="tabular text-sm text-ink">{Math.round(scored.score)}</strong>/100
        </span>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="grid gap-3">
          {it.journeys.map((j) => {
            const plus = dayOffset(j.departureLocal, j.arrivalLocal);
            const carriers = [...new Set(j.segments.map((s) => s.marketingCarrier.name))].join(' + ');
            const self = j.connections.filter((c) => c.kind === 'self-transfer').length;
            const via = j.connections.map((c) => (c.airportChange ? `${c.arrivalAirport}→${c.departureAirport}` : c.arrivalAirport)).join(', ');
            return (
              <div key={j.index} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 sm:grid-cols-[5.5rem_1fr]">
                <span className="text-xs font-medium text-ink-muted">{journeyTitle(j, it.journeys.length, p.tripType)}</span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="tabular text-base font-semibold">
                    {formatTime(j.departureLocal)} {j.origin} → {formatTime(j.arrivalLocal)}
                    {plus > 0 && <sup className="ml-0.5 text-xs text-warn">+{plus}</sup>} {j.destination}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {formatDuration(j.flightTimeMinutes)} · {j.stops === 0 ? 'Direct' : `${j.stops} stop${j.stops > 1 ? 's' : ''} (${via})`}
                    {self > 0 && <span className="text-warn"> · self-transfer</span>}
                  </span>
                  <span className="text-sm text-ink-muted">{carriers}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-row items-end justify-between gap-3 md:flex-col md:items-end md:justify-start">
          <div className="text-left md:text-right">
            <div className="tabular text-2xl font-bold">{fmtMoney(scored.total, cur)}</div>
            <div className="tabular text-xs text-ink-muted">
              {travellers > 1 ? `${fmtMoney(Math.round(scored.total / travellers), cur)} per traveller · ` : ''}total incl. extras
            </div>
            {savings !== null && savings > 0 && !it.attrs.conventional && (
              <div className="tabular mt-1 text-sm font-semibold text-good">Save {fmtMoney(savings, cur)} vs conventional</div>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge tone={RISK_TONE[it.risk.level]}>{it.risk.level === 'low' ? 'Low' : it.risk.level === 'medium' ? 'Medium' : 'High'} risk</Badge>
            <Badge tone={it.confidence.level === 'high' ? 'good' : it.confidence.level === 'medium' ? 'neutral' : 'warn'} title={it.confidence.reasons.join(' ')}>
              {it.confidence.level} confidence
            </Badge>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={p.onToggle}
          aria-expanded={p.expanded}
          aria-controls={`${id}-details`}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-brand hover:bg-brand-soft"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', p.expanded && 'rotate-180')} aria-hidden />
          {p.expanded ? 'Hide details' : 'Details, costs & why'}
        </button>
        <div className="flex items-center gap-1">
          <label className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm', p.compareDisabled && !p.compared ? 'opacity-50' : 'cursor-pointer hover:bg-subtle')}>
            <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={p.compared} disabled={p.compareDisabled && !p.compared} onChange={(e) => p.onCompare(e.target.checked)} />
            Compare
          </label>
          <button type="button" onClick={p.onFavorite} aria-pressed={p.favorite} className="rounded-lg p-2 hover:bg-subtle" aria-label={p.favorite ? 'Remove from favourites' : 'Save to favourites'}>
            <Heart className={cn('h-4 w-4', p.favorite ? 'fill-bad text-bad' : 'text-ink-muted')} aria-hidden />
          </button>
          <button type="button" onClick={p.onShare} className="rounded-lg p-2 text-ink-muted hover:bg-subtle" aria-label="Copy a link to this itinerary">
            <Link2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <div id={`${id}-details`} hidden={!p.expanded}>
        {p.expanded && <ItineraryDetails scored={scored} ranking={ranking} explanation={explanation} airports={p.airports} strategy={p.strategy} now={p.now} />}
      </div>
    </article>
  );
}
