import { describe, expect, it } from 'vitest';
import { airportInfo, nearbyAirports, resolveLocation, sameCity, searchLocations } from '@/lib/data/airports';
import { estimateTransfer } from '@/lib/data/transfers';
import { BUNDLED_RATES, convert } from '@/lib/util/fx';
import { haversineKm } from '@/lib/util/geo';
import { formatMoney, money, toDecimal } from '@/lib/util/money';
import { createLogger } from '@/lib/server/logger';
import { RateLimiter } from '@/lib/server/rate-limit';
import { localToUtc, parseIsoDuration, utcToLocal } from '@/lib/util/time';

describe('geo & airports', () => {
  it('computes great-circle distances', () => {
    expect(haversineKm(51.4707, -0.4599, 40.6394, -73.7793)).toBeGreaterThan(5500);
    expect(haversineKm(51.4707, -0.4599, 40.6394, -73.7793)).toBeLessThan(5600);
  });

  it('expands metro codes and finds nearby airports', () => {
    expect(resolveLocation('MIL')).toEqual(['MXP', 'LIN', 'BGY']);
    expect(resolveLocation('ZZZ')).toEqual([]);
    const near = nearbyAirports(['MXP'], 100).map((a) => a.code);
    expect(near).toEqual(expect.arrayContaining(['LIN', 'BGY']));
    expect(sameCity('LGW', 'STN')).toBe(true);
    expect(sameCity('LGW', 'CDG')).toBe(false);
  });

  it('autocompletes cities before airports', () => {
    const res = searchLocations('london');
    expect(res[0]).toMatchObject({ code: 'LON', kind: 'city' });
    expect(res.some((r) => r.code === 'LHR')).toBe(true);
    expect(airportInfo('MXP').city).toBe('Milan');
  });

  it('estimates airport transfers (curated first, heuristic otherwise)', () => {
    expect(estimateTransfer('LGW', 'STN')).toMatchObject({ source: 'curated', minutes: 165 });
    const h = estimateTransfer('TRN', 'MXP');
    expect(h.source).toBe('heuristic');
    expect(h.minutes).toBeGreaterThan(60);
  });
});

describe('time zones', () => {
  it('converts local wall-clock time to UTC including DST', () => {
    expect(new Date(localToUtc('2026-07-01T12:00', 'Europe/Rome')).toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(new Date(localToUtc('2026-12-01T12:00', 'Europe/Rome')).toISOString()).toBe('2026-12-01T11:00:00.000Z');
    expect(utcToLocal(Date.parse('2026-12-01T23:30:00Z'), 'America/New_York')).toBe('2026-12-01T18:30');
  });

  it('parses ISO-8601 durations', () => {
    expect(parseIsoDuration('PT2H35M')).toBe(155);
    expect(parseIsoDuration('P1DT2H')).toBe(1560);
    expect(parseIsoDuration('nonsense')).toBeNull();
  });
});

describe('money & fx', () => {
  it('stores minor units and respects currency exponents', () => {
    expect(money('123.45', 'EUR')).toEqual({ amount: 12345, currency: 'EUR' });
    expect(money('1200', 'JPY')).toEqual({ amount: 1200, currency: 'JPY' });
    expect(toDecimal({ amount: 12345, currency: 'EUR' })).toBe(123.45);
    expect(formatMoney({ amount: 12345, currency: 'EUR' })).toBe('€123.45');
  });

  it('converts via EUR and reports when it did', () => {
    const r = convert(money(100, 'EUR'), 'GBP', BUNDLED_RATES);
    expect(r.converted).toBe(true);
    expect(r.money.currency).toBe('GBP');
    expect(r.money.amount).toBe(Math.round(100 * BUNDLED_RATES.rates.GBP * 100));
    expect(convert(money(100, 'EUR'), 'EUR', BUNDLED_RATES).converted).toBe(false);
  });
});

describe('server utilities', () => {
  it('rate-limits with a token bucket', () => {
    const rl = new RateLimiter(2, 60);
    const t = 1_000_000;
    expect(rl.take('a', t).ok).toBe(true);
    expect(rl.take('a', t).ok).toBe(true);
    const third = rl.take('a', t);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(rl.take('b', t).ok).toBe(true);
    expect(rl.take('a', t + 1500).ok).toBe(true);
  });

  it('redacts secrets and personal data from logs', () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (l: string) => lines.push(l);
    try {
      createLogger({}, 'info').info('test', { authorization: 'Bearer x', email: 'a@b.c', passportNumber: '123', provider: 'duffel', providerName: 'Duffel' });
    } finally {
      console.log = orig;
    }
    const entry = JSON.parse(lines[0]);
    expect(entry.authorization).toBe('[redacted]');
    expect(entry.email).toBe('[redacted]');
    expect(entry.passportNumber).toBe('[redacted]');
    expect(entry.provider).toBe('duffel');
    expect(entry.providerName).toBe('Duffel');
  });
});
