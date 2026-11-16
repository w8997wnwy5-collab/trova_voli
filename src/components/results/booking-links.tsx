'use client';

import { ExternalLink, Loader2, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/client/format';
import type { BookingLink } from '@/lib/providers/types';
import { googleFlightsUrl, skyscannerUrl, type LinkSearch } from '@/lib/util/deeplinks';

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; links: BookingLink[] };

/** Live booking pages for one ticket, fetched only when asked (each lookup is a billed provider call). */
export function BookingLinks({ providerId, handle }: { providerId: string; handle: string }) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const load = async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch('/api/booking-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, handle }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setState({ status: 'error', message: json.message ?? 'Booking links are not available right now.' });
      else setState({ status: 'done', links: json.links ?? [] });
    } catch {
      setState({ status: 'error', message: 'Network error: check your connection and try again.' });
    }
  };

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <Button size="sm" className="mt-2" onClick={load} disabled={state.status === 'loading'}>
        {state.status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShoppingCart className="h-4 w-4" aria-hidden />}
        {state.status === 'loading' ? 'Finding booking sites…' : 'Show where to book'}
      </Button>
    );
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="mt-2 text-sm text-bad">
        {state.message}{' '}
        <button type="button" className="font-medium underline" onClick={load}>
          Retry
        </button>
      </p>
    );
  }
  if (!state.links.length) return <p className="mt-2 text-sm text-ink-muted">No booking site is offering these flights right now. Search again for fresh fares.</p>;
  return (
    <div className="mt-2">
      <ul className="grid gap-1.5" aria-label="Booking sites">
        {state.links.map((l) => (
          <li key={l.url} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-subtle px-3 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{l.providerName}</span>
              {l.providerType && <Badge>{l.providerType}</Badge>}
              {l.fareName && <span className="text-xs text-ink-muted">{l.fareName}</span>}
              {l.legs && <span className="text-xs text-ink-muted">{l.legs}</span>}
            </span>
            <span className="flex items-center gap-3">
              {l.price && <span className="tabular font-semibold">{fmtMoney(l.price.amount, l.price.currency)}</span>}
              <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-brand-strong">
                Book <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">with {l.providerName} (opens in a new tab)</span>
              </a>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">Check traveller details, baggage, change rules and the final price on the booking page before paying.</p>
    </div>
  );
}

/** Pre-filled searches on Google Flights and Skyscanner for the same route and dates. */
export function CheckElsewhere({ search, demo }: { search: LinkSearch; demo: boolean }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-ink-muted">{demo ? 'Search this route and date for real on:' : 'Compare live prices on:'}</span>
      <a href={googleFlightsUrl(search)} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-brand underline">
        Google Flights <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
      <a href={skyscannerUrl(search)} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-brand underline">
        Skyscanner <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </p>
  );
}
