'use client';

import Link from 'next/link';
import { defaultDates } from '@/components/search/form-state';
import { useToday } from '@/lib/client/use-today';
import { addDays } from '@/lib/domain/schemas';

/** Example searches with dates relative to today (computed in the browser). */
export function ExampleLinks() {
  const today = useToday();
  if (!today) return <div className="mt-2 h-9" aria-hidden />;
  const d = defaultDates(today);
  const examples = [
    { label: 'Milan → London, long weekend', q: `trip=return&from=MIL&to=LON&mode=flexible&depart=${d.depart}&return=${d.ret}&flex=1&adults=1&cur=EUR&preset=balanced` },
    { label: 'Turin → Athens, one-way, cheapest', q: `trip=one-way&from=TRN&to=ATH&mode=exact&depart=${d.depart}&adults=1&cur=EUR&preset=cheapest` },
    { label: 'Rome → New York, cheapest in a month', q: `trip=return&from=ROM&to=NYC&mode=month&month=${d.month}&nights=6-9&adults=2&ck=1&cur=EUR&preset=balanced` },
    { label: 'Open-jaw: Milan → Paris, Amsterdam → Milan', q: `trip=open-jaw&legs=MIL:PAR:${d.depart},AMS:MIL:${addDays(d.depart, 4)}&mode=exact&adults=1&cur=EUR&preset=balanced` },
  ];
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {examples.map((e) => (
        <li key={e.label}>
          <Link href={`/search?${e.q}`} prefetch={false} className="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand">
            {e.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
