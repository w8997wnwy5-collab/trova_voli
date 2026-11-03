'use client';

import { AlertTriangle, ArrowRightLeft, BedDouble, Bus, CircleAlert, Info, Plane, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/cn';
import { fmtAge, fmtMoney } from '@/lib/client/format';
import { SCORE_COMPONENTS, type TripStrategy } from '@/lib/domain/strategy';
import type { AirportInfo, Itinerary, JourneyView, RiskFlag } from '@/lib/domain/types';
import type { Explanation } from '@/lib/engine/explain';
import { COMPONENT_LABELS, type RankResult, type Scored } from '@/lib/engine/rank';
import { dayOffset, formatDay, formatDuration, formatTime } from '@/lib/util/format';

const CABIN_LABEL = { economy: 'Economy', premium_economy: 'Premium economy', business: 'Business', first: 'First' } as const;

function airportName(code: string, airports: Record<string, AirportInfo>) {
  const a = airports[code];
  return a ? `${a.city} · ${a.name}` : code;
}

export function journeyTitle(j: JourneyView, count: number, tripType?: string) {
  if (count === 1) return 'Flight';
  if (count === 2 && (tripType === 'return' || tripType === 'open-jaw')) return j.index === 0 ? 'Outbound' : 'Return';
  return `Flight ${j.index + 1}`;
}

function Timeline({ it, airports }: { it: Itinerary; airports: Record<string, AirportInfo> }) {
  return (
    <div className="grid gap-6">
      {it.journeys.map((j) => (
        <section key={j.index} aria-label={`${journeyTitle(j, it.journeys.length)} timeline`}>
          <h4 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
            {journeyTitle(j, it.journeys.length)} · {formatDay(j.departureLocal)}
            <span className="text-xs font-normal text-ink-muted">
              {formatDuration(j.flightTimeMinutes)} in the air and at connections · ≈{formatDuration(j.doorToDoorMinutes)} door-to-door
            </span>
          </h4>
          <ol className="relative ml-2 border-l-2 border-line pl-5">
            {j.accessTransfers
              .filter((t) => t.to === j.origin)
              .map((t) => (
                <li key={`a-${t.from}`} className="relative mb-3 text-sm">
                  <Bus className="absolute -left-[31px] top-0.5 h-4 w-4 rounded-full bg-surface text-warn" aria-hidden />
                  <span className="font-medium">Get to {t.to}</span> from the {t.from} area: ≈{formatDuration(t.minutes)}, est. {fmtMoney(t.cost.amount, t.cost.currency)} per person{' '}
                  <span className="text-ink-muted">({t.description})</span>
                </li>
              ))}
            {j.segments.map((s, i) => {
              const conn = i > 0 ? j.connections[i - 1] : undefined;
              const plus = dayOffset(s.departureLocal, s.arrivalLocal);
              return (
                <li key={`${s.flightNumber}-${s.departureLocal}`} className="relative">
                  {conn && (
                    <div
                      className={cn(
                        'mb-3 rounded-lg px-3 py-2 text-sm',
                        conn.kind === 'self-transfer' ? 'bg-warn-soft text-warn' : 'bg-subtle text-ink-muted',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 font-medium">
                        {conn.kind === 'self-transfer' ? <ShieldAlert className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                        {conn.kind === 'self-transfer' ? 'Self-transfer' : 'Protected connection'} at {conn.arrivalAirport}
                        {conn.airportChange && ` → ${conn.departureAirport}`} · {formatDuration(conn.layoverMinutes)}
                        {conn.overnight && (
                          <span className="inline-flex items-center gap-1">
                            · <BedDouble className="h-4 w-4" aria-hidden /> overnight
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs">
                        Recommended ≥ {formatDuration(conn.requiredMinutes)}
                        {conn.kind === 'self-transfer' && ` · ≈${Math.max(1, Math.round(conn.missProbability * 100))}% chance of missing it (estimate)`}
                        {conn.groundTransfer && ` · ground transfer ≈${formatDuration(conn.groundTransfer.minutes)}, est. ${fmtMoney(conn.groundTransfer.cost.amount, conn.groundTransfer.cost.currency)} pp`}
                      </div>
                      {conn.notes.map((n) => (
                        <div key={n} className="mt-0.5 text-xs">
                          {n}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mb-3">
                    <Plane className="absolute -left-[31px] top-0.5 h-4 w-4 rounded-full bg-surface text-brand" aria-hidden />
                    <div className="text-sm">
                      <span className="tabular font-semibold">{formatTime(s.departureLocal)}</span> {airportName(s.origin, airports)} ({s.origin})
                    </div>
                    <div className="my-1 text-xs text-ink-muted">
                      {s.marketingCarrier.name} {s.flightNumber}
                      {s.operatingCarrier && ` · operated by ${s.operatingCarrier.name}`} · {formatDuration(s.durationMinutes)} · {CABIN_LABEL[s.cabin]}
                      {s.aircraft && ` · ${s.aircraft}`} · ticket {s.ticket + 1}
                    </div>
                    <div className="text-sm">
                      <span className="tabular font-semibold">{formatTime(s.arrivalLocal)}</span>
                      {plus > 0 && <sup className="ml-0.5 text-xs text-warn">+{plus}</sup>} {airportName(s.destination, airports)} ({s.destination})
                    </div>
                  </div>
                </li>
              );
            })}
            {j.accessTransfers
              .filter((t) => t.from === j.destination)
              .map((t) => (
                <li key={`b-${t.to}`} className="relative text-sm">
                  <Bus className="absolute -left-[31px] top-0.5 h-4 w-4 rounded-full bg-surface text-warn" aria-hidden />
                  <span className="font-medium">From {t.from}</span> to the {t.to} area: ≈{formatDuration(t.minutes)}, est. {fmtMoney(t.cost.amount, t.cost.currency)} per person{' '}
                  <span className="text-ink-muted">({t.description})</span>
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function CostTable({ it, strategy }: { it: Itinerary; strategy: TripStrategy }) {
  const cur = it.cost.total.currency;
  const total = it.cost.total.amount - (strategy.includeHotel ? 0 : it.cost.hotelAmount);
  const travellers = it.cost.travelers;
  return (
    <div>
      <table className="w-full text-sm">
        <caption className="sr-only">Cost breakdown</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
            <th scope="col" className="pb-2 font-medium">
              Item
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {it.cost.lines.map((l, i) => {
            const excluded = l.kind === 'hotel' && !strategy.includeHotel;
            return (
              <tr key={i} className="border-t border-line align-top">
                <td className="py-2 pr-3">
                  <div className={cn(excluded && 'text-ink-muted line-through')}>{l.label}</div>
                  {(l.note || l.estimated || excluded) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                      {l.estimated && <Badge tone="warn">estimate</Badge>}
                      {excluded && <span>Not counted (hotel turned off in Trip strategy)</span>}
                      {l.note}
                    </div>
                  )}
                </td>
                <td className={cn('tabular py-2 text-right', excluded && 'text-ink-muted line-through')}>{fmtMoney(l.amount.amount, l.amount.currency)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink/20 font-semibold">
            <th scope="row" className="py-2 text-left">
              Total for {travellers} traveller{travellers > 1 ? 's' : ''}
            </th>
            <td className="tabular py-2 text-right">{fmtMoney(total, cur)}</td>
          </tr>
          <tr className="text-ink-muted">
            <th scope="row" className="text-left font-normal">
              Per traveller (average)
            </th>
            <td className="tabular text-right">{fmtMoney(Math.round(total / travellers), cur)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-xs text-ink-muted">
        {Math.round(it.cost.estimatedShare * 100)}% of the total is estimated. {it.cost.fxNote}
      </p>
    </div>
  );
}

function Why({ scored, ranking, explanation }: { scored: Scored; ranking: RankResult; explanation: Explanation }) {
  return (
    <div className="grid gap-4">
      <div>
        <div className="flex items-baseline justify-between">
          <h4 className="text-sm font-semibold">Value score {scored.score.toFixed(1)} / 100</h4>
          <span className="text-xs text-ink-muted">score = Σ weight × component</span>
        </div>
        <ul className="mt-2 grid gap-1.5">
          {SCORE_COMPONENTS.map((k) => (
            <li key={k} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-xs sm:grid-cols-[10rem_1fr_auto]">
              <span>{COMPONENT_LABELS[k]}</span>
              <span className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
                <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(scored.components[k] * 100)}%` }} />
              </span>
              <span className="tabular whitespace-nowrap text-right text-ink-muted">
                {Math.round(scored.components[k] * 100)} × {Math.round(ranking.weights[k] * 100)}% = {scored.contributions[k].toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-sm font-semibold">Why it is recommended</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {explanation.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      {explanation.cautions.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">Trade-offs</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {explanation.cautions.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const FLAG_ICON: Record<RiskFlag['severity'], typeof Info> = { critical: AlertTriangle, warning: CircleAlert, info: Info };

function Booking({ it, now }: { it: Itinerary; now: number }) {
  return (
    <div className="grid gap-4">
      <ul className="grid gap-3">
        {it.tickets.map((t) => (
          <li key={t.index} className="rounded-xl border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">
                Ticket {t.index + 1}: {t.route}
              </div>
              <div className="tabular font-semibold">{fmtMoney(t.price.amount, t.price.currency)}</div>
            </div>
            <div className="mt-1 text-xs text-ink-muted">
              {t.carriers.map((c) => c.name).join(' + ')}
              {t.fareBrand && ` · ${t.fareBrand} fare`} · sold by {t.booking.sellerName} · {t.booking.channel === 'ota' ? 'online travel agency' : t.booking.channel === 'api' ? 'booking API' : 'airline direct'} · found via{' '}
              {t.providerName}
              {t.originalPrice && ` · quoted ${fmtMoney(t.originalPrice.amount, t.originalPrice.currency)}`}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={t.dataQuality === 'demo' ? 'demo' : t.dataQuality === 'test' ? 'warn' : 'good'}>
                {t.dataQuality === 'demo' ? 'Demo data' : t.dataQuality === 'test' ? 'Test mode' : t.dataQuality === 'cached' ? 'Cached' : 'Live'} · {fmtAge(now - t.fetchedAt)}
              </Badge>
              <Badge>
                Cabin bag: {t.baggage.carryOn === null ? 'unknown' : t.baggage.carryOn ? 'included' : 'not included'}
              </Badge>
              <Badge>Checked: {t.baggage.checked === null ? 'unknown' : t.baggage.checked ? `${t.baggage.checked} included` : 'not included'}</Badge>
              {t.conditions?.changeable !== null && t.conditions?.changeable !== undefined && <Badge>{t.conditions.changeable ? 'Changeable' : 'No changes'}</Badge>}
              {t.conditions?.refundable !== null && t.conditions?.refundable !== undefined && <Badge>{t.conditions.refundable ? 'Refundable' : 'Non-refundable'}</Badge>}
              {t.seatsLeft !== undefined && t.seatsLeft <= 3 && <Badge tone="warn">{t.seatsLeft} seat{t.seatsLeft > 1 ? 's' : ''} left</Badge>}
            </div>
            {t.booking.url ? (
              <a href={t.booking.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-brand underline">
                Book with {t.booking.sellerName}
              </a>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">{t.booking.note ?? 'No booking link from this provider.'}</p>
            )}
          </li>
        ))}
      </ul>
      {it.tickets.length > 1 && (
        <p className="flex gap-2 rounded-lg bg-warn-soft p-3 text-xs text-warn">
          <ArrowRightLeft className="h-4 w-4 shrink-0" aria-hidden />
          Book each ticket separately. Prices can change between bookings; book the ticket with the fewest seats first, and check all
          tickets before paying for the first.
        </p>
      )}
      {it.alternatives.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold">Same flights elsewhere</h4>
          <ul className="mt-1 text-sm">
            {it.alternatives.map((a) => (
              <li key={a.providerName + a.total.amount} className="flex justify-between border-t border-line py-1.5">
                <span>{a.providerName}</span>
                <span className="tabular">{fmtMoney(a.total.amount, a.total.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="text-sm font-semibold">Risks & requirements</h4>
        {it.risk.flags.length === 0 ? (
          <p className="mt-1 text-sm text-ink-muted">No specific risks found.</p>
        ) : (
          <ul className="mt-1 grid gap-1.5">
            {it.risk.flags.map((f) => {
              const Icon = FLAG_ICON[f.severity];
              return (
                <li key={f.message} className={cn('flex gap-2 text-sm', f.severity === 'critical' ? 'text-bad' : f.severity === 'warning' ? 'text-warn' : 'text-ink-muted')}>
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{f.message}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-muted">Confidence: {it.confidence.level}. {it.confidence.reasons.join(' ')}</p>
      </div>
    </div>
  );
}

export function ItineraryDetails({
  scored,
  ranking,
  explanation,
  airports,
  strategy,
  now,
}: {
  scored: Scored;
  ranking: RankResult;
  explanation: Explanation;
  airports: Record<string, AirportInfo>;
  strategy: TripStrategy;
  now: number;
}) {
  const tabs = [
    { value: 'timeline', label: 'Timeline' },
    { value: 'cost', label: 'Cost breakdown' },
    { value: 'why', label: 'Why this option' },
    { value: 'booking', label: 'Booking & risks' },
  ];
  return (
    <Tabs.Root defaultValue="timeline" className="mt-4 border-t border-line pt-4">
      <Tabs.List aria-label="Itinerary details" className="mb-4 flex flex-wrap gap-1 rounded-xl bg-subtle p-1">
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t.value}
            value={t.value}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            {t.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="timeline">
        <Timeline it={scored.it} airports={airports} />
      </Tabs.Content>
      <Tabs.Content value="cost">
        <CostTable it={scored.it} strategy={strategy} />
      </Tabs.Content>
      <Tabs.Content value="why">
        <Why scored={scored} ranking={ranking} explanation={explanation} />
      </Tabs.Content>
      <Tabs.Content value="booking">
        <Booking it={scored.it} now={now} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
