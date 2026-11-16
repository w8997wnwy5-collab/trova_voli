import type { CabinClass, PassengerCounts } from '@/lib/domain/types';

// Pre-filled searches on public flight search sites, so any route and date can be checked and booked
// against live market prices. These are ordinary links to the sites' search pages, not data scraping.

export interface LinkSlice {
  origin: string;
  destination: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface LinkSearch {
  slices: LinkSlice[];
  passengers: PassengerCounts;
  cabin: CabinClass;
  currency: string;
}

const isRoundTrip = (s: LinkSlice[]) => s.length === 2 && s[0].origin === s[1].destination && s[0].destination === s[1].origin;

/** Google Flights accepts a natural-language query. */
export function googleFlightsUrl({ slices, passengers, cabin, currency }: LinkSearch): string {
  const [a, b] = slices;
  const people = passengers.adults + passengers.children + passengers.infants;
  const cabinText = cabin === 'economy' ? '' : ` ${cabin.replace('_', ' ')}`;
  const q = isRoundTrip(slices)
    ? `Flights from ${a.origin} to ${a.destination} on ${a.date} through ${b.date}${cabinText} for ${people} passengers`
    : `Flights from ${a.origin} to ${a.destination} on ${a.date} one way${cabinText} for ${people} passengers`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=${currency}&hl=it`;
}

const SKY_CABIN: Record<CabinClass, string> = { economy: 'economy', premium_economy: 'premiumeconomy', business: 'business', first: 'first' };
const yymmdd = (d: string) => d.slice(2).replace(/-/g, '');

/** Skyscanner search results page (Italian site). Children are passed with an assumed age of 8, lap infants as 1. */
export function skyscannerUrl({ slices, passengers, cabin }: LinkSearch): string {
  const [a, b] = slices;
  const ages = [...Array(passengers.children).fill('8'), ...Array(passengers.infants).fill('1')].join('|');
  const path = isRoundTrip(slices)
    ? `${a.origin}/${a.destination}/${yymmdd(a.date)}/${yymmdd(b.date)}/`
    : `${a.origin}/${a.destination}/${yymmdd(a.date)}/`;
  const params = new URLSearchParams({ adultsv2: String(passengers.adults), cabinclass: SKY_CABIN[cabin], rtn: isRoundTrip(slices) ? '1' : '0' });
  if (ages) params.set('childrenv2', ages);
  return `https://www.skyscanner.it/trasporti/voli/${path.toLowerCase()}?${params.toString()}`;
}
