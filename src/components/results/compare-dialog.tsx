'use client';

import { Dialog } from 'radix-ui';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { fmtMoney } from '@/lib/client/format';
import { SCORE_COMPONENTS } from '@/lib/domain/strategy';
import { COMPONENT_LABELS, type Scored } from '@/lib/engine/rank';
import { formatDuration, formatTime } from '@/lib/util/format';

export function CompareDialog({ open, onOpenChange, items, currency }: { open: boolean; onOpenChange: (o: boolean) => void; items: Scored[]; currency: string }) {
  const rows: { label: string; cell: (s: Scored) => React.ReactNode }[] = [
    { label: 'Total', cell: (s) => <strong className="tabular">{fmtMoney(s.total, currency)}</strong> },
    { label: 'Per traveller', cell: (s) => <span className="tabular">{fmtMoney(Math.round(s.total / s.it.cost.travelers), currency)}</span> },
    { label: 'Value score', cell: (s) => <span className="tabular">{s.score.toFixed(1)}</span> },
    {
      label: 'Flights',
      cell: (s) =>
        s.it.journeys.map((j) => (
          <div key={j.index} className="tabular">
            {formatTime(j.departureLocal)} {j.origin} → {formatTime(j.arrivalLocal)} {j.destination}
          </div>
        )),
    },
    { label: 'Door-to-door', cell: (s) => formatDuration(s.it.attrs.totalMinutes) },
    { label: 'Stops', cell: (s) => s.it.attrs.totalStops },
    { label: 'Tickets', cell: (s) => s.it.tickets.map((t) => t.carriers.map((c) => c.name).join('+')).join(' · ') },
    { label: 'Self-transfers', cell: (s) => s.it.attrs.selfTransfers },
    { label: 'Airport changes', cell: (s) => s.it.attrs.airportChanges },
    { label: 'Bags in fare', cell: (s) => (s.it.attrs.bagsIncluded ? 'Yes' : 'Added as extra') },
    { label: 'Risk', cell: (s) => `${s.it.risk.level} (${s.it.risk.score})` },
    ...SCORE_COMPONENTS.map((k) => ({ label: `Score: ${COMPONENT_LABELS[k]}`, cell: (s: Scored) => <span className="tabular">{Math.round(s.components[k] * 100)}</span> })),
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Compare itineraries" side="center">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-sm">
            <caption className="sr-only">Side-by-side comparison</caption>
            <thead>
              <tr>
                <th scope="col" className="w-40" />
                {items.map((s, i) => (
                  <th key={s.it.id} scope="col" className="px-3 pb-2 text-left font-semibold">
                    Option {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-ink-muted">
                    {r.label}
                  </th>
                  {items.map((s) => (
                    <td key={s.it.id} className="px-3 py-2">
                      {r.cell(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Dialog.Close className="sr-only">Close comparison</Dialog.Close>
      </SheetContent>
    </Sheet>
  );
}
