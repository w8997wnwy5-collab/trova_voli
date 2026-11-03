'use client';

import { MapPin } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { cn } from '@/components/ui/cn';

export interface LocationValue {
  code: string;
  label: string;
}

interface Suggestion {
  code: string;
  kind: 'city' | 'airport';
  label: string;
  detail: string;
  country: string;
}

/** Accessible combobox (ARIA 1.2 pattern) backed by /api/airports. */
export function LocationInput({
  label,
  value,
  onChange,
  placeholder,
  invalid,
  name,
}: {
  label: string;
  value: LocationValue | null;
  onChange: (v: LocationValue | null) => void;
  placeholder?: string;
  invalid?: boolean;
  name: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  // null = show the selected value's label; string = user is typing.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const text = query ?? value?.label ?? '';

  useEffect(() => {
    if (query === null || query.trim().length < 2) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/airports?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((j: { results: Suggestion[] }) => {
          setResults(j.results);
          setActive(0);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const select = (s: Suggestion) => {
    onChange({ code: s.code, label: s.label });
    setQuery(null);
    setOpen(false);
  };

  const commitTyped = () => {
    if (query === null) return;
    const typed = query.trim().toUpperCase();
    if (open && results[active]) select(results[active]);
    else if (/^[A-Z]{3}$/.test(typed)) {
      onChange({ code: typed, label: typed });
      setQuery(null);
    }
  };

  const showList = open && query !== null && results.length > 0;
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input
          id={id}
          name={name}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) onChange(null);
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            commitTyped();
            setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              if (showList || query !== null) {
                e.preventDefault();
                commitTyped();
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQuery(null);
            }
          }}
          className={cn(
            'h-12 w-full rounded-xl border bg-surface pl-9 pr-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-brand focus:outline-none',
            invalid ? 'border-bad' : 'border-line',
          )}
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!showList}
        className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-xl"
      >
        {results.map((r, i) => (
          <li
            key={`${r.kind}-${r.code}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              select(r);
            }}
            onMouseEnter={() => setActive(i)}
            className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-2', i === active && 'bg-brand-soft')}
          >
            <span>
              <span className="block text-sm font-medium">{r.label}</span>
              <span className="block text-xs text-ink-muted">{r.detail}</span>
            </span>
            <span className="text-xs font-semibold text-ink-muted">{r.kind === 'city' ? 'City' : r.code}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
