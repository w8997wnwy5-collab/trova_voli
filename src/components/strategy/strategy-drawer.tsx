'use client';

import { RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Segmented } from '@/components/ui/segmented';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { PRESET_LABELS, presetStrategy, resolveWeights, SCORE_COMPONENTS, type RuleKey, type RuleMode, type TripStrategy, type Weights } from '@/lib/domain/strategy';
import { RULE_ALTERNATIVES, type ControlImpact, type ControlKey } from '@/lib/engine/impact';
import { COMPONENT_LABELS } from '@/lib/engine/rank';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: TripStrategy;
  onChange: (s: TripStrategy) => void;
  impacts?: Record<ControlKey, ControlImpact>;
  summary?: { count: number; cheapest: number | null };
  formatMoney?: (minor: number) => string;
}

const RULE_TEXT: Record<RuleKey, { label: string; help: string }> = {
  maxStops: { label: 'Maximum stops', help: 'Per direction.' },
  maxDoorToDoorHours: { label: 'Maximum door-to-door time', help: 'Per direction, including ~2h at airports and transfers to nearby airports.' },
  selfTransfer: { label: 'Self-transfer tolerance', help: 'Connecting between separate tickets: you collect bags and check in again, and missed flights are your risk.' },
  airportChange: { label: 'Airport changes', help: 'Landing at one airport and leaving from another (e.g. Gatwick → Stansted).' },
  connectionSafety: { label: 'Minimum connection safety', help: 'Buffer on top of the recommended connection time: comfortable +25%, very safe +50%.' },
  overnightFlights: { label: 'Overnight flights', help: 'Flights airborne between 01:00 and 04:00.' },
  overnightLayovers: { label: 'Overnight layovers', help: 'Waiting at a connection overnight.' },
  bagsIncluded: { label: 'Baggage included', help: 'Require fares that already include your bags (otherwise their price is added).' },
  splitTickets: { label: 'Separate tickets', help: 'Combine tickets from different airlines or sellers, e.g. separate outbound and return.' },
  nearbyAirports: { label: 'Nearby airports', help: 'Fly from or to other airports within your search radius; transfer cost and time are added.' },
  avoidEntryRequirements: { label: 'Transit visa / entry', help: 'Avoid connections that need entering a third country (self-transfers) or US/Canada transit.' },
  flexibleTicket: { label: 'Changeable fares', help: 'Prefer fares that allow date changes.' },
  weekendTiming: { label: 'Weekend timing', help: 'Leave Thursday–Saturday and come back Sunday–Monday.' },
};

const SECTIONS: { title: string; rules: RuleKey[] }[] = [
  { title: 'Route & airports', rules: ['maxStops', 'nearbyAirports'] },
  { title: 'Tickets & connections', rules: ['splitTickets', 'selfTransfer', 'airportChange', 'connectionSafety'] },
  { title: 'Time', rules: ['maxDoorToDoorHours', 'overnightFlights', 'overnightLayovers', 'weekendTiming'] },
  { title: 'Bags, fares & entry rules', rules: ['bagsIncluded', 'flexibleTicket', 'avoidEntryRequirements'] },
];

function Delta({ value, base, format }: { value: number | null; base: number | null; format: (n: number) => string }) {
  if (value === null || base === null || value === base) return null;
  const d = value - base;
  return <span className={cn('tabular', d < 0 ? 'text-good' : 'text-ink-muted')}>{d < 0 ? `−${format(-d)}` : `+${format(d)}`}</span>;
}

function ImpactText({ count, cheapest, base, format }: { count: number; cheapest: number | null; base: number | null; format: (n: number) => string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
      <span className="tabular">
        {count} option{count === 1 ? '' : 's'}
      </span>
      {cheapest !== null && <span className="tabular">· from {format(cheapest)}</span>}
      <Delta value={cheapest} base={base} format={format} />
    </span>
  );
}

function RuleControl({
  ruleKey,
  strategy,
  onChange,
  impact,
  base,
  format,
}: {
  ruleKey: RuleKey;
  strategy: TripStrategy;
  onChange: (s: TripStrategy) => void;
  impact?: ControlImpact;
  base: number | null;
  format: (n: number) => string;
}) {
  const id = useId();
  const rule = strategy[ruleKey];
  const text = RULE_TEXT[ruleKey];
  const set = (value: unknown, mode: RuleMode = rule.mode) => onChange({ ...strategy, preset: 'custom', [ruleKey]: { value, mode } } as TripStrategy);
  return (
    <fieldset className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <legend className="text-sm font-semibold">{text.label}</legend>
          <p id={`${id}-help`} className="mt-0.5 text-xs text-ink-muted">
            {text.help}
          </p>
        </div>
        <Segmented<RuleMode>
          label={`${text.label}: must-have or preference`}
          size="sm"
          className="shrink-0 flex-nowrap"
          value={rule.mode}
          onChange={(m) => set(rule.value, m)}
          options={[
            { value: 'hard', label: 'Must', hint: 'Hide options that break this rule' },
            { value: 'soft', label: 'Prefer', hint: 'Keep them, but rank them lower' },
          ]}
        />
      </div>
      <div role="radiogroup" aria-label={text.label} aria-describedby={`${id}-help`} className="mt-3 grid gap-1.5">
        {RULE_ALTERNATIVES[ruleKey].map((alt, i) => {
          const active = alt.value === rule.value;
          const opt = impact?.options[i];
          return (
            <button
              key={String(alt.value)}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => set(alt.value)}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                active ? 'border-brand bg-brand-soft' : 'border-transparent bg-subtle hover:border-line',
              )}
            >
              <span className={cn('font-medium', active && 'text-brand-strong')}>{alt.label}</span>
              {opt && <ImpactText count={opt.count} cheapest={opt.cheapest} base={base} format={format} />}
            </button>
          );
        })}
      </div>
      {rule.mode === 'soft' && impact?.hardCount !== undefined && (
        <p className="mt-2 text-xs text-ink-muted">Preference only: options that break it stay visible but rank lower ({impact.hardCount} fully match).</p>
      )}
    </fieldset>
  );
}

function ToggleControl({
  label,
  help,
  checked,
  onChange,
  impact,
  base,
  format,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  impact?: ControlImpact;
  base: number | null;
  format: (n: number) => string;
}) {
  const id = useId();
  const other = impact?.options.find((o) => o.value === !checked);
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line p-3">
      <div>
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-ink-muted">{help}</p>
        {other && (
          <p className="mt-1 text-xs text-ink-muted">
            {checked ? 'If off: ' : 'If on: '}
            <ImpactText count={other.count} cheapest={other.cheapest} base={base} format={format} />
          </p>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function WeightsEditor({ strategy, onChange }: { strategy: TripStrategy; onChange: (s: TripStrategy) => void }) {
  const weights = resolveWeights(strategy);
  const current: Weights = strategy.weights ?? (Object.fromEntries(SCORE_COMPONENTS.map((k) => [k, Math.round(weights[k] * 100)])) as Weights);
  return (
    <div className="mt-3 grid gap-3">
      {SCORE_COMPONENTS.map((k) => (
        <div key={k} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span>{COMPONENT_LABELS[k]}</span>
          <Slider
            thumbLabel={`${COMPONENT_LABELS[k]} weight`}
            min={0}
            max={100}
            step={1}
            value={[current[k]]}
            onValueChange={([v]) => onChange({ ...strategy, preset: 'custom', weights: { ...current, [k]: v } })}
          />
          <span className="tabular text-right text-ink-muted">{Math.round(weights[k] * 100)}%</span>
        </div>
      ))}
      {strategy.weights && (
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => onChange({ ...strategy, preset: 'custom', weights: undefined })}>
          Use the Save ↔ Comfort slider again
        </Button>
      )}
    </div>
  );
}

export function StrategyDrawer({ open, onOpenChange, strategy, onChange, impacts, summary, formatMoney }: Props) {
  const [showWeights, setShowWeights] = useState(false);
  const format = formatMoney ?? ((n: number) => String(n));
  const base = summary?.cheapest ?? null;
  const weights = resolveWeights(strategy);
  const sliderId = useId();
  const basePreset = strategy.preset === 'custom' ? 'balanced' : strategy.preset;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Trip strategy"
        description={
          summary ? (
            <span aria-live="polite">
              <strong className="tabular text-ink">{summary.count}</strong> option{summary.count === 1 ? '' : 's'} match
              {summary.cheapest !== null && (
                <>
                  {' '}
                  · cheapest <strong className="tabular text-ink">{format(summary.cheapest)}</strong>
                </>
              )}
            </span>
          ) : (
            'Rules apply instantly to your results.'
          )
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => onChange(presetStrategy(basePreset))}>
              <RotateCcw className="h-4 w-4" aria-hidden /> Reset to {PRESET_LABELS[basePreset].label}
            </Button>
            <Button onClick={() => onOpenChange(false)}>{summary ? `Show ${summary.count} options` : 'Done'}</Button>
          </div>
        }
      >
        <section aria-labelledby={`${sliderId}-label`} className="rounded-xl border border-line p-3">
          <div id={`${sliderId}-label`} className="text-sm font-semibold">
            What matters more?
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-medium text-ink-muted">
            <span>Save as much as possible</span>
            <span>Prioritise comfort</span>
          </div>
          <Slider
            className="mt-2"
            thumbLabel="Save as much as possible versus prioritise comfort"
            min={0}
            max={100}
            step={5}
            value={[strategy.priority]}
            disabled={Boolean(strategy.weights)}
            onValueChange={([v]) => onChange({ ...strategy, preset: 'custom', priority: v })}
          />
          <p className="mt-2 text-xs text-ink-muted">
            Ranking weights:{' '}
            {SCORE_COMPONENTS.map((k) => `${COMPONENT_LABELS[k]} ${Math.round(weights[k] * 100)}%`).join(' · ')}
          </p>
          <button type="button" className="mt-2 text-xs font-medium text-brand underline-offset-2 hover:underline" aria-expanded={showWeights} onClick={() => setShowWeights((v) => !v)}>
            {showWeights ? 'Hide custom weights' : 'Set custom ranking weights'}
          </button>
          {showWeights && <WeightsEditor strategy={strategy} onChange={onChange} />}
        </section>

        {SECTIONS.map((section) => (
          <section key={section.title} className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{section.title}</h3>
            <div className="grid gap-3">
              {section.rules.map((key) => (
                <RuleControl key={key} ruleKey={key} strategy={strategy} onChange={onChange} impact={impacts?.[key]} base={base} format={format} />
              ))}
              {section.title === 'Route & airports' && (
                <>
                  <ToggleControl
                    label="Show me unusual but cheaper routes"
                    help="Positioning flights to a hub, detours and other non-obvious combinations."
                    checked={strategy.unusualRoutes}
                    onChange={(v) => onChange({ ...strategy, preset: 'custom', unusualRoutes: v })}
                    impact={impacts?.unusualRoutes}
                    base={base}
                    format={format}
                  />
                  <ToggleControl
                    label="Long stopover opportunities"
                    help="Spend 1–3 days in a connecting city (search again to look for more)."
                    checked={strategy.longStopovers}
                    onChange={(v) => onChange({ ...strategy, preset: 'custom', longStopovers: v })}
                    impact={impacts?.longStopovers}
                    base={base}
                    format={format}
                  />
                </>
              )}
              {section.title === 'Time' && (
                <ToggleControl
                  label="Add a hotel for overnight connections"
                  help="Includes an estimated airport-hotel night in the total when you wait overnight."
                  checked={strategy.includeHotel}
                  onChange={(v) => onChange({ ...strategy, preset: 'custom', includeHotel: v })}
                  impact={impacts?.includeHotel}
                  base={base}
                  format={format}
                />
              )}
            </div>
          </section>
        ))}
      </SheetContent>
    </Sheet>
  );
}
