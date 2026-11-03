import type { NextRequest } from 'next/server';
import { describeLocation, isMetroCode, getAirport, searchLocations } from '@/lib/data/airports';
import { config } from '@/lib/server/config';
import { apiLimiter } from '@/lib/server/limiters';
import { clientKey } from '@/lib/server/rate-limit';

/** Autocomplete (`?q=mil`) or label lookup for known codes (`?codes=MIL,LHR`). */
export async function GET(request: NextRequest) {
  const limit = apiLimiter().take(clientKey(request, config().TRUST_PROXY));
  if (!limit.ok) {
    return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
  }
  const params = request.nextUrl.searchParams;
  const codes = params.get('codes');
  if (codes) {
    const results = codes
      .split(',')
      .slice(0, 12)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{3}$/.test(c) && (isMetroCode(c) || getAirport(c)))
      .map((code) => ({ code, label: describeLocation(code) }));
    return Response.json({ results }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  }
  const q = (params.get('q') ?? '').slice(0, 60);
  return Response.json({ results: searchLocations(q, 8) }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
