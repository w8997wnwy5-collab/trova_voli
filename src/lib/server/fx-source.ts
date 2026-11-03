import 'server-only';
import { BUNDLED_RATES, type FxRates } from '@/lib/util/fx';
import { config } from './config';
import { logger } from './logger';

const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const TTL_MS = 12 * 3600_000;
let cached: { rates: FxRates; at: number } | undefined;

/** Parses the ECB daily reference-rate XML. */
export function parseEcbXml(xml: string): FxRates | null {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const rates: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = Number(m[2]);
  if (!date || Object.keys(rates).length < 10) return null;
  return { rates: { ...BUNDLED_RATES.rates, ...rates }, asOf: date, source: 'ECB reference rates' };
}

/** FX rates for comparing offers in different currencies (bundled by default, ECB when enabled). */
export async function getFxRates(): Promise<FxRates> {
  if (config().FX_SOURCE !== 'ecb') return BUNDLED_RATES;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rates;
  try {
    const res = await fetch(ECB_URL, { signal: AbortSignal.timeout(4000) });
    const parsed = res.ok ? parseEcbXml(await res.text()) : null;
    if (parsed) {
      cached = { rates: parsed, at: Date.now() };
      return parsed;
    }
  } catch (err) {
    logger.warn('fx.ecb_unavailable', { error: (err as Error).message });
  }
  return cached?.rates ?? BUNDLED_RATES;
}
