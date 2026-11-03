import type { Money } from '@/lib/domain/types';
import { currencyExponent } from './money';

export interface FxRates {
  /** Units of currency per 1 EUR. */
  rates: Record<string, number>;
  asOf: string;
  source: string;
}

/**
 * Approximate EUR reference rates bundled with the app. Used only to compare offers quoted in
 * different currencies; every converted amount is labelled. Set FX_SOURCE=ecb to use daily ECB rates.
 */
export const BUNDLED_RATES: FxRates = {
  source: 'Bundled approximate reference rates',
  asOf: 'bundled',
  rates: {
    EUR: 1,
    USD: 1.16,
    GBP: 0.87,
    CHF: 0.93,
    SEK: 11.0,
    NOK: 11.7,
    DKK: 7.46,
    PLN: 4.25,
    CZK: 24.4,
    HUF: 390,
    CAD: 1.62,
    AUD: 1.77,
    JPY: 175,
    TRY: 48,
    AED: 4.26,
    QAR: 4.22,
    SGD: 1.5,
    THB: 37.5,
    INR: 101,
    MAD: 10.6,
    ISK: 143,
    RON: 5.08,
    BGN: 1.96,
  },
};

export function canConvert(from: string, to: string, fx: FxRates): boolean {
  return from === to || (fx.rates[from] !== undefined && fx.rates[to] !== undefined);
}

/** Converts money between currencies via EUR. Returns the same object when no conversion is needed. */
export function convert(m: Money, to: string, fx: FxRates): { money: Money; rate: number; converted: boolean } {
  if (m.currency === to) return { money: m, rate: 1, converted: false };
  const fromRate = fx.rates[m.currency];
  const toRate = fx.rates[to];
  if (!fromRate || !toRate) throw new Error(`No FX rate for ${m.currency}→${to}`);
  const rate = toRate / fromRate;
  const decimal = m.amount / 10 ** currencyExponent(m.currency);
  const amount = Math.round(decimal * rate * 10 ** currencyExponent(to));
  return { money: { amount, currency: to }, rate, converted: true };
}
