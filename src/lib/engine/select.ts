import type { Itinerary } from '@/lib/domain/types';

const label = (it: Itinerary) =>
  it.tickets.map((t) => `${t.providerName}${t.fareBrand ? ` · ${t.fareBrand}` : ''}`).join(' + ');

/** Same flights with the same ticket structure collapse into one; the cheapest total wins and the
 * other sellers are kept as alternatives. */
export function dedupe(itineraries: Itinerary[]): Itinerary[] {
  const byId = new Map<string, Itinerary[]>();
  for (const it of itineraries) {
    const list = byId.get(it.id) ?? [];
    list.push(it);
    byId.set(it.id, list);
  }
  const out: Itinerary[] = [];
  for (const list of byId.values()) {
    list.sort(
      (a, b) => a.attrs.totalCost - b.attrs.totalCost || b.confidence.oldestFetchAt - a.confidence.oldestFetchAt || label(a).localeCompare(label(b)),
    );
    const [best, ...rest] = list;
    const seen = new Set<string>([label(best) + best.attrs.totalCost]);
    const alternatives = rest
      .filter((r) => {
        const key = label(r) + r.attrs.totalCost;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4)
      .map((r) => ({
        providerName: label(r),
        sellerName: r.tickets.map((t) => t.booking.sellerName).join(' + '),
        total: r.cost.total,
      }));
    out.push({ ...best, alternatives });
  }
  return out;
}

/** Diversity-preserving cut: cheapest, fastest, per-date and per-strategy representatives survive so
 * that client-side filters still have meaningful options after pruning. */
export function prune(itineraries: Itinerary[], max: number): Itinerary[] {
  if (itineraries.length <= max) return [...itineraries].sort(byCost);
  const keep = new Map<string, Itinerary>();
  const take = (list: Itinerary[], n: number) => {
    for (const it of list.slice(0, n)) {
      if (keep.size >= max) return;
      keep.set(it.id, it);
    }
  };
  const byCostList = [...itineraries].sort(byCost);
  take(byCostList.filter((i) => i.attrs.conventional), 12);
  take(byCostList, Math.round(max * 0.35));
  take([...itineraries].sort((a, b) => a.attrs.totalMinutes - b.attrs.totalMinutes || byCost(a, b)), Math.round(max * 0.1));
  take([...itineraries].sort((a, b) => a.attrs.riskScore - b.attrs.riskScore || byCost(a, b)), 12);
  take([...itineraries].sort((a, b) => a.attrs.totalStops - b.attrs.totalStops || byCost(a, b)), 12);
  // Per outbound date (and trip length) so the calendar stays meaningful under any filter.
  const groups = new Map<string, Itinerary[]>();
  for (const it of byCostList) {
    const key = `${it.attrs.outboundDate}|${it.attrs.nights ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    take(list, 2);
    take(list.filter((i) => i.attrs.conventional), 1);
    take(list.filter((i) => i.attrs.selfTransfers === 0 && !i.attrs.usesNearbyAirport), 1);
  }
  for (const pred of [
    (i: Itinerary) => i.attrs.selfTransfers > 0,
    (i: Itinerary) => i.attrs.usesNearbyAirport,
    (i: Itinerary) => i.attrs.ticketCount > 1 && i.attrs.selfTransfers === 0,
    (i: Itinerary) => i.attrs.positioning,
    (i: Itinerary) => i.attrs.longStopovers > 0,
    (i: Itinerary) => i.attrs.maxStops === 0,
    (i: Itinerary) => i.attrs.bagsIncluded,
    (i: Itinerary) => i.attrs.changeableFare,
    (i: Itinerary) => i.attrs.selfTransfersSafe && i.attrs.selfTransfers > 0,
  ]) {
    take(byCostList.filter(pred), 8);
  }
  take(byCostList, max);
  return [...keep.values()].sort(byCost);
}

function byCost(a: Itinerary, b: Itinerary): number {
  return a.attrs.totalCost - b.attrs.totalCost || a.attrs.totalMinutes - b.attrs.totalMinutes || a.id.localeCompare(b.id);
}

/** Cheapest conventional itinerary: one ticket, requested airports, no self-transfer. */
export function conventionalBaseline(itineraries: Itinerary[]): Itinerary | undefined {
  return itineraries.filter((i) => i.attrs.conventional).sort(byCost)[0];
}
