'use client';

import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Database } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { fmtAge } from '@/lib/client/format';
import { STATIC_MODE } from '@/lib/client/runtime';
import type { ProviderStatus, SearchResponse } from '@/lib/domain/types';

const STATUS: Record<ProviderStatus['status'], { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; icon: typeof Clock }> = {
  ok: { label: 'OK', tone: 'good', icon: CheckCircle2 },
  partial: { label: 'Partial', tone: 'warn', icon: AlertTriangle },
  failed: { label: 'Failed', tone: 'bad', icon: AlertTriangle },
  timeout: { label: 'Timed out', tone: 'bad', icon: Clock },
  skipped: { label: 'No coverage', tone: 'neutral', icon: CircleSlash },
  'not-configured': { label: 'Not configured', tone: 'neutral', icon: CircleSlash },
};

/** Sources, their health and data freshness: the "can I trust these prices?" bar. */
export function ProviderStatusBar({ data, now }: { data: SearchResponse; now: number }) {
  const failing = data.providers.filter((p) => p.status === 'failed' || p.status === 'timeout' || p.status === 'partial');
  return (
    <section aria-label="Data sources" className="grid gap-2">
      {data.dataMode !== 'live' && data.dataMode !== 'none' && (
        <div role="note" className="flex gap-2 rounded-xl border border-demo/30 bg-demo-soft px-4 py-3 text-sm text-demo">
          <Database className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <strong>Demo data.</strong> Results marked &ldquo;Demo&rdquo; come from a fictional airline network so you can try every feature. They are not real
            fares or flights and cannot be booked.{' '}
            {STATIC_MODE
              ? 'This is the static GitHub Pages version: searching real fares needs the server version with a Duffel key.'
              : 'Connect a live provider (Duffel) to search real offers.'}
          </p>
        </div>
      )}
      {failing.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <strong>Partial results.</strong> {failing.map((p) => `${p.name}: ${p.message ?? p.status}`).join(' · ')}. Results from the other sources are
            shown; prices from the missing source may be lower.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>Sources:</span>
        {data.providers.map((p) => {
          const s = STATUS[p.status];
          return (
            <Badge key={p.id} tone={s.tone} title={p.message}>
              <s.icon className="h-3 w-3" aria-hidden /> {p.name}: {s.label}
              {p.callsPlanned > 0 && ` · ${p.callsMade + p.cacheHits}/${p.callsPlanned} queries`}
            </Badge>
          );
        })}
        <span>· Prices checked {fmtAge(now - data.generatedAt)}</span>
        <span>· {data.stats.candidatesReturned} itineraries analysed from {data.stats.offersReceived} fares</span>
      </div>
    </section>
  );
}
