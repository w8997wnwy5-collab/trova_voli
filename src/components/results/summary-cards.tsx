'use client';

import { Gauge, PiggyBank, Zap } from 'lucide-react';
import { fmtMoney } from '@/lib/client/format';
import type { RankResult, Scored } from '@/lib/engine/rank';
import { formatDuration } from '@/lib/util/format';

function Card({ title, icon: Icon, s, currency, onShow, note }: { title: string; icon: typeof Zap; s?: Scored; currency: string; onShow: (id: string) => void; note?: string }) {
  if (!s) return null;
  return (
    <button
      type="button"
      onClick={() => onShow(s.it.id)}
      className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition-colors hover:border-brand"
    >
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <Icon className="h-4 w-4 text-brand" aria-hidden /> {title}
      </span>
      <span className="tabular text-2xl font-bold">{fmtMoney(s.total, currency)}</span>
      <span className="text-sm text-ink-muted">
        {formatDuration(s.it.attrs.totalMinutes)} door-to-door{s.it.journeys.length > 1 ? ' (all flights)' : ''} · {s.it.attrs.totalStops === 0 ? 'direct' : `${s.it.attrs.totalStops} stop${s.it.attrs.totalStops > 1 ? 's' : ''}`} ·{' '}
        {s.it.risk.level} risk
      </span>
      {note && <span className="text-sm font-medium text-good">{note}</span>}
    </button>
  );
}

export function SummaryCards({ ranking, currency, baselineTotal, onShow }: { ranking: RankResult; currency: string; baselineTotal?: number; onShow: (id: string) => void }) {
  const find = (id?: string) => ranking.items.find((i) => i.it.id === id);
  const best = find(ranking.bestValueId);
  const cheapest = find(ranking.cheapestId);
  const fastest = find(ranking.fastestId);
  const saving = (s?: Scored) => (s && baselineTotal !== undefined && baselineTotal - s.total > 0 ? `Saves ${fmtMoney(baselineTotal - s.total, currency)} vs conventional` : undefined);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card title="Best value" icon={Gauge} s={best} currency={currency} onShow={onShow} note={saving(best)} />
      <Card title="Cheapest" icon={PiggyBank} s={cheapest} currency={currency} onShow={onShow} note={saving(cheapest)} />
      <Card title="Fastest" icon={Zap} s={fastest} currency={currency} onShow={onShow} note={saving(fastest)} />
    </div>
  );
}
