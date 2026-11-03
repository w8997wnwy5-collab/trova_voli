import { z } from 'zod';

export const PRESET_IDS = ['cheapest', 'balanced', 'comfortable', 'weekend', 'business', 'custom'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const RuleModeSchema = z.enum(['hard', 'soft']);
export type RuleMode = z.infer<typeof RuleModeSchema>;

const rule = <T extends z.ZodType>(value: T) => z.object({ value, mode: RuleModeSchema });

export const SCORE_COMPONENTS = ['cost', 'duration', 'stops', 'risk', 'airportChanges', 'preferences'] as const;
export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];

export const WeightsSchema = z.object({
  cost: z.number().min(0).max(100),
  duration: z.number().min(0).max(100),
  stops: z.number().min(0).max(100),
  risk: z.number().min(0).max(100),
  airportChanges: z.number().min(0).max(100),
  preferences: z.number().min(0).max(100),
});
export type Weights = z.infer<typeof WeightsSchema>;

export const TripStrategySchema = z.object({
  preset: z.enum(PRESET_IDS),
  /** 0 = save as much as possible, 100 = prioritise comfort. */
  priority: z.number().int().min(0).max(100),
  maxStops: rule(z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])),
  /** Per journey; null = no limit. */
  maxDoorToDoorHours: rule(z.number().int().min(2).max(72).nullable()),
  selfTransfer: rule(z.enum(['never', 'safe-only', 'allowed'])),
  airportChange: rule(z.enum(['never', 'same-city', 'allowed'])),
  connectionSafety: rule(z.enum(['standard', 'comfortable', 'very-safe'])),
  overnightFlights: rule(z.enum(['avoid', 'allowed'])),
  overnightLayovers: rule(z.enum(['avoid', 'allowed'])),
  /** true = the fare itself must include the requested bags. */
  bagsIncluded: rule(z.boolean()),
  /** true = itineraries made of several tickets are allowed. */
  splitTickets: rule(z.boolean()),
  /** true = results may use nearby (not requested) airports. */
  nearbyAirports: rule(z.boolean()),
  /** true = avoid itineraries that need entry into a third country or a transit visa. */
  avoidEntryRequirements: rule(z.boolean()),
  /** true = prefer changeable fares. */
  flexibleTicket: rule(z.boolean()),
  /** true = depart Thu–Sat, return Sun–Mon. */
  weekendTiming: rule(z.boolean()),
  /** Show positioning flights and long detours. */
  unusualRoutes: z.boolean(),
  /** Show 1–3 day stopovers in a connecting city. */
  longStopovers: z.boolean(),
  /** Add an estimated hotel night for overnight connections. */
  includeHotel: z.boolean(),
  weights: WeightsSchema.optional(),
});
export type TripStrategy = z.infer<typeof TripStrategySchema>;

export type RuleKey =
  | 'maxStops'
  | 'maxDoorToDoorHours'
  | 'selfTransfer'
  | 'airportChange'
  | 'connectionSafety'
  | 'overnightFlights'
  | 'overnightLayovers'
  | 'bagsIncluded'
  | 'splitTickets'
  | 'nearbyAirports'
  | 'avoidEntryRequirements'
  | 'flexibleTicket'
  | 'weekendTiming';

export const RULE_KEYS: RuleKey[] = [
  'maxStops',
  'maxDoorToDoorHours',
  'selfTransfer',
  'airportChange',
  'connectionSafety',
  'overnightFlights',
  'overnightLayovers',
  'bagsIncluded',
  'splitTickets',
  'nearbyAirports',
  'avoidEntryRequirements',
  'flexibleTicket',
  'weekendTiming',
];

const BALANCED: TripStrategy = {
  preset: 'balanced',
  priority: 45,
  maxStops: { value: 1, mode: 'soft' },
  maxDoorToDoorHours: { value: 24, mode: 'soft' },
  selfTransfer: { value: 'safe-only', mode: 'hard' },
  airportChange: { value: 'same-city', mode: 'soft' },
  connectionSafety: { value: 'comfortable', mode: 'hard' },
  overnightFlights: { value: 'avoid', mode: 'soft' },
  overnightLayovers: { value: 'avoid', mode: 'soft' },
  bagsIncluded: { value: false, mode: 'soft' },
  splitTickets: { value: true, mode: 'hard' },
  nearbyAirports: { value: true, mode: 'hard' },
  avoidEntryRequirements: { value: true, mode: 'soft' },
  flexibleTicket: { value: false, mode: 'soft' },
  weekendTiming: { value: false, mode: 'soft' },
  unusualRoutes: false,
  longStopovers: false,
  includeHotel: true,
};

export const PRESETS: Record<PresetId, TripStrategy> = {
  cheapest: {
    ...BALANCED,
    preset: 'cheapest',
    priority: 0,
    maxStops: { value: 3, mode: 'hard' },
    maxDoorToDoorHours: { value: null, mode: 'soft' },
    selfTransfer: { value: 'allowed', mode: 'hard' },
    airportChange: { value: 'allowed', mode: 'hard' },
    connectionSafety: { value: 'standard', mode: 'hard' },
    overnightFlights: { value: 'allowed', mode: 'soft' },
    overnightLayovers: { value: 'allowed', mode: 'soft' },
    avoidEntryRequirements: { value: false, mode: 'soft' },
    unusualRoutes: true,
  },
  balanced: BALANCED,
  comfortable: {
    ...BALANCED,
    preset: 'comfortable',
    priority: 85,
    maxStops: { value: 1, mode: 'hard' },
    maxDoorToDoorHours: { value: 16, mode: 'soft' },
    selfTransfer: { value: 'never', mode: 'hard' },
    airportChange: { value: 'never', mode: 'hard' },
    overnightLayovers: { value: 'avoid', mode: 'hard' },
    nearbyAirports: { value: false, mode: 'soft' },
  },
  weekend: {
    ...BALANCED,
    preset: 'weekend',
    priority: 35,
    maxDoorToDoorHours: { value: 8, mode: 'soft' },
    overnightLayovers: { value: 'avoid', mode: 'hard' },
    weekendTiming: { value: true, mode: 'soft' },
    includeHotel: false,
  },
  business: {
    ...BALANCED,
    preset: 'business',
    priority: 92,
    maxDoorToDoorHours: { value: 14, mode: 'soft' },
    selfTransfer: { value: 'never', mode: 'hard' },
    airportChange: { value: 'never', mode: 'hard' },
    connectionSafety: { value: 'very-safe', mode: 'hard' },
    overnightLayovers: { value: 'avoid', mode: 'hard' },
    nearbyAirports: { value: false, mode: 'soft' },
    avoidEntryRequirements: { value: true, mode: 'hard' },
    flexibleTicket: { value: true, mode: 'soft' },
  },
  custom: { ...BALANCED, preset: 'custom' },
};

export const PRESET_LABELS: Record<PresetId, { label: string; hint: string }> = {
  cheapest: { label: 'Cheapest possible', hint: 'Every trick allowed: split tickets, self-transfers, airport changes.' },
  balanced: { label: 'Balanced', hint: 'Real savings with safe buffers and few surprises.' },
  comfortable: { label: 'Comfortable', hint: 'Protected connections, one stop at most, no airport changes.' },
  weekend: { label: 'Weekend escape', hint: 'Leave Thu–Sat, back Sun–Mon, short door-to-door.' },
  business: { label: 'Business-safe', hint: 'Protected, generous buffers, flexible fares preferred.' },
  custom: { label: 'Custom', hint: 'Your own mix of rules.' },
};

export function presetStrategy(id: PresetId): TripStrategy {
  return structuredClone(PRESETS[id]);
}

/** Ranking weights (summing to 1) from the Save ↔ Comfort slider or explicit custom weights. */
export function resolveWeights(strategy: Pick<TripStrategy, 'priority' | 'weights'>): Record<ScoreComponent, number> {
  if (strategy.weights) {
    const sum = SCORE_COMPONENTS.reduce((s, k) => s + strategy.weights![k], 0);
    if (sum > 0) {
      return Object.fromEntries(SCORE_COMPONENTS.map((k) => [k, strategy.weights![k] / sum])) as Record<ScoreComponent, number>;
    }
  }
  const p = Math.min(100, Math.max(0, strategy.priority)) / 100;
  const lerp = (a: number, b: number) => a + (b - a) * p;
  return {
    cost: lerp(0.62, 0.18),
    duration: lerp(0.12, 0.28),
    stops: lerp(0.05, 0.18),
    risk: lerp(0.12, 0.18),
    airportChanges: lerp(0.03, 0.08),
    preferences: lerp(0.06, 0.1),
  };
}

/** Number of rules that differ from the preset the strategy was derived from. */
export function strategyDiff(strategy: TripStrategy, base: TripStrategy): string[] {
  const keys = Object.keys(base) as (keyof TripStrategy)[];
  return keys.filter((k) => k !== 'preset' && JSON.stringify(strategy[k]) !== JSON.stringify(base[k]));
}
