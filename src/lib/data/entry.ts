// Border/transit facts used for warnings. Nationality is never collected, so these produce prompts
// to check rules, not definitive visa answers.

export const SCHENGEN = new Set([
  'AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT',
  'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH',
]);

/** Countries without airside international transit: connecting passengers clear immigration. */
export const NO_AIRSIDE_TRANSIT = new Set(['US', 'CA']);

export function entryZone(country: string): string {
  return SCHENGEN.has(country) ? 'SCHENGEN' : country;
}
