// Fictional airlines for the demo network. Names are invented; airports are real.
// Prices produced from these profiles are synthetic and always labelled "Demo".

export type DemoAirlineKind = 'fsc' | 'lcc' | 'lcc-longhaul';

export interface DemoAirline {
  code: string;
  name: string;
  kind: DemoAirlineKind;
  /** Network hubs (FSC) or bases (LCC). */
  hubs: string[];
  homeCountries: string[];
  longHaul: boolean;
  /** EUR per adult for a one-way economy seat: fixed + perKm * distance (before demand factors). */
  pricing: { fixed: number; perKm: number };
  bags: {
    carryOnIncluded: boolean;
    /** Checked bags included in the cheapest brand. */
    checkedIncluded: 0 | 1;
    carryOnFeeEur?: number;
    checkedFeeEur: number;
  };
  /** Which demo provider sells this airline. */
  soldBy: 'network' | 'budget';
}

export const DEMO_AIRLINES: DemoAirline[] = [
  // Full-service carriers (sold by the "Demo Air Network" provider)
  { code: 'AU', name: 'Aurora Atlantic', kind: 'fsc', hubs: ['LHR'], homeCountries: ['GB', 'IE'], longHaul: true, pricing: { fixed: 72, perKm: 0.085 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 38 }, soldBy: 'network' },
  { code: 'MR', name: 'Meridian Airways', kind: 'fsc', hubs: ['FRA', 'MUC'], homeCountries: ['DE', 'AT'], longHaul: true, pricing: { fixed: 68, perKm: 0.082 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 35 }, soldBy: 'network' },
  { code: 'LV', name: 'Levante Air', kind: 'fsc', hubs: ['FCO', 'LIN'], homeCountries: ['IT'], longHaul: true, pricing: { fixed: 62, perKm: 0.08 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 32 }, soldBy: 'network' },
  { code: 'GX', name: 'Gallia Express', kind: 'fsc', hubs: ['CDG'], homeCountries: ['FR'], longHaul: true, pricing: { fixed: 70, perKm: 0.084 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 35 }, soldBy: 'network' },
  { code: 'NS', name: 'Nordstjerna', kind: 'fsc', hubs: ['CPH', 'ARN', 'OSL'], homeCountries: ['DK', 'SE', 'NO', 'FI'], longHaul: true, pricing: { fixed: 66, perKm: 0.08 }, bags: { carryOnIncluded: true, checkedIncluded: 1, checkedFeeEur: 30 }, soldBy: 'network' },
  { code: 'AS', name: 'Atlantica Sur', kind: 'fsc', hubs: ['MAD', 'LIS'], homeCountries: ['ES', 'PT'], longHaul: true, pricing: { fixed: 60, perKm: 0.078 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 30 }, soldBy: 'network' },
  { code: 'HV', name: 'Helvetia Lines', kind: 'fsc', hubs: ['ZRH'], homeCountries: ['CH'], longHaul: true, pricing: { fixed: 80, perKm: 0.09 }, bags: { carryOnIncluded: true, checkedIncluded: 1, checkedFeeEur: 40 }, soldBy: 'network' },
  { code: 'LW', name: 'Lowland Wings', kind: 'fsc', hubs: ['AMS'], homeCountries: ['NL', 'BE'], longHaul: true, pricing: { fixed: 66, perKm: 0.082 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 35 }, soldBy: 'network' },
  { code: 'BW', name: 'Bosphorus Wings', kind: 'fsc', hubs: ['IST'], homeCountries: ['TR'], longHaul: true, pricing: { fixed: 55, perKm: 0.07 }, bags: { carryOnIncluded: true, checkedIncluded: 1, checkedFeeEur: 25 }, soldBy: 'network' },
  { code: 'GA', name: 'Gulf Arc', kind: 'fsc', hubs: ['DOH', 'DXB'], homeCountries: ['QA', 'AE'], longHaul: true, pricing: { fixed: 70, perKm: 0.066 }, bags: { carryOnIncluded: true, checkedIncluded: 1, checkedFeeEur: 45 }, soldBy: 'network' },
  { code: 'PF', name: 'Pacifica', kind: 'fsc', hubs: ['SIN', 'HKG'], homeCountries: ['SG', 'HK'], longHaul: true, pricing: { fixed: 75, perKm: 0.07 }, bags: { carryOnIncluded: true, checkedIncluded: 1, checkedFeeEur: 45 }, soldBy: 'network' },
  { code: 'CC', name: 'Continental Crest', kind: 'fsc', hubs: ['JFK', 'ORD'], homeCountries: ['US'], longHaul: true, pricing: { fixed: 85, perKm: 0.08 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 40 }, soldBy: 'network' },
  // Low-cost carriers (sold by the "Demo Budget Finder" provider)
  { code: 'QJ', name: 'Quickjet', kind: 'lcc', hubs: ['STN', 'BGY', 'CRL', 'DUB', 'BVA', 'CIA', 'WMI', 'KRK', 'BCN', 'MAD', 'PMI', 'AGP', 'MAN', 'NAP', 'PSA', 'TSF', 'BLQ', 'OPO', 'CTA'], homeCountries: ['IE', 'GB', 'IT', 'ES', 'BE', 'PL'], longHaul: false, pricing: { fixed: 11, perKm: 0.036 }, bags: { carryOnIncluded: false, checkedIncluded: 0, carryOnFeeEur: 22, checkedFeeEur: 34 }, soldBy: 'budget' },
  { code: 'SH', name: 'Skyhop', kind: 'lcc', hubs: ['LGW', 'LTN', 'MXP', 'BER', 'AMS', 'GVA', 'BSL', 'NCE', 'LIS', 'NAP', 'ORY', 'BRS', 'EDI', 'VCE'], homeCountries: ['GB', 'CH', 'FR', 'DE', 'IT', 'PT'], longHaul: false, pricing: { fixed: 17, perKm: 0.043 }, bags: { carryOnIncluded: false, checkedIncluded: 0, carryOnFeeEur: 16, checkedFeeEur: 30 }, soldBy: 'budget' },
  { code: 'VT', name: 'Ventura', kind: 'lcc', hubs: ['BUD', 'OTP', 'WAW', 'KTW', 'VIE', 'FCO', 'LTN', 'SOF', 'BGY', 'GDN', 'TIA', 'SKP'], homeCountries: ['HU', 'RO', 'PL', 'BG', 'AL', 'MK'], longHaul: false, pricing: { fixed: 13, perKm: 0.039 }, bags: { carryOnIncluded: false, checkedIncluded: 0, carryOnFeeEur: 25, checkedFeeEur: 38 }, soldBy: 'budget' },
  { code: 'FF', name: 'Fjordflyer', kind: 'lcc', hubs: ['OSL', 'ARN', 'CPH', 'BGO', 'HEL', 'TRF', 'NYO'], homeCountries: ['NO', 'SE', 'DK', 'FI'], longHaul: false, pricing: { fixed: 19, perKm: 0.046 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 28 }, soldBy: 'budget' },
  { code: 'BZ', name: 'Brisa', kind: 'lcc', hubs: ['BCN', 'ORY', 'FCO', 'SVQ', 'BIO', 'VLC', 'ALC'], homeCountries: ['ES', 'FR'], longHaul: false, pricing: { fixed: 15, perKm: 0.042 }, bags: { carryOnIncluded: true, checkedIncluded: 0, checkedFeeEur: 29 }, soldBy: 'budget' },
  { code: 'TA', name: 'Transatlantica Low', kind: 'lcc-longhaul', hubs: ['LGW', 'CDG', 'BCN', 'FCO', 'DUB', 'JFK', 'BOS', 'MIA', 'YUL'], homeCountries: ['GB', 'FR', 'ES', 'IT', 'IE', 'US', 'CA'], longHaul: true, pricing: { fixed: 95, perKm: 0.026 }, bags: { carryOnIncluded: false, checkedIncluded: 0, carryOnFeeEur: 39, checkedFeeEur: 65 }, soldBy: 'budget' },
];

export const DEMO_AIRLINE_BY_CODE = new Map(DEMO_AIRLINES.map((a) => [a.code, a]));
