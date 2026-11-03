import 'server-only';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  ENABLE_DEMO_PROVIDERS: bool.default(true),
  MOCK_LATENCY_MS: z.string().regex(/^\d+-\d+$/).default('5-40'),
  DUFFEL_ACCESS_TOKEN: z.string().min(10).optional(),
  DUFFEL_MAX_CALLS_PER_SEARCH: z.coerce.number().int().min(1).max(60).default(12),
  DUFFEL_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  DUFFEL_SUPPLIER_TIMEOUT_MS: z.coerce.number().int().min(2000).max(60000).default(15000),
  DATABASE_URL: z.string().optional(),
  FX_SOURCE: z.enum(['bundled', 'ecb']).default('bundled'),
  SEARCH_DEADLINE_MS: z.coerce.number().int().min(2000).max(120000).default(25000),
  MAX_CANDIDATES: z.coerce.number().int().min(20).max(1000).default(250),
  RATE_LIMIT_SEARCH_PER_MIN: z.coerce.number().int().min(1).max(1000).default(12),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().min(1).max(5000).default(120),
  ALLOW_FAULT_INJECTION: bool.default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  TRUST_PROXY: bool.default(true),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | undefined;

/** Parsed environment. Empty strings count as unset so `.env` placeholders are harmless. */
export function config(): AppConfig {
  if (!cached) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''));
    const parsed = EnvSchema.safeParse(env);
    if (!parsed.success) {
      const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      throw new Error(`Invalid environment configuration: ${keys}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests. */
export function resetConfig(): void {
  cached = undefined;
}
