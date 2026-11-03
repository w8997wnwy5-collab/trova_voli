import Link from 'next/link';
import { Heart, Plane } from 'lucide-react';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Flight Hacker home">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-ink">
            <Plane className="h-4 w-4 -rotate-45" aria-hidden />
          </span>
          <span>
            Flight <span className="text-brand">Hacker</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/search" className="rounded-lg px-3 py-2 text-ink-muted hover:bg-subtle hover:text-ink">
            Search
          </Link>
          <Link href="/favorites" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-ink-muted hover:bg-subtle hover:text-ink">
            <Heart className="h-4 w-4" aria-hidden />
            Favourites
          </Link>
        </nav>
      </div>
    </header>
  );
}
