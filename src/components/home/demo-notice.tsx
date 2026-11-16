import { TriangleAlert } from 'lucide-react';
import { LIVE_APP_URL, STATIC_MODE } from '@/lib/client/runtime';

/** On the static GitHub Pages build every fare is invented: say so before anyone compares prices. */
export function DemoNotice() {
  if (!STATIC_MODE) return null;
  return (
    <div role="note" className="mb-6 flex gap-3 rounded-2xl border border-demo/30 bg-demo-soft p-4 text-sm text-demo">
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">Demo version: the flights and prices here are invented.</p>
        <p className="mt-1">
          They show how Flight Hacker combines tickets and explains trade-offs, but they do not exist and cannot be booked. Real fares with links to
          book need the full version, which runs on a server with a flight data key.
        </p>
        {LIVE_APP_URL && (
          <a href={LIVE_APP_URL} className="mt-2 inline-block rounded-lg bg-demo px-3 py-1.5 font-medium text-white hover:opacity-90">
            Open the version with real flights
          </a>
        )}
      </div>
    </div>
  );
}
