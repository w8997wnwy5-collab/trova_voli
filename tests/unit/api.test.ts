import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, todayUtc } from '@/lib/domain/schemas';

async function loadRoute(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('@/app/api/search/route');
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const valid = {
  tripType: 'one-way',
  slices: [{ from: ['TRN'], to: ['BCN'] }],
  dates: { mode: 'exact', depart: addDays(todayUtc(), 30) },
};

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/search', () => {
  it('rejects malformed JSON and invalid requests with field-level issues', async () => {
    const { POST } = await loadRoute();
    expect((await POST(post('{nope'))).status).toBe(400);
    const res = await POST(post({ ...valid, slices: [{ from: ['TRN'], to: ['TRN'] }] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_request');
    expect(json.issues[0]).toMatchObject({ path: 'slices.0.to', message: 'Origin and destination must differ' });
  });

  it('returns ranked candidates, gzip-compressed when accepted', async () => {
    const { POST } = await loadRoute({ MOCK_LATENCY_MS: '0-0' });
    const res = await POST(post(valid, { 'accept-encoding': 'gzip, br' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
    expect(json.candidates.length).toBeGreaterThan(0);
    expect(json.providers.some((p: { id: string }) => p.id === 'duffel')).toBe(true);
  });

  it('rate-limits per client', async () => {
    const { POST } = await loadRoute({ RATE_LIMIT_SEARCH_PER_MIN: '2', MOCK_LATENCY_MS: '0-0' });
    const headers = { 'x-forwarded-for': '192.0.2.1' };
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await POST(post({ ...valid, slices: [{ from: ['TRN'], to: ['TRN'] }] }, headers))).status);
    expect(statuses).toContain(429);
  });
});
