'use client';

import { Minus, Plus } from 'lucide-react';

export function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-ink-muted">{hint}</div>}
      </div>
      <div className="flex items-center gap-2" role="group" aria-label={label}>
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-full border border-line hover:bg-subtle disabled:opacity-40"
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={`Fewer ${label.toLowerCase()}`}
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <output className="tabular w-5 text-center text-sm font-semibold" aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-full border border-line hover:bg-subtle disabled:opacity-40"
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`More ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
