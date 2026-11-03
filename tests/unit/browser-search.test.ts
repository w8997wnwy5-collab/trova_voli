import { describe, expect, it } from 'vitest';
import { locationLabels, runBrowserSearch, suggestLocations } from '@/lib/client/browser-search';
import { addDays, todayUtc } from '@/lib/domain/schemas';

// The static (GitHub Pages) build runs this module in the browser; it must work without any server.
describe('browser-only search (static build)', () => {
  it('runs the demo search and reports live providers as unavailable', async () => {
    const r = await runBrowserSearch({ tripType: 'one-way', slices: [{ from: ['TRN'], to: ['BCN'] }], dates: { mode: 'exact', depart: addDays(todayUtc(), 30) } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.dataMode).toBe('demo');
    expect(r.data.candidates.length).toBeGreaterThan(0);
    expect(r.data.providers.find((p) => p.id === 'duffel')).toMatchObject({ status: 'not-configured' });
  });

  it('validates input like the API does', async () => {
    const r = await runBrowserSearch({ tripType: 'one-way', slices: [{ from: ['TRN'], to: ['TRN'] }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues?.some((i) => i.message === 'Origin and destination must differ')).toBe(true);
  });

  it('provides autocomplete and labels locally', () => {
    expect(suggestLocations('milan')[0]).toMatchObject({ code: 'MIL', kind: 'city' });
    expect(locationLabels(['MIL', 'LHR', 'XXX'])).toEqual([
      { code: 'MIL', label: 'Milan (all airports)' },
      { code: 'LHR', label: 'London (LHR)' },
    ]);
  });
});
