'use client';

import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFavorites } from '@/lib/client/favorites';
import { fmtMoney } from '@/lib/client/format';
import { formatDay, formatDuration, formatTime } from '@/lib/util/format';

export function FavoritesList() {
  const { favorites, remove } = useFavorites();
  if (favorites.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-line bg-surface p-6 text-center text-sm text-ink-muted">
        No favourites yet. Tap the heart on any itinerary to keep it here.{' '}
        <Link href="/" className="font-medium text-brand underline">
          Start a search
        </Link>
      </div>
    );
  }
  return (
    <ul className="mt-6 grid gap-3">
      {favorites.map((f) => {
        const it = f.itinerary;
        return (
          <li key={f.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{f.title}</h2>
                <ul className="mt-1 text-sm text-ink-muted">
                  {it.journeys.map((j) => (
                    <li key={j.index} className="tabular">
                      {formatDay(j.departureLocal)} · {formatTime(j.departureLocal)} {j.origin} → {formatTime(j.arrivalLocal)} {j.destination} · {formatDuration(j.flightTimeMinutes)} ·{' '}
                      {j.stops ? `${j.stops} stop${j.stops > 1 ? 's' : ''}` : 'direct'}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {it.tags.includes('demo') && <Badge tone="demo">Demo data</Badge>}
                  <Badge>Saved {formatDay(new Date(f.savedAt).toISOString())}</Badge>
                </div>
              </div>
              <div className="text-right">
                <div className="tabular text-xl font-bold">{fmtMoney(it.cost.total.amount, it.cost.total.currency)}</div>
                <div className="text-xs text-ink-muted">price when saved</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Link href={`/search?${f.search}`} className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-strong">
                Check today&apos;s price
              </Link>
              <Button variant="ghost" size="sm" onClick={() => remove(f.id)} aria-label={`Remove ${f.title} from favourites`}>
                <Trash2 className="h-4 w-4" aria-hidden /> Remove
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
