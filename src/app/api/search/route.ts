import { gzipSync } from 'node:zlib';
import { SearchRequestSchema } from '@/lib/domain/schemas';
import { runSearch } from '@/lib/search/service';
import { config } from '@/lib/server/config';
import { searchLimiter } from '@/lib/server/limiters';
import { logger } from '@/lib/server/logger';
import { clientKey } from '@/lib/server/rate-limit';

const MAX_BODY_BYTES = 20_000;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const headers = { 'Cache-Control': 'no-store', 'X-Request-Id': requestId };
  const limit = searchLimiter().take(clientKey(request, config().TRUST_PROXY));
  if (!limit.ok) {
    return Response.json(
      { error: 'rate_limited', message: `Too many searches. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { ...headers, 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large', message: 'Search request is too large.' }, { status: 413, headers });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large', message: 'Search request is too large.' }, { status: 413, headers });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'invalid_json', message: 'Body must be JSON.' }, { status: 400, headers });
  }
  const parsed = SearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: 'invalid_request',
        message: 'Some search fields need attention.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400, headers },
    );
  }
  try {
    const result = await runSearch(parsed.data, requestId);
    const json = JSON.stringify(result);
    // Route-handler responses are not compressed by `next start`; results compress ~15x.
    if (json.length > 8_000 && /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')) {
      return new Response(gzipSync(json), {
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' },
      });
    }
    return new Response(json, { headers: { ...headers, 'Content-Type': 'application/json' } });
  } catch (err) {
    logger.error('search.failed', { requestId, error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'search_failed', message: 'The search failed unexpectedly. Please try again.', requestId }, { status: 500, headers });
  }
}
