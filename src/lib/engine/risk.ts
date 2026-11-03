import type { FlightSegment, RiskAssessment, RiskFlag, RiskLevel } from '@/lib/domain/types';
import { localAsUtcMs, minutesOfDay } from '@/lib/util/time';

// Deterministic, explainable risk rules. The delay model is a simple exponential tail calibrated to
// typical European on-time statistics; it is an estimate and labelled as such in the UI.

/** Airports where airlines publish long minimum connection times. */
const LONG_MCT = new Set([
  'LHR', 'CDG', 'JFK', 'LAX', 'IST', 'FRA', 'AMS', 'DXB', 'ORD', 'EWR', 'MAD', 'FCO', 'MUC', 'ATL', 'IAD', 'SFO',
  'MIA', 'YYZ', 'DOH', 'SIN', 'HKG', 'NRT', 'HND', 'ICN', 'PEK', 'PVG', 'GRU', 'BCN', 'LGW',
]);

export interface ConnectionInput {
  prev: FlightSegment;
  next: FlightSegment;
  selfTransfer: boolean;
  transferMinutes: number;
  checkedBags: boolean;
  /** Passport control between the two flights (different entry zones). */
  passportControl: boolean;
}

export function requiredConnectionMinutes(c: ConnectionInput): number {
  const airportChange = c.prev.destination !== c.next.origin;
  if (!c.selfTransfer) {
    return (LONG_MCT.has(c.prev.destination) ? 75 : 50) + (c.passportControl ? 15 : 0) + (airportChange ? c.transferMinutes + 30 : 0);
  }
  let minutes = c.checkedBags ? 180 : 120;
  if (c.prev.durationMinutes >= 360) minutes += 60;
  if (c.passportControl) minutes += 30;
  if (airportChange) minutes += c.transferMinutes + 45;
  return minutes;
}

/** Probability (0..1) of missing the next flight. */
export function missProbability(c: ConnectionInput, layoverMinutes: number): number {
  const airportChange = c.prev.destination !== c.next.origin;
  const processing = (c.selfTransfer ? (c.checkedBags ? 75 : 45) : 30) + (airportChange ? c.transferMinutes : 0);
  const slack = layoverMinutes - processing;
  const longHaul = c.prev.durationMinutes >= 360;
  const p0 = longHaul ? 0.35 : 0.3;
  const mu = longHaul ? 50 : 35;
  const delayTail = slack <= 0 ? 1 : p0 * Math.exp(-slack / mu);
  const cancel = c.selfTransfer ? (longHaul ? 0.01 : 0.015) : 0;
  return Math.min(1, cancel + delayTail * (1 - cancel));
}

/** Layover covers at least an hour of 01:00–05:00 local time and lasts 4h+. */
export function isOvernightLayover(arrivalLocal: string, departureLocal: string): boolean {
  const a = localAsUtcMs(arrivalLocal);
  const d = localAsUtcMs(departureLocal);
  if (d - a < 4 * 3600_000) return false;
  const day = 86_400_000;
  for (let t = Math.floor(a / day) * day; t <= d; t += day) {
    const overlap = Math.min(d, t + 5 * 3600_000) - Math.max(a, t + 3600_000);
    if (overlap >= 3600_000) return true;
  }
  return false;
}

/** Airborne for at least an hour between 01:00 and 04:00 (departure-airport time). */
export function isOvernightFlight(seg: FlightSegment): boolean {
  const start = minutesOfDay(seg.departureLocal);
  const end = start + seg.durationMinutes;
  for (const windowStart of [60, 24 * 60 + 60]) {
    const overlap = Math.min(end, windowStart + 180) - Math.max(start, windowStart);
    if (overlap >= 60) return true;
  }
  return false;
}

export interface RiskInputs {
  selfTransferMiss: number[];
  protectedMiss: number[];
  airportChanges: number;
  overnightLayovers: number;
  overnightFlights: number;
  requiresEntry: boolean;
  transitVisaRisk: boolean;
  flags: RiskFlag[];
}

export function riskLevel(score: number): RiskLevel {
  return score < 15 ? 'low' : score < 35 ? 'medium' : 'high';
}

export function assessRisk(r: RiskInputs): RiskAssessment {
  const unprotected = 1 - r.selfTransferMiss.reduce((acc, p) => acc * (1 - p), 1);
  const protectedMiss = 1 - r.protectedMiss.reduce((acc, p) => acc * (1 - p), 1);
  const score = Math.min(
    100,
    Math.round(
      unprotected * 230 +
        protectedMiss * 40 +
        r.airportChanges * 6 +
        r.overnightLayovers * 4 +
        r.overnightFlights * 2 +
        (r.transitVisaRisk ? 5 : 0) +
        (r.requiresEntry ? 3 : 0),
    ),
  );
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return {
    score,
    level: riskLevel(score),
    missProbability: Math.round(unprotected * 1000) / 1000,
    flags: [...r.flags].sort((a, b) => order[a.severity] - order[b.severity]),
  };
}
