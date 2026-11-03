'use client';

import { Armchair, Briefcase, CalendarHeart, PiggyBank, Scale, Wrench } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { PRESET_LABELS, presetStrategy, type PresetId, type TripStrategy } from '@/lib/domain/strategy';

const ICONS: Record<PresetId, typeof PiggyBank> = {
  cheapest: PiggyBank,
  balanced: Scale,
  comfortable: Armchair,
  weekend: CalendarHeart,
  business: Briefcase,
  custom: Wrench,
};

export interface PresetSummary {
  count: number;
  cheapest: string | null;
}

/** One-click strategies. "Custom" is selected automatically after any manual change. */
export function PresetChips({
  value,
  onChange,
  summaries,
  onWeekend,
}: {
  value: TripStrategy;
  onChange: (s: TripStrategy) => void;
  summaries?: Partial<Record<PresetId, PresetSummary>>;
  onWeekend?: () => void;
}) {
  const ids = Object.keys(PRESET_LABELS) as PresetId[];
  return (
    <div role="radiogroup" aria-label="Strategy preset" className="flex flex-wrap gap-2">
      {ids.map((id) => {
        const Icon = ICONS[id];
        const active = value.preset === id;
        const summary = summaries?.[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            title={PRESET_LABELS[id].hint}
            disabled={id === 'custom' && !active}
            onClick={() => {
              if (id === 'custom') return;
              onChange(presetStrategy(id));
              if (id === 'weekend') onWeekend?.();
            }}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:cursor-default',
              active ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink hover:border-brand/60',
              id === 'custom' && !active && 'opacity-60',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="font-medium">{PRESET_LABELS[id].label}</span>
            {summary && (
              <span className={cn('tabular text-xs', active ? 'text-brand-ink/90' : 'text-ink-muted')}>
                {summary.count ? `${summary.count} · ${summary.cheapest}` : 'none'}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
