import { resolveWeights, SCORE_COMPONENTS, type ScoreComponent, type TripStrategy } from '@/lib/domain/strategy';
import type { Evaluated } from './filters';

// Deterministic, explainable "best value" ranking: score = Σ weight × normalised component (0..1).

export const COMPONENT_LABELS: Record<ScoreComponent, string> = {
  cost: 'Total cost',
  duration: 'Door-to-door time',
  stops: 'Stops',
  risk: 'Connection risk',
  airportChanges: 'Airport changes',
  preferences: 'Fit with your preferences',
};

/** How far above the best value a component reaches zero (1 = twice the cheapest costs 0 points). */
export const COST_TOLERANCE = 1;
export const DURATION_TOLERANCE = 1.5;
const STOP_SCORES = [1, 0.6, 0.3, 0.1];

export type SortKey = 'best' | 'cheapest' | 'fastest' | 'stops' | 'risk';

export interface Scored extends Evaluated {
  score: number;
  components: Record<ScoreComponent, number>;
  /** weight × component × 100: the points each component contributed. */
  contributions: Record<ScoreComponent, number>;
}

export interface RankResult {
  items: Scored[];
  weights: Record<ScoreComponent, number>;
  bestValueId?: string;
  cheapestId?: string;
  fastestId?: string;
  minTotal: number;
  minMinutes: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreComponents(e: Evaluated, minTotal: number, minMinutes: number): Record<ScoreComponent, number> {
  const a = e.it.attrs;
  const stops = e.it.journeys.reduce((s, j) => s + STOP_SCORES[Math.min(3, j.stops)], 0) / e.it.journeys.length;
  return {
    cost: minTotal > 0 ? clamp01(1 - (e.total / minTotal - 1) / COST_TOLERANCE) : 1,
    duration: minMinutes > 0 ? clamp01(1 - (a.totalMinutes / minMinutes - 1) / DURATION_TOLERANCE) : 1,
    stops,
    risk: clamp01(1 - a.riskScore / 100),
    airportChanges: Math.exp(-0.9 * (a.airportChanges + (a.usesNearbyAirport ? 0.5 : 0))),
    preferences: e.preferenceFit,
  };
}

const tieBreak = (a: Scored, b: Scored) => a.total - b.total || a.it.attrs.totalMinutes - b.it.attrs.totalMinutes || a.it.id.localeCompare(b.it.id);

const SORTS: Record<SortKey, (a: Scored, b: Scored) => number> = {
  best: (a, b) => b.score - a.score || tieBreak(a, b),
  cheapest: (a, b) => a.total - b.total || b.score - a.score || a.it.id.localeCompare(b.it.id),
  fastest: (a, b) => a.it.attrs.totalMinutes - b.it.attrs.totalMinutes || tieBreak(a, b),
  stops: (a, b) => a.it.attrs.totalStops - b.it.attrs.totalStops || b.score - a.score || tieBreak(a, b),
  risk: (a, b) => a.it.attrs.riskScore - b.it.attrs.riskScore || b.score - a.score || tieBreak(a, b),
};

export function rank(evaluated: Evaluated[], strategy: Pick<TripStrategy, 'priority' | 'weights'>, sort: SortKey = 'best'): RankResult {
  const weights = resolveWeights(strategy);
  if (!evaluated.length) return { items: [], weights, minTotal: 0, minMinutes: 0 };
  const minTotal = Math.min(...evaluated.map((e) => e.total));
  const minMinutes = Math.min(...evaluated.map((e) => e.it.attrs.totalMinutes));
  const items: Scored[] = evaluated.map((e) => {
    const components = scoreComponents(e, minTotal, minMinutes);
    const contributions = Object.fromEntries(SCORE_COMPONENTS.map((k) => [k, round1(weights[k] * components[k] * 100)])) as Record<ScoreComponent, number>;
    const score = round1(SCORE_COMPONENTS.reduce((s, k) => s + weights[k] * components[k], 0) * 100);
    return { ...e, score, components, contributions };
  });
  const best = [...items].sort(SORTS.best)[0];
  const cheapest = [...items].sort(SORTS.cheapest)[0];
  const fastest = [...items].sort(SORTS.fastest)[0];
  items.sort(SORTS[sort]);
  return { items, weights, bestValueId: best?.it.id, cheapestId: cheapest?.it.id, fastestId: fastest?.it.id, minTotal, minMinutes };
}
