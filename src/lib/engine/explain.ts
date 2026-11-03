import { SCORE_COMPONENTS, type ScoreComponent } from '@/lib/domain/strategy';
import { formatDuration } from '@/lib/util/format';
import { COMPONENT_LABELS, type RankResult, type Scored } from './rank';

export interface Explanation {
  headline: string;
  reasons: string[];
  cautions: string[];
  /** Positive = cheaper than the best conventional itinerary (minor units). */
  savingsVsBaseline: number | null;
}

export interface ExplainContext {
  ranking: RankResult;
  /** Total of the cheapest conventional itinerary under the current filters, if any. */
  baselineTotal?: number;
  formatMoney: (minor: number) => string;
}

const STRENGTH: Record<ScoreComponent, string> = {
  cost: 'its price',
  duration: 'its travel time',
  stops: 'few stops',
  risk: 'low connection risk',
  airportChanges: 'no airport changes',
  preferences: 'how well it fits your preferences',
};

export function explain(s: Scored, ctx: ExplainContext): Explanation {
  const { ranking, formatMoney } = ctx;
  const a = s.it.attrs;
  const reasons: string[] = [];
  const cautions: string[] = [];
  const isCheapest = ranking.cheapestId === s.it.id;
  const isFastest = ranking.fastestId === s.it.id;
  const isBest = ranking.bestValueId === s.it.id;

  if (isCheapest) reasons.push(`Lowest total cost: ${formatMoney(s.total)} including bags, fees and estimated transfers.`);
  else {
    const extra = s.total - ranking.minTotal;
    reasons.push(`${formatMoney(extra)} (${Math.round((extra / ranking.minTotal) * 100)}%) more than the cheapest option.`);
  }

  let savings: number | null = null;
  if (ctx.baselineTotal !== undefined) {
    savings = ctx.baselineTotal - s.total;
    if (a.conventional) reasons.push('Conventional single ticket from your chosen airports — what standard comparison sites show.');
    else if (savings > 0) {
      reasons.push(`Saves ${formatMoney(savings)} (${Math.round((savings / ctx.baselineTotal) * 100)}%) versus the best conventional itinerary.`);
    } else if (savings < 0) cautions.push(`Costs ${formatMoney(-savings)} more than the best conventional itinerary.`);
  }

  if (isFastest) reasons.push(`Fastest door-to-door: ${formatDuration(a.totalMinutes)} in total.`);
  else {
    const slower = a.totalMinutes - ranking.minMinutes;
    if (slower <= ranking.minMinutes * 0.15) reasons.push(`Only ${formatDuration(slower)} slower than the fastest option.`);
    else cautions.push(`${formatDuration(slower)} longer than the fastest option.`);
  }

  reasons.push(a.maxStops === 0 ? 'Direct flights only.' : `${a.totalStops} stop${a.totalStops > 1 ? 's' : ''} in total (at most ${a.maxStops} per direction).`);
  if (s.it.risk.level === 'low') {
    reasons.push(a.selfTransfers ? 'Self-transfers have generous buffers, so the risk stays low.' : 'Low risk: connections are protected by a single ticket.');
  }
  if (a.bagsIncluded) reasons.push('Your bags are included in the fare.');

  if (isBest) {
    const top = [...SCORE_COMPONENTS].sort((x, y) => s.contributions[y] - s.contributions[x]).slice(0, 2);
    reasons.unshift(`Best balance for your priorities, driven mostly by ${top.map((k) => STRENGTH[k]).join(' and ')}.`);
  }

  for (const f of s.it.risk.flags) if (f.severity !== 'info' && cautions.length < 4) cautions.push(f.message);
  for (const v of s.violations) cautions.push(`Breaks a soft preference: ${v.message.toLowerCase()}.`);

  const headline = isBest ? 'Best value' : isCheapest ? 'Cheapest' : isFastest ? 'Fastest' : a.conventional ? 'Conventional option' : 'Alternative';
  return { headline, reasons, cautions, savingsVsBaseline: savings };
}

export function describeWeights(weights: Record<ScoreComponent, number>): { key: ScoreComponent; label: string; weight: number }[] {
  return SCORE_COMPONENTS.map((k) => ({ key: k, label: COMPONENT_LABELS[k], weight: weights[k] }));
}
