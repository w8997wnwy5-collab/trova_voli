export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-ink-muted sm:flex-row sm:justify-between">
        <p>
          Flight Hacker compares fares from licensed sources only. Prices marked <strong>Demo</strong> are synthetic. Totals include
          estimated extras (bags, transfers, hotels) that are always labelled.
        </p>
        <p className="shrink-0">Airport data: OurAirports (public domain), mwgg/Airports (MIT).</p>
      </div>
    </footer>
  );
}
