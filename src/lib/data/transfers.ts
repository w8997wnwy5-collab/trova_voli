import 'server-only';
import { distanceKm, getAirport, sameCity } from './airports';

export interface TransferEstimateEur {
  minutes: number;
  /** Per person, EUR. */
  costEur: number;
  source: 'curated' | 'heuristic';
  description: string;
}

/**
 * Typical public-transport/coach connections between airports of the same area.
 * Approximate figures for planning only; always shown to users as estimates.
 */
const CURATED: [string, string, number, number, string][] = [
  ['LHR', 'LGW', 75, 30, 'coach'], ['LHR', 'STN', 105, 35, 'coach'], ['LHR', 'LTN', 75, 30, 'coach'],
  ['LHR', 'LCY', 75, 15, 'rail'], ['LGW', 'STN', 165, 35, 'coach'], ['LGW', 'LTN', 120, 30, 'direct train'],
  ['LGW', 'LCY', 80, 25, 'rail'], ['STN', 'LTN', 90, 30, 'coach'], ['STN', 'LCY', 70, 25, 'rail'],
  ['LTN', 'LCY', 90, 25, 'rail'], ['SEN', 'LCY', 70, 20, 'rail'], ['SEN', 'STN', 100, 30, 'rail/coach'],
  ['CDG', 'ORY', 75, 20, 'RER/bus'], ['CDG', 'BVA', 120, 35, 'coach via Paris'], ['ORY', 'BVA', 150, 35, 'coach via Paris'],
  ['MXP', 'LIN', 75, 13, 'bus'], ['MXP', 'BGY', 90, 20, 'shuttle bus'], ['LIN', 'BGY', 70, 15, 'bus'],
  ['FCO', 'CIA', 75, 15, 'bus via Termini'], ['ARN', 'BMA', 60, 15, 'bus'], ['ARN', 'NYO', 120, 25, 'coach'],
  ['BMA', 'NYO', 100, 25, 'coach'], ['JFK', 'EWR', 100, 35, 'AirTrain + rail'], ['JFK', 'LGA', 60, 15, 'bus'],
  ['EWR', 'LGA', 90, 35, 'rail + bus'], ['HND', 'NRT', 90, 22, 'limousine bus'], ['BRU', 'CRL', 90, 25, 'coach'],
  ['OSL', 'TRF', 150, 35, 'train + bus'], ['BCN', 'GRO', 90, 20, 'coach'], ['BCN', 'REU', 90, 20, 'coach'],
  ['VCE', 'TSF', 60, 15, 'bus'], ['FRA', 'HHN', 105, 25, 'coach'], ['WAW', 'WMI', 75, 10, 'train + bus'],
  ['IST', 'SAW', 90, 15, 'bus'], ['ICN', 'GMP', 40, 4, 'AREX train'], ['PVG', 'SHA', 70, 3, 'metro'],
  ['BKK', 'DMK', 60, 3, 'shuttle bus'], ['IAD', 'DCA', 60, 6, 'metro'], ['IAD', 'BWI', 90, 20, 'bus'],
  ['DCA', 'BWI', 60, 12, 'rail'], ['ORD', 'MDW', 75, 5, 'rail'], ['DXB', 'DWC', 60, 20, 'bus/taxi'],
  ['YYZ', 'YTZ', 45, 20, 'rail + ferry'], ['GRU', 'CGH', 60, 20, 'bus'], ['GIG', 'SDU', 45, 15, 'bus'],
  ['EZE', 'AEP', 60, 15, 'bus'], ['KIX', 'ITM', 70, 14, 'limousine bus'], ['PEK', 'PKX', 90, 15, 'rail'],
  ['TFS', 'TFN', 60, 10, 'bus'], ['DFW', 'DAL', 50, 30, 'taxi/rideshare'],
];

const CURATED_MAP = new Map<string, TransferEstimateEur>();
for (const [a, b, minutes, costEur, mode] of CURATED) {
  const entry = { minutes, costEur, source: 'curated' as const, description: `Typical ${mode}` };
  CURATED_MAP.set(`${a}-${b}`, entry);
  CURATED_MAP.set(`${b}-${a}`, entry);
}

/** Estimated ground transfer between two airports (same area or nearby). */
export function estimateTransfer(from: string, to: string): TransferEstimateEur {
  if (from === to) return { minutes: 0, costEur: 0, source: 'curated', description: 'Same airport' };
  const curated = CURATED_MAP.get(`${from}-${to}`);
  if (curated) return curated;
  const km = distanceKm(from, to) ?? 80;
  const city = sameCity(from, to) && getAirport(from) ? 'Local transport' : 'Train/coach';
  return {
    minutes: Math.round((30 + km * 1.0) / 5) * 5,
    costEur: Math.round(5 + km * 0.12),
    source: 'heuristic',
    description: `${city}, about ${Math.round(km)} km (heuristic)`,
  };
}
