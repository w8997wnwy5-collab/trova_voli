'use client';

import { cn } from '@/components/ui/cn';
import { fmtMoney } from '@/lib/client/format';
import { formatDay } from '@/lib/util/format';

export interface CalendarCell {
  date: string;
  min: number | null;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month grid of the cheapest total per departure date under the current filters. */
export function CalendarHeatmap({
  cells,
  currency,
  selected,
  onSelect,
}: {
  cells: CalendarCell[];
  currency: string;
  selected?: string;
  onSelect: (date: string | undefined) => void;
}) {
  if (cells.length < 2) return null;
  const prices = cells.map((c) => c.min).filter((m): m is number => m !== null).sort((a, b) => a - b);
  const q1 = prices[Math.floor(prices.length / 3)] ?? 0;
  const q2 = prices[Math.floor((prices.length * 2) / 3)] ?? 0;
  const byDate = new Map(cells.map((c) => [c.date, c]));
  const first = new Date(`${cells[0].date}T00:00:00Z`);
  const last = new Date(`${cells[cells.length - 1].date}T00:00:00Z`);
  // Grid from the Monday on/before the first date to the Sunday on/after the last one.
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const days: string[] = [];
  for (const d = new Date(start); d <= last || (d.getUTCDay() + 6) % 7 !== 0; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const tone = (m: number | null) => (m === null ? 'bg-subtle text-ink-muted' : m <= q1 ? 'bg-good-soft text-good' : m <= q2 ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad');
  return (
    <section aria-labelledby="cal-title" className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cal-title" className="text-sm font-semibold">
          Cheapest total by departure date
        </h2>
        <div className="flex items-center gap-3 text-xs text-ink-muted">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-good-soft" aria-hidden /> cheaper
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-bad-soft" aria-hidden /> pricier
          </span>
          <span className="flex items-center gap-1">
            <span className="hatched h-3 w-3 rounded border border-line" aria-hidden /> not searched
          </span>
          {selected && (
            <button type="button" className="font-medium text-brand hover:underline" onClick={() => onSelect(undefined)}>
              Show all dates
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center" role="group" aria-label="Departure dates">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-[11px] font-medium uppercase text-ink-muted" aria-hidden>
            {d}
          </div>
        ))}
        {days.map((date) => {
          const cell = byDate.get(date);
          const day = Number(date.slice(8));
          if (!cell) {
            return (
              <div key={date} className="hatched rounded-lg py-2 text-xs text-ink-muted/60" aria-hidden>
                {day}
              </div>
            );
          }
          const isSel = selected === date;
          return (
            <button
              key={date}
              type="button"
              aria-pressed={isSel}
              aria-label={`${formatDay(date)}: ${cell.min === null ? 'no matching options' : `from ${fmtMoney(cell.min, currency)}`}`}
              disabled={cell.min === null}
              onClick={() => onSelect(isSel ? undefined : date)}
              className={cn('rounded-lg px-0.5 py-1.5 text-xs transition-shadow disabled:cursor-not-allowed', tone(cell.min), isSel && 'ring-2 ring-brand')}
            >
              <span className="block font-semibold">{day}</span>
              <span className="tabular block text-[10px] sm:text-[11px]">{cell.min === null ? '—' : fmtMoney(cell.min, currency, true)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
