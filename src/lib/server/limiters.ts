import 'server-only';
import { config } from './config';
import { RateLimiter } from './rate-limit';

let search: RateLimiter | undefined;
let api: RateLimiter | undefined;

export function searchLimiter(): RateLimiter {
  const perMin = config().RATE_LIMIT_SEARCH_PER_MIN;
  return (search ??= new RateLimiter(Math.max(3, Math.ceil(perMin / 2)), perMin));
}

export function apiLimiter(): RateLimiter {
  const perMin = config().RATE_LIMIT_API_PER_MIN;
  return (api ??= new RateLimiter(Math.max(10, Math.ceil(perMin / 2)), perMin));
}
