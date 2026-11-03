const EXPENSIVE = new Set(['GB', 'CH', 'NO', 'IS', 'DK', 'IE', 'US', 'SE', 'NL', 'LU', 'JP', 'SG', 'AE', 'QA', 'IL', 'AU', 'NZ', 'CA', 'FR']);
const MID = new Set(['DE', 'AT', 'BE', 'IT', 'ES', 'PT', 'FI', 'KR', 'HK', 'TW', 'CY', 'MT', 'SA', 'BH', 'KW', 'OM', 'GR', 'HR', 'SI', 'EE']);

/** Rough airport-hotel price per room and night in EUR (estimate). */
export function hotelNightEur(country: string): number {
  if (EXPENSIVE.has(country)) return 140;
  if (MID.has(country)) return 105;
  return 70;
}
