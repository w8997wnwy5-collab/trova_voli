import type { Itinerary } from '@/lib/domain/types';
import { RULE_KEYS, type RuleKey, type TripStrategy } from '@/lib/domain/strategy';

// Hard rules exclude itineraries; soft rules keep them but lower their preference-fit score.
// Pure and fast: runs in the browser on every control change.

export interface RuleCheck {
  key: RuleKey;
  /** 0..1, how badly the itinerary breaks the rule. */
  severity: number;
  message: string;
}

// Self-transfers must reach this share of the recommended buffer; protected connections (sold by the
// airline, so legal by definition) only need to meet our comfortable reference from "comfortable" up.
const SAFETY = {
  standard: { self: 1, protected: 0 },
  comfortable: { self: 1.25, protected: 1 },
  'very-safe': { self: 1.5, protected: 1.25 },
} as const;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Total the user pays under the strategy (the optional hotel estimate can be switched off). */
export function effectiveTotal(it: Itinerary, s: Pick<TripStrategy, 'includeHotel'>): number {
  return it.attrs.totalCost - (s.includeHotel ? 0 : it.cost.hotelAmount);
}

/** Violation of one rule, or null when the itinerary satisfies it. */
export function checkRule(it: Itinerary, key: RuleKey, s: TripStrategy): RuleCheck | null {
  const a = it.attrs;
  switch (key) {
    case 'maxStops': {
      const v = s.maxStops.value;
      return a.maxStops > v ? { key, severity: clamp01((a.maxStops - v) / 2), message: `${a.maxStops} stops (limit ${v})` } : null;
    }
    case 'maxDoorToDoorHours': {
      const v = s.maxDoorToDoorHours.value;
      if (v === null) return null;
      const excess = a.maxDoorToDoorMinutes - v * 60;
      return excess > 0 ? { key, severity: clamp01(excess / 360), message: `Longer than ${v}h door-to-door` } : null;
    }
    case 'selfTransfer': {
      const v = s.selfTransfer.value;
      if (a.selfTransfers === 0 || v === 'allowed') return null;
      if (v === 'never') return { key, severity: 1, message: 'Includes a self-transfer' };
      return a.selfTransfersSafe ? null : { key, severity: 0.7, message: 'Self-transfer without a generous buffer' };
    }
    case 'airportChange': {
      const v = s.airportChange.value;
      if (a.airportChanges === 0 || v === 'allowed') return null;
      if (v === 'never') return { key, severity: 1, message: 'Requires changing airports' };
      return a.airportChangesSameCityOnly ? null : { key, severity: 0.8, message: 'Airport change between cities' };
    }
    case 'connectionSafety': {
      const min = SAFETY[s.connectionSafety.value];
      const selfGap = a.minSelfTransferRatio < min.self ? (min.self - a.minSelfTransferRatio) / min.self : 0;
      const protGap = a.minProtectedRatio < min.protected ? (min.protected - a.minProtectedRatio) / min.protected : 0;
      const gap = Math.max(selfGap, protGap);
      return gap > 0 ? { key, severity: clamp01(gap * 2), message: 'A connection is shorter than your safety margin' } : null;
    }
    case 'overnightFlights':
      return s.overnightFlights.value === 'avoid' && a.overnightFlights > 0 ? { key, severity: 0.6, message: 'Overnight flight' } : null;
    case 'overnightLayovers':
      return s.overnightLayovers.value === 'avoid' && a.overnightLayovers > 0 ? { key, severity: 0.8, message: 'Overnight layover' } : null;
    case 'bagsIncluded':
      return s.bagsIncluded.value && !a.bagsIncluded ? { key, severity: 0.5, message: 'Bags not included in the fare' } : null;
    case 'splitTickets':
      return !s.splitTickets.value && a.ticketCount > 1 ? { key, severity: 0.6, message: 'Uses separate tickets' } : null;
    case 'nearbyAirports':
      return !s.nearbyAirports.value && a.usesNearbyAirport ? { key, severity: 0.6, message: 'Uses a nearby airport' } : null;
    case 'avoidEntryRequirements':
      return s.avoidEntryRequirements.value && (a.requiresEntry || a.transitVisaRisk)
        ? { key, severity: 0.8, message: 'May need a visa/ETA for a transit country' }
        : null;
    case 'flexibleTicket':
      return s.flexibleTicket.value && !a.changeableFare ? { key, severity: 0.5, message: 'Fare is not changeable' } : null;
    case 'weekendTiming': {
      if (!s.weekendTiming.value) return null;
      const outOk = [4, 5, 6].includes(a.outboundWeekday);
      const backOk = a.returnWeekday === undefined || [0, 1].includes(a.returnWeekday);
      return outOk && backOk ? null : { key, severity: 0.7, message: 'Not a Thu–Sat → Sun–Mon weekend' };
    }
  }
}

export interface Evaluated {
  it: Itinerary;
  total: number;
  /** Soft-rule violations (hard violations are excluded). */
  violations: RuleCheck[];
  /** 1 = matches every soft preference. */
  preferenceFit: number;
}

export interface FilterResult {
  kept: Evaluated[];
  /** Itineraries removed per hard rule (an itinerary can count for several). */
  excludedBy: Partial<Record<RuleKey | 'unusualRoutes' | 'longStopovers' | 'date', number>>;
  excluded: number;
}

export interface FilterOptions {
  /** Only keep itineraries departing on this date (calendar selection). */
  date?: string;
}

export function applyStrategy(candidates: Itinerary[], s: TripStrategy, opts: FilterOptions = {}): FilterResult {
  const kept: Evaluated[] = [];
  const excludedBy: FilterResult['excludedBy'] = {};
  let excluded = 0;
  const bump = (k: keyof FilterResult['excludedBy']) => {
    excludedBy[k] = (excludedBy[k] ?? 0) + 1;
  };
  for (const it of candidates) {
    let out = false;
    const violations: RuleCheck[] = [];
    if (!s.unusualRoutes && it.attrs.unusual && !it.attrs.conventional) {
      bump('unusualRoutes');
      out = true;
    }
    if (!s.longStopovers && it.attrs.longStopovers > 0) {
      bump('longStopovers');
      out = true;
    }
    if (opts.date && it.attrs.outboundDate !== opts.date) {
      bump('date');
      out = true;
    }
    for (const key of RULE_KEYS) {
      const v = checkRule(it, key, s);
      if (!v) continue;
      if (s[key].mode === 'hard') {
        bump(key);
        out = true;
      } else {
        violations.push(v);
      }
    }
    if (out) {
      excluded++;
      continue;
    }
    const fit = Math.max(0, 1 - violations.reduce((sum, v) => sum + v.severity * 0.35, 0));
    kept.push({ it, total: effectiveTotal(it, s), violations, preferenceFit: fit });
  }
  return { kept, excludedBy, excluded };
}
