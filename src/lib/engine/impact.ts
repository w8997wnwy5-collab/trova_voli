import type { Itinerary } from '@/lib/domain/types';
import type { RuleKey, TripStrategy } from '@/lib/domain/strategy';
import { applyStrategy, type FilterOptions } from './filters';

// "What happens if I change this control?" — option counts and cheapest totals per alternative.

export type ControlKey = RuleKey | 'unusualRoutes' | 'longStopovers' | 'includeHotel';

export const CONTROL_LABELS: Record<ControlKey, string> = {
  maxStops: 'Stops',
  maxDoorToDoorHours: 'Door-to-door time',
  selfTransfer: 'Self-transfers',
  airportChange: 'Airport changes',
  connectionSafety: 'Connection safety',
  overnightFlights: 'Overnight flights',
  overnightLayovers: 'Overnight layovers',
  bagsIncluded: 'Bags',
  splitTickets: 'Separate tickets',
  nearbyAirports: 'Nearby airports',
  avoidEntryRequirements: 'Transit visa / entry',
  flexibleTicket: 'Changeable fares',
  weekendTiming: 'Weekend timing',
  unusualRoutes: 'Unusual routes',
  longStopovers: 'Stopovers',
  includeHotel: 'Hotel estimate',
};

export interface ImpactOption {
  value: unknown;
  label: string;
  /** Options available with this value applied as a must-have. */
  count: number;
  cheapest: number | null;
  current: boolean;
}

export interface ControlImpact {
  key: ControlKey;
  options: ImpactOption[];
  /** Options if the current value were a must-have (only for rules). */
  hardCount?: number;
}

type Alternatives = { [K in RuleKey]: { value: TripStrategy[K]['value']; label: string }[] };

export const RULE_ALTERNATIVES: Alternatives = {
  maxStops: [
    { value: 0, label: 'Direct only' },
    { value: 1, label: 'Up to 1 stop' },
    { value: 2, label: 'Up to 2 stops' },
    { value: 3, label: 'Any' },
  ],
  maxDoorToDoorHours: [
    { value: 8, label: '8 h' },
    { value: 12, label: '12 h' },
    { value: 16, label: '16 h' },
    { value: 24, label: '24 h' },
    { value: null, label: 'No limit' },
  ],
  selfTransfer: [
    { value: 'never', label: 'Never' },
    { value: 'safe-only', label: 'Only with safe buffers' },
    { value: 'allowed', label: 'Allowed' },
  ],
  airportChange: [
    { value: 'never', label: 'Never' },
    { value: 'same-city', label: 'Same city only' },
    { value: 'allowed', label: 'Allowed' },
  ],
  connectionSafety: [
    { value: 'standard', label: 'Standard' },
    { value: 'comfortable', label: 'Comfortable (+25%)' },
    { value: 'very-safe', label: 'Very safe (+50%)' },
  ],
  overnightFlights: [
    { value: 'avoid', label: 'Avoid' },
    { value: 'allowed', label: 'Fine' },
  ],
  overnightLayovers: [
    { value: 'avoid', label: 'Avoid' },
    { value: 'allowed', label: 'Fine' },
  ],
  bagsIncluded: [
    { value: true, label: 'Must be in the fare' },
    { value: false, label: 'Can be added' },
  ],
  splitTickets: [
    { value: true, label: 'Allowed' },
    { value: false, label: 'Single ticket only' },
  ],
  nearbyAirports: [
    { value: true, label: 'Allowed' },
    { value: false, label: 'Only my airports' },
  ],
  avoidEntryRequirements: [
    { value: true, label: 'Avoid' },
    { value: false, label: "Don't mind" },
  ],
  flexibleTicket: [
    { value: true, label: 'Changeable fares' },
    { value: false, label: 'Any fare' },
  ],
  weekendTiming: [
    { value: true, label: 'Weekend timing' },
    { value: false, label: 'Any days' },
  ],
};

function summarize(cands: Itinerary[], s: TripStrategy, opts: FilterOptions): { count: number; cheapest: number | null } {
  const { kept } = applyStrategy(cands, s, opts);
  return { count: kept.length, cheapest: kept.length ? Math.min(...kept.map((k) => k.total)) : null };
}

export function computeImpacts(cands: Itinerary[], s: TripStrategy, opts: FilterOptions = {}): Record<ControlKey, ControlImpact> {
  const out = {} as Record<ControlKey, ControlImpact>;
  for (const key of Object.keys(RULE_ALTERNATIVES) as RuleKey[]) {
    const current = s[key];
    const options = RULE_ALTERNATIVES[key].map((alt) => {
      const patched = { ...s, [key]: { value: alt.value, mode: 'hard' } } as TripStrategy;
      return { value: alt.value, label: alt.label, ...summarize(cands, patched, opts), current: alt.value === current.value };
    });
    const hard = options.find((o) => o.current);
    out[key] = { key, options, hardCount: hard?.count };
  }
  for (const key of ['unusualRoutes', 'longStopovers', 'includeHotel'] as const) {
    out[key] = {
      key,
      options: [true, false].map((value) => ({
        value,
        label: value ? 'On' : 'Off',
        ...summarize(cands, { ...s, [key]: value }, opts),
        current: s[key] === value,
      })),
    };
  }
  return out;
}

/** Best single relaxations when nothing (or little) matches: used by the empty state. */
export function suggestRelaxations(cands: Itinerary[], s: TripStrategy, opts: FilterOptions = {}, limit = 3) {
  const impacts = computeImpacts(cands, s, opts);
  const currentCount = summarize(cands, s, opts).count;
  const suggestions: { key: ControlKey; value: unknown; label: string; count: number; cheapest: number | null }[] = [];
  for (const impact of Object.values(impacts)) {
    for (const o of impact.options) {
      if (o.current || o.count <= currentCount) continue;
      suggestions.push({ key: impact.key, value: o.value, label: o.label, count: o.count, cheapest: o.cheapest });
    }
  }
  return suggestions.sort((a, b) => b.count - a.count || (a.cheapest ?? Infinity) - (b.cheapest ?? Infinity)).slice(0, limit);
}
