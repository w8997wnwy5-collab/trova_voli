'use client';

import { ArrowLeftRight, Briefcase, Plus, Search, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented } from '@/components/ui/segmented';
import { Stepper } from '@/components/ui/stepper';
import { Switch } from '@/components/ui/switch';
import { useToday } from '@/lib/client/use-today';
import { SearchRequestSchema, SUPPORTED_CURRENCIES, addDays, type SupportedCurrency } from '@/lib/domain/schemas';
import type { TripStrategy } from '@/lib/domain/strategy';
import type { CabinClass, TripType } from '@/lib/domain/types';
import { PresetChips } from '../strategy/preset-chips';
import { defaultDates, formToRequest, type DateMode, type SearchFormState } from './form-state';
import { LocationInput } from './location-input';

const CABINS: { value: CabinClass; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

const fieldClass = 'h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink focus:border-brand focus:outline-none';
const labelClass = 'mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted';

function next12Months(today: string): { value: string; label: string }[] {
  if (!today) return [];
  const out = [];
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < 12; i++) {
    out.push({ value: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export function SearchForm({
  initial,
  onSubmit,
  onOpenStrategy,
  submitLabel = 'Search flights',
  showPresets = true,
}: {
  initial: SearchFormState;
  onSubmit: (request: ReturnType<typeof formToRequest>, form: SearchFormState) => void;
  onOpenStrategy?: (form: SearchFormState, update: (s: TripStrategy) => void) => void;
  submitLabel?: string;
  showPresets?: boolean;
}) {
  const [f, setF] = useState<SearchFormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const today = useToday();
  const defs = today ? defaultDates(today) : undefined;
  const ids = useId();
  const set = (patch: Partial<SearchFormState>) => setF((prev) => ({ ...prev, ...patch }));
  const multi = f.tripType === 'multi-city' || f.tripType === 'open-jaw';
  const err = (path: string) => errors[path];

  const setTripType = (t: TripType) => {
    setF((prev) => {
      let legs = prev.legs;
      if (t === 'open-jaw' && legs.length !== 2) legs = [legs[0], { from: legs[0].to, to: legs[0].from, date: '' }];
      if (t === 'multi-city' && legs.length < 2) legs = [legs[0], { from: legs[0].to, to: null, date: '' }];
      if (t === 'one-way' || t === 'return') legs = [legs[0]];
      const dateMode = (t === 'multi-city' || t === 'open-jaw') && (prev.dateMode === 'window' || prev.dateMode === 'month') ? 'exact' : prev.dateMode;
      return { ...prev, tripType: t, legs, dateMode };
    });
  };

  const updateLeg = (i: number, patch: Partial<SearchFormState['legs'][number]>) =>
    setF((prev) => ({ ...prev, legs: prev.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!today) return;
    const request = formToRequest(f, today);
    const parsed = SearchRequestSchema.safeParse(request);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        if (!next[path]) next[path] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onSubmit(request, f);
  };

  const travellers = f.adults + f.children + f.infants;
  const errorList = Object.entries(errors);
  const months = next12Months(today);

  return (
    <form onSubmit={submit} noValidate aria-label="Flight search" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<TripType>
          label="Trip type"
          value={f.tripType}
          onChange={setTripType}
          options={[
            { value: 'return', label: 'Return' },
            { value: 'one-way', label: 'One-way' },
            { value: 'open-jaw', label: 'Open-jaw', hint: 'Fly into one city, home from another' },
            { value: 'multi-city', label: 'Multi-city' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Users className="h-4 w-4" aria-hidden />
                <span className="sr-only">Travellers, cabin and bags:</span>
                {travellers} · {CABINS.find((c) => c.value === f.cabin)?.label}
                <Briefcase className="ml-1 h-4 w-4" aria-hidden />
                {f.checked ? `${f.checked} bag${f.checked > 1 ? 's' : ''}` : f.carryOn ? 'Cabin bag' : 'No bags'}
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Travellers, cabin and bags">
              <Stepper label="Adults" hint="12+ years" value={f.adults} min={1} max={9 - f.children} onChange={(n) => set({ adults: n, infants: Math.min(f.infants, n) })} />
              <Stepper label="Children" hint="2–11 years" value={f.children} min={0} max={9 - f.adults} onChange={(n) => set({ children: n })} />
              <Stepper label="Infants" hint="Under 2, on lap" value={f.infants} min={0} max={f.adults} onChange={(n) => set({ infants: n })} />
              <div className="mt-3 border-t border-line pt-3">
                <div className={labelClass}>Cabin</div>
                <Segmented<CabinClass> label="Cabin class" size="sm" value={f.cabin} onChange={(c) => set({ cabin: c })} options={CABINS} />
              </div>
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center justify-between py-1">
                  <label htmlFor={`${ids}-cabinbag`} className="text-sm font-medium">
                    Cabin trolley bag
                    <span className="block text-xs font-normal text-ink-muted">Per traveller; a small personal item is always free</span>
                  </label>
                  <Switch id={`${ids}-cabinbag`} checked={f.carryOn} onCheckedChange={(v) => set({ carryOn: v })} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-medium" id={`${ids}-checked`}>
                    Checked bags per traveller
                  </span>
                  <Segmented<string> label="Checked bags per traveller" size="sm" value={String(f.checked)} onChange={(v) => set({ checked: Number(v) })} options={['0', '1', '2'].map((v) => ({ value: v, label: v }))} />
                </div>
                <p className="mt-2 text-xs text-ink-muted">Bags missing from a fare are added to the total at the airline&apos;s price (or an estimate).</p>
              </div>
            </PopoverContent>
          </Popover>
          <label className="sr-only" htmlFor={`${ids}-currency`}>
            Currency
          </label>
          <select
            id={`${ids}-currency`}
            value={f.currency}
            onChange={(e) => set({ currency: e.target.value as SupportedCurrency })}
            className="h-8 rounded-lg border border-line bg-surface px-2 text-sm"
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Routes */}
      <div className="flex flex-col gap-3">
        {(multi ? f.legs : f.legs.slice(0, 1)).map((leg, i) => (
          <div key={i} className={cn('grid gap-3', multi ? 'sm:grid-cols-[1fr_1fr_11rem_auto]' : 'sm:grid-cols-[1fr_auto_1fr]')}>
            <LocationInput
              name={`from-${i}`}
              label={multi ? `Flight ${i + 1} · from` : 'From'}
              placeholder="City or airport"
              value={leg.from}
              invalid={Boolean(err(`slices.${i}.from`))}
              onChange={(v) => updateLeg(i, { from: v })}
            />
            {!multi && (
              <Button
                variant="ghost"
                size="icon"
                className="self-end sm:mb-1.5"
                aria-label="Swap origin and destination"
                onClick={() => updateLeg(0, { from: leg.to, to: leg.from })}
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden />
              </Button>
            )}
            <LocationInput
              name={`to-${i}`}
              label={multi ? `Flight ${i + 1} · to` : 'To'}
              placeholder="City or airport"
              value={leg.to}
              invalid={Boolean(err(`slices.${i}.to`))}
              onChange={(v) => updateLeg(i, { to: v })}
            />
            {multi && (
              <>
                <div>
                  <label className={labelClass} htmlFor={`${ids}-leg-${i}`}>
                    Date
                  </label>
                  <input
                    id={`${ids}-leg-${i}`}
                    type="date"
                    min={today || undefined}
                    className={cn(fieldClass, err(`slices.${i}.date`) && 'border-bad')}
                    value={leg.date || (defs ? addDays(defs.depart, i * 3) : '')}
                    onChange={(e) => updateLeg(i, { date: e.target.value })}
                  />
                </div>
                <div className="flex items-end pb-1.5">
                  {f.tripType === 'multi-city' && f.legs.length > 2 && (
                    <Button variant="ghost" size="icon" aria-label={`Remove flight ${i + 1}`} onClick={() => set({ legs: f.legs.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
        {f.tripType === 'multi-city' && f.legs.length < 5 && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => set({ legs: [...f.legs, { from: f.legs[f.legs.length - 1].to, to: null, date: '' }] })}
          >
            <Plus className="h-4 w-4" aria-hidden /> Add flight
          </Button>
        )}
      </div>

      {/* Dates */}
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Dates</legend>
        <Segmented<DateMode>
          label="Date flexibility"
          size="sm"
          value={f.dateMode}
          onChange={(m) => set({ dateMode: m })}
          options={[
            { value: 'exact', label: 'Specific dates' },
            { value: 'flexible', label: '± Flexible' },
            ...(multi
              ? []
              : [
                  { value: 'window' as DateMode, label: 'Date range' },
                  { value: 'month' as DateMode, label: 'Cheapest in a month' },
                ]),
          ]}
        />
        {!multi && (f.dateMode === 'exact' || f.dateMode === 'flexible') && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor={`${ids}-depart`}>
                Depart
              </label>
              <input
                id={`${ids}-depart`}
                type="date"
                min={today || undefined}
                className={cn(fieldClass, err('dates.depart') && 'border-bad')}
                value={f.depart || defs?.depart || ''}
                onChange={(e) => set({ depart: e.target.value })}
              />
            </div>
            {f.tripType === 'return' && (
              <div>
                <label className={labelClass} htmlFor={`${ids}-return`}>
                  Return
                </label>
                <input
                  id={`${ids}-return`}
                  type="date"
                  min={f.depart || today || undefined}
                  className={cn(fieldClass, err('dates.return') && 'border-bad')}
                  value={f.ret || defs?.ret || ''}
                  onChange={(e) => set({ ret: e.target.value })}
                />
              </div>
            )}
            {f.dateMode === 'flexible' && (
              <div>
                <span className={labelClass} id={`${ids}-flex`}>
                  Flexibility
                </span>
                <Segmented<string>
                  label="Days of flexibility"
                  value={String(f.flexDays)}
                  onChange={(v) => set({ flexDays: Number(v) })}
                  options={['1', '2', '3'].map((v) => ({ value: v, label: `± ${v} day${v === '1' ? '' : 's'}` }))}
                />
              </div>
            )}
          </div>
        )}
        {multi && f.dateMode === 'flexible' && (
          <Segmented<string>
            label="Days of flexibility per flight"
            size="sm"
            value={String(f.flexDays)}
            onChange={(v) => set({ flexDays: Number(v) })}
            options={['1', '2', '3'].map((v) => ({ value: v, label: `± ${v} day${v === '1' ? '' : 's'}` }))}
          />
        )}
        {!multi && f.dateMode === 'window' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${ids}-ws`}>
                Leave between
              </label>
              <input id={`${ids}-ws`} type="date" min={today || undefined} className={cn(fieldClass, err('dates.windowStart') && 'border-bad')} value={f.windowStart || defs?.windowStart || ''} onChange={(e) => set({ windowStart: e.target.value })} />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${ids}-we`}>
                and
              </label>
              <input id={`${ids}-we`} type="date" min={f.windowStart || today || undefined} className={cn(fieldClass, err('dates.windowEnd') && 'border-bad')} value={f.windowEnd || defs?.windowEnd || ''} onChange={(e) => set({ windowEnd: e.target.value })} />
            </div>
          </div>
        )}
        {!multi && f.dateMode === 'month' && (
          <div className="max-w-xs">
            <label className={labelClass} htmlFor={`${ids}-month`}>
              Month
            </label>
            <select id={`${ids}-month`} className={fieldClass} value={f.month || defs?.month || ''} onChange={(e) => set({ month: e.target.value })}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {f.tripType === 'return' && (f.dateMode === 'window' || f.dateMode === 'month') && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">Trip length</span>
            <label className="flex items-center gap-2">
              <span className="sr-only">Minimum nights</span>
              <input
                type="number"
                min={1}
                max={30}
                className="h-9 w-16 rounded-lg border border-line bg-surface px-2"
                value={f.nights.min}
                onChange={(e) => set({ nights: { ...f.nights, min: Number(e.target.value) } })}
              />
            </label>
            <span aria-hidden>to</span>
            <label className="flex items-center gap-2">
              <span className="sr-only">Maximum nights</span>
              <input
                type="number"
                min={1}
                max={30}
                className="h-9 w-16 rounded-lg border border-line bg-surface px-2"
                value={f.nights.max}
                onChange={(e) => set({ nights: { ...f.nights, max: Number(e.target.value) } })}
              />
            </label>
            <span>nights</span>
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-line pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm font-medium" htmlFor={`${ids}-nearby`}>
            <Switch id={`${ids}-nearby`} checked={f.nearby} onCheckedChange={(v) => set({ nearby: v })} />
            Include nearby airports
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            within
            <select
              className="h-8 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
              value={f.radiusKm}
              onChange={(e) => set({ radiusKm: Number(e.target.value) })}
              aria-label="Nearby airport radius"
            >
              {[60, 120, 200, 300].map((km) => (
                <option key={km} value={km}>
                  {km} km
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenStrategy && (
            <Button variant="outline" onClick={() => onOpenStrategy(f, (s) => set({ strategy: s, nearby: s.nearbyAirports.value }))}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Trip strategy
            </Button>
          )}
          <Button type="submit" size="lg" disabled={!today}>
            <Search className="h-4 w-4" aria-hidden /> {submitLabel}
          </Button>
        </div>
      </div>

      {showPresets && (
        <PresetChips
          value={f.strategy}
          onChange={(s) => set({ strategy: s, nearby: s.nearbyAirports.value })}
          onWeekend={() => {
            if (f.tripType === 'return' && f.dateMode === 'exact') set({ dateMode: 'window', nights: { min: 2, max: 3 } });
          }}
        />
      )}

      {errorList.length > 0 && (
        <div role="alert" className="rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">
          <p className="font-semibold">Please check your search:</p>
          <ul className="mt-1 list-disc pl-5">
            {[...new Set(errorList.map(([, m]) => m))].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
