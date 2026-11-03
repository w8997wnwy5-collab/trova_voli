import 'server-only';
import { anonymizeIp } from './logger';

/** In-memory token bucket per client (per server instance). Use a shared store when scaling out. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
  ) {}

  take(key: string, now = Date.now()): { ok: boolean; retryAfterSeconds: number; remaining: number } {
    const refillPerMs = this.perMinute / 60_000;
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.updated) * refillPerMs);
    b.updated = now;
    if (this.buckets.size > 10_000) this.evict(now);
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return { ok: false, retryAfterSeconds: Math.ceil((1 - b.tokens) / refillPerMs / 1000), remaining: 0 };
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return { ok: true, retryAfterSeconds: 0, remaining: Math.floor(b.tokens) };
  }

  private evict(now: number) {
    for (const [k, b] of this.buckets) if (now - b.updated > 10 * 60_000) this.buckets.delete(k);
  }
}

/** Stable, anonymous client key (hashed IP) from proxy headers. */
export function clientKey(request: Request, trustProxy: boolean): string {
  if (!trustProxy) return 'anonymous';
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
  return anonymizeIp(ip);
}
