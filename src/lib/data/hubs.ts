/**
 * Real-world airports with dense connectivity (network hubs and low-cost bases). Used to pick
 * candidate self-transfer and positioning points; weight ~ how often a cheap onward flight exists.
 */
export const CONNECTION_HUBS: Record<string, number> = {
  // Europe — network hubs
  LHR: 1, CDG: 1, AMS: 1, FRA: 1, MUC: 0.9, IST: 1, MAD: 0.9, FCO: 0.85, ZRH: 0.8, VIE: 0.8, CPH: 0.8, ARN: 0.7,
  OSL: 0.7, HEL: 0.7, LIS: 0.8, DUB: 0.8, BRU: 0.7, ATH: 0.7, WAW: 0.7, MXP: 0.8, BCN: 0.85, BER: 0.75, DUS: 0.6,
  // Europe — low-cost bases
  STN: 0.9, LGW: 0.9, LTN: 0.8, BGY: 0.85, CRL: 0.7, BVA: 0.6, CIA: 0.6, BUD: 0.75, OTP: 0.6, KRK: 0.6, PMI: 0.6,
  AGP: 0.6, NAP: 0.6, SAW: 0.7, WMI: 0.5, MAN: 0.6, EDI: 0.5, PRG: 0.6, VCE: 0.5, ORY: 0.6, NCE: 0.5, GVA: 0.6,
  // Middle East, Africa
  DXB: 1, DOH: 1, AUH: 0.8, CAI: 0.6, ADD: 0.7, CMN: 0.6, JNB: 0.6, NBO: 0.6,
  // Americas
  JFK: 0.9, EWR: 0.8, BOS: 0.7, ORD: 0.8, ATL: 0.8, MIA: 0.8, LAX: 0.8, SFO: 0.7, YYZ: 0.8, YUL: 0.6, IAD: 0.6,
  MEX: 0.6, BOG: 0.6, GRU: 0.7, PTY: 0.6,
  // Asia-Pacific
  SIN: 1, HKG: 0.9, BKK: 0.8, ICN: 0.8, HND: 0.8, NRT: 0.7, DEL: 0.7, BOM: 0.6, KUL: 0.8, PVG: 0.7, SYD: 0.6,
};

/** Large airports frequently served by long-haul flights (used by the demo network). */
export const GLOBAL_GATEWAYS = new Set([
  'LHR', 'CDG', 'AMS', 'FRA', 'MUC', 'IST', 'MAD', 'FCO', 'ZRH', 'VIE', 'CPH', 'LIS', 'DUB', 'MXP', 'BCN', 'BRU',
  'DXB', 'DOH', 'AUH', 'CAI', 'ADD', 'CMN', 'JNB', 'NBO', 'LOS', 'JFK', 'EWR', 'BOS', 'ORD', 'ATL', 'MIA', 'LAX',
  'SFO', 'IAD', 'YYZ', 'YUL', 'YVR', 'MEX', 'BOG', 'GRU', 'GIG', 'EZE', 'SCL', 'LIM', 'PTY', 'SIN', 'HKG', 'BKK',
  'ICN', 'HND', 'NRT', 'KIX', 'DEL', 'BOM', 'KUL', 'PVG', 'PEK', 'SYD', 'MEL', 'AKL', 'CGK', 'MNL', 'TPE', 'SEA',
  'DFW', 'IAH', 'DEN', 'TLV', 'RUH', 'JED', 'BLR', 'MLE', 'CPT', 'HKT', 'DPS', 'SGN', 'HAN', 'CUN', 'PUJ',
]);
