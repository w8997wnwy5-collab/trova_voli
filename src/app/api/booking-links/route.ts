import { z } from 'zod';
import { getProviders } from '@/lib/providers/registry';
import { ProviderError } from '@/lib/providers/types';
import { config } from '@/lib/server/config';
import { apiLimiter } from '@/lib/server/limiters';
import { logger } from '@/lib/server/logger';
import { clientKey } from '@/lib/server/rate-limit';

export const maxDuration = 60;

const BodySchema = z.object({
  provider: z.string().regex(/^[a-z0-9-]{2,40}$/),
  handle: z.string().min(4).max(200),
});

/** Booking pages (airline or agency) for one itinerary, fetched only when the traveller asks. */
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const limit = apiLimiter().take(clientKey(request, config().TRUST_PROXY));
  if (!limit.ok) {
    return Response.json({ error: 'rate_limited', message: 'Too many requests, try again shortly.' }, { status: 429, headers: { ...headers, 'Retry-After': String(limit.retryAfterSeconds) } });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request', message: 'Unknown itinerary.' }, { status: 400, headers });
  const provider = getProviders().active.find((p) => p.id === parsed.data.provider && p.bookingLinks);
  if (!provider?.bookingLinks) {
    return Response.json({ error: 'not_supported', message: 'This source does not provide booking links.' }, { status: 404, headers });
  }
  try {
    const links = await provider.bookingLinks(parsed.data.handle, { signal: AbortSignal.timeout(45_000) });
    logger.info('booking_links.done', { provider: provider.id, links: links.length });
    return Response.json({ links }, { headers });
  } catch (err) {
    const e = err instanceof ProviderError ? err : undefined;
    logger.warn('booking_links.failed', { provider: provider.id, kind: e?.kind, status: e?.status });
    const status = e?.status === 404 ? 404 : 502;
    const message =
      e?.status === 404
        ? 'These fares have expired. Search again to get fresh booking links.'
        : e?.kind === 'billing'
          ? 'The booking-link service needs billing set up.'
          : 'Booking links are not available right now. Try again in a moment.';
    return Response.json({ error: 'upstream', message }, { status, headers });
  }
}
