import type { Money } from '@/lib/domain/types';

const exponentCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (2 for EUR, 0 for JPY...). */
export function currencyExponent(currency: string): number {
  let e = exponentCache.get(currency);
  if (e === undefined) {
    try {
      e = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      e = 2;
    }
    exponentCache.set(currency, e);
  }
  return e;
}

/** Parses a decimal amount ("123.45") into Money in minor units. */
export function money(decimal: string | number, currency: string): Money {
  const exp = currencyExponent(currency);
  const n = typeof decimal === 'number' ? decimal : Number.parseFloat(decimal);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${decimal}`);
  return { amount: Math.round(n * 10 ** exp), currency };
}

export function toDecimal(m: Money): number {
  return m.amount / 10 ** currencyExponent(m.currency);
}

export function zero(currency: string): Money {
  return { amount: 0, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function sumMoney(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), zero(currency));
}

export function scaleMoney(m: Money, factor: number): Money {
  return { amount: Math.round(m.amount * factor), currency: m.currency };
}

export function formatMoney(m: Money, opts: { compact?: boolean; locale?: string } = {}): string {
  const value = toDecimal(m);
  return new Intl.NumberFormat(opts.locale ?? 'en-GB', {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: opts.compact ? 0 : currencyExponent(m.currency),
    minimumFractionDigits: opts.compact ? 0 : undefined,
  }).format(value);
}
