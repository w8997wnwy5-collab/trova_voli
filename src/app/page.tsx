import { Building2, Calculator, ShieldCheck, Shuffle } from 'lucide-react';
import { ExampleLinks } from '@/components/home/example-links';
import { HomeSearch } from '@/components/home/home-search';

const FEATURES = [
  {
    icon: Shuffle,
    title: 'Combinations others skip',
    text: 'Separate outbound and return tickets, mixed airlines and sellers, self-transfers and positioning flights — only when they really save money.',
  },
  {
    icon: Building2,
    title: 'Nearby airports, honestly priced',
    text: 'Alternative airports within your radius, with the extra bus or train time and cost added to the total.',
  },
  {
    icon: Calculator,
    title: 'Total trip cost',
    text: 'Fare + bags + booking and card fees + airport transfers + an optional hotel for overnight connections, per traveller and per group.',
  },
  {
    icon: ShieldCheck,
    title: 'Risk you can see',
    text: 'Self-transfer buffers, missed-connection odds, overnight layovers and transit-visa checks are shown on every option.',
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <section aria-labelledby="hero" className="mb-8 max-w-3xl">
        <h1 id="hero" className="text-3xl font-bold tracking-tight sm:text-4xl">
          The cheapest <span className="text-brand">practical</span> way to fly.
        </h1>
        <p className="mt-3 text-lg text-ink-muted">
          Flight Hacker builds the combinations comparison sites miss and ranks them by real total cost, time and risk — with every
          trade-off explained.
        </p>
      </section>
      <section aria-label="Search" className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
        <HomeSearch />
      </section>
      <section aria-labelledby="examples" className="mt-6">
        <h2 id="examples" className="text-sm font-semibold text-ink-muted">
          Try an example
        </h2>
        <ExampleLinks />
      </section>
      <section aria-labelledby="how" className="mt-12">
        <h2 id="how" className="text-xl font-semibold">
          How it finds savings
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-5">
              <Icon className="h-6 w-6 text-brand" aria-hidden />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
