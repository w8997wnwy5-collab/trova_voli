'use client';

import { RefreshCw, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

const STEPS = ['Asking flight sources…', 'Checking nearby airports and dates…', 'Combining tickets and self-transfers…', 'Pricing bags, fees and transfers…', 'Ranking by total value…'];

export function LoadingState() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-3">
      <p className="text-sm text-ink-muted">{STEPS[step]}</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-line bg-surface p-5">
          <div className="h-4 w-40 rounded bg-subtle" />
          <div className="mt-4 h-5 w-3/4 rounded bg-subtle" />
          <div className="mt-2 h-5 w-2/3 rounded bg-subtle" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, issues, onRetry }: { message: string; issues?: { path: string; message: string }[]; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-bad/30 bg-bad-soft p-5 text-bad">
      <p className="font-semibold">{message}</p>
      {issues && issues.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {issues.map((i) => (
            <li key={i.path + i.message}>{i.message}</li>
          ))}
        </ul>
      )}
      <Button variant="outline" className="mt-3" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" aria-hidden /> Try again
      </Button>
    </div>
  );
}

export function EmptyState({
  total,
  suggestions,
  onApply,
}: {
  total: number;
  suggestions: { label: string; detail: string; apply: () => void }[];
  onApply?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 text-center">
      <SearchX className="mx-auto h-8 w-8 text-ink-muted" aria-hidden />
      <h2 className="mt-2 font-semibold">{total ? 'No itinerary matches your must-have rules' : 'No flights found for this search'}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {total ? `${total} itineraries were found, but your rules hide all of them.` : 'Try other dates, nearby airports or a larger radius.'}
      </p>
      {suggestions.length > 0 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-sm font-medium">Quick fixes</p>
          {suggestions.map((s) => (
            <Button
              key={s.label}
              variant="secondary"
              onClick={() => {
                s.apply();
                onApply?.();
              }}
            >
              {s.label} <span className="font-normal">· {s.detail}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
