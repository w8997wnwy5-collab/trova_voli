import { z } from 'zod';
import { TripStrategySchema, presetStrategy } from './strategy';

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'CAD', 'AUD', 'JPY'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const MAX_WINDOW_DAYS = 31;
export const MAX_NIGHT_SPAN = 7;
export const MAX_DAYS_AHEAD = 361;

const LocationCode = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport or city code');
const IsoDate = z.iso.date();
const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const SliceInputSchema = z.object({
  from: z.array(LocationCode).min(1, 'Choose where you fly from').max(3),
  to: z.array(LocationCode).min(1, 'Choose where you fly to').max(3),
  /** Used by multi-city and open-jaw trips. */
  date: IsoDate.optional(),
});

export const DatesSchema = z.object({
  mode: z.enum(['exact', 'flexible', 'window', 'month']).default('exact'),
  depart: IsoDate.optional(),
  return: IsoDate.optional(),
  flexDays: z.number().int().min(0).max(3).default(0),
  windowStart: IsoDate.optional(),
  windowEnd: IsoDate.optional(),
  month: YearMonth.optional(),
  nights: z
    .object({ min: z.number().int().min(1).max(30), max: z.number().int().min(1).max(30) })
    .optional(),
});

export const PassengersSchema = z
  .object({
    adults: z.number().int().min(1).max(9).default(1),
    children: z.number().int().min(0).max(8).default(0),
    infants: z.number().int().min(0).max(4).default(0),
  })
  .refine((p) => p.adults + p.children <= 9, { message: 'At most 9 seated travellers per search' })
  .refine((p) => p.infants <= p.adults, { message: 'Each infant needs an accompanying adult', path: ['infants'] });

export const SearchRequestSchema = z
  .object({
    tripType: z.enum(['one-way', 'return', 'multi-city', 'open-jaw']).default('return'),
    slices: z.array(SliceInputSchema).min(1).max(5),
    dates: DatesSchema.default({ mode: 'exact', flexDays: 0 }),
    passengers: PassengersSchema.default({ adults: 1, children: 0, infants: 0 }),
    cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
    bags: z
      .object({ carryOn: z.boolean().default(true), checked: z.number().int().min(0).max(2).default(0) })
      .default({ carryOn: true, checked: 0 }),
    currency: z.enum(SUPPORTED_CURRENCIES).default('EUR'),
    /** Search scope for alternative airports (0 disables). */
    nearbyRadiusKm: z.number().int().min(0).max(300).default(120),
    strategy: TripStrategySchema.default(() => presetStrategy('balanced')),
    /** Fault injection for demos/tests; ignored unless ALLOW_FAULT_INJECTION=1. */
    simulate: z.object({ failProviders: z.array(z.string().max(40)).max(5) }).optional(),
  })
  .superRefine((req, ctx) => {
    const today = todayUtc();
    const maxDate = addDays(today, MAX_DAYS_AHEAD);
    const checkDate = (d: string | undefined, path: (string | number)[], label: string) => {
      if (!d) {
        ctx.addIssue({ code: 'custom', path, message: `${label} is required` });
        return;
      }
      if (d < addDays(today, -1)) ctx.addIssue({ code: 'custom', path, message: `${label} is in the past` });
      if (d > maxDate) ctx.addIssue({ code: 'custom', path, message: `${label} is too far ahead (max ${MAX_DAYS_AHEAD} days)` });
    };

    const multi = req.tripType === 'multi-city' || req.tripType === 'open-jaw';
    if (req.tripType === 'open-jaw' && req.slices.length !== 2) {
      ctx.addIssue({ code: 'custom', path: ['slices'], message: 'An open-jaw trip has exactly two legs' });
    }
    if (req.tripType === 'multi-city' && req.slices.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['slices'], message: 'A multi-city trip needs at least two legs' });
    }
    if (!multi && req.slices.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['slices'], message: 'One-way and return trips take a single route' });
    }
    req.slices.forEach((s, i) => {
      if (s.from.some((c) => s.to.includes(c))) {
        ctx.addIssue({ code: 'custom', path: ['slices', i, 'to'], message: 'Origin and destination must differ' });
      }
    });

    const { dates } = req;
    if (multi) {
      if (dates.mode === 'window' || dates.mode === 'month') {
        ctx.addIssue({ code: 'custom', path: ['dates', 'mode'], message: 'Multi-city and open-jaw trips use specific or flexible dates' });
      }
      let prev = '';
      req.slices.forEach((s, i) => {
        checkDate(s.date, ['slices', i, 'date'], `Date of leg ${i + 1}`);
        if (s.date && prev && s.date < prev) {
          ctx.addIssue({ code: 'custom', path: ['slices', i, 'date'], message: 'Legs must be in chronological order' });
        }
        if (s.date) prev = s.date;
      });
      return;
    }

    if (dates.mode === 'exact' || dates.mode === 'flexible') {
      checkDate(dates.depart, ['dates', 'depart'], 'Departure date');
      if (req.tripType === 'return') {
        checkDate(dates.return, ['dates', 'return'], 'Return date');
        if (dates.depart && dates.return && dates.return < dates.depart) {
          ctx.addIssue({ code: 'custom', path: ['dates', 'return'], message: 'Return must be on or after departure' });
        }
      }
      if (dates.mode === 'flexible' && dates.flexDays === 0) {
        ctx.addIssue({ code: 'custom', path: ['dates', 'flexDays'], message: 'Choose ±1 to ±3 days' });
      }
    } else if (dates.mode === 'window') {
      checkDate(dates.windowStart, ['dates', 'windowStart'], 'Window start');
      checkDate(dates.windowEnd, ['dates', 'windowEnd'], 'Window end');
      if (dates.windowStart && dates.windowEnd) {
        const span = daysBetween(dates.windowStart, dates.windowEnd) + 1;
        if (span < 1) ctx.addIssue({ code: 'custom', path: ['dates', 'windowEnd'], message: 'Window end must be after its start' });
        if (span > MAX_WINDOW_DAYS) {
          ctx.addIssue({ code: 'custom', path: ['dates', 'windowEnd'], message: `Date windows are limited to ${MAX_WINDOW_DAYS} days` });
        }
      }
    } else if (dates.mode === 'month') {
      if (!dates.month) ctx.addIssue({ code: 'custom', path: ['dates', 'month'], message: 'Month is required' });
      else if (dates.month < today.slice(0, 7)) ctx.addIssue({ code: 'custom', path: ['dates', 'month'], message: 'Month is in the past' });
    }
    if (req.tripType === 'return' && (dates.mode === 'window' || dates.mode === 'month') && dates.nights) {
      if (dates.nights.min > dates.nights.max) {
        ctx.addIssue({ code: 'custom', path: ['dates', 'nights'], message: 'Minimum nights exceed maximum' });
      } else if (dates.nights.max - dates.nights.min + 1 > MAX_NIGHT_SPAN) {
        ctx.addIssue({ code: 'custom', path: ['dates', 'nights'], message: `Trip-length range is limited to ${MAX_NIGHT_SPAN} options` });
      }
    }
  });

export type SearchRequestInput = z.input<typeof SearchRequestSchema>;
export type SearchRequest = z.output<typeof SearchRequestSchema>;

export const DEFAULT_NIGHTS = { min: 3, max: 5 };

// ---------------------------------------------------------------------------
// Date helpers (calendar dates as YYYY-MM-DD strings, UTC arithmetic)
// ---------------------------------------------------------------------------

export function todayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
