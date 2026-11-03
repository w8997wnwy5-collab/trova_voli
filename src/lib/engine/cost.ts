import type { CostBreakdown, CostLine, FareOffer, Money, PassengerCounts } from '@/lib/domain/types';
import { convert, type FxRates } from '@/lib/util/fx';
import { money, toDecimal } from '@/lib/util/money';

// Total trip cost = fares + bags + booking/payment fees + ground transfers + optional hotel.

export const ESTIMATED_FEES_EUR = { carryOn: 20, checked: 35 };

export interface CostContext {
  currency: string;
  fx: FxRates;
  passengers: PassengerCounts;
  bags: { carryOn: boolean; checked: number };
}

export interface ExtraCost {
  kind: 'transfer' | 'hotel';
  label: string;
  /** EUR per unit (person or room-night). */
  eurPerUnit: number;
  units: number;
  note?: string;
}

/** Travellers who need a seat, bags and ground transport (lap infants excluded). */
export const seatedTravellers = (p: PassengerCounts) => p.adults + p.children;

export interface BagNeed {
  carryOnFee: Money | null;
  carryOnUnits: number;
  checkedFee: Money | null;
  checkedUnits: number;
  estimated: boolean;
  unknownAllowance: boolean;
  /** The fare alone covers the requested bags. */
  included: boolean;
}

/** Bags to buy for one ticket, in the ticket's own currency. */
export function bagNeeds(offer: FareOffer, ctx: Pick<CostContext, 'passengers' | 'bags' | 'fx'>): BagNeed {
  const travellers = seatedTravellers(ctx.passengers);
  const slices = offer.slices.length;
  const allowance = offer.baggage;
  const cur = offer.price.total.currency;
  let estimated = false;
  // Unknown cabin allowance: assume included (most fares) but flag it; unknown checked: assume not included.
  const carryOnMissing = ctx.bags.carryOn && allowance.carryOn !== null && allowance.carryOn < 1;
  const checkedMissing = Math.max(0, ctx.bags.checked - (allowance.checked ?? 0));
  let carryOnFee: Money | null = null;
  let checkedFee: Money | null = null;
  if (carryOnMissing) {
    carryOnFee = offer.bagFees?.carryOn ?? null;
    if (!carryOnFee) {
      estimated = true;
      carryOnFee = eurIn(ESTIMATED_FEES_EUR.carryOn, cur, ctx.fx);
    }
  }
  if (checkedMissing > 0) {
    checkedFee = offer.bagFees?.checked ?? null;
    if (!checkedFee || allowance.checked === null) {
      estimated = true;
      checkedFee = checkedFee ?? eurIn(ESTIMATED_FEES_EUR.checked, cur, ctx.fx);
    }
  }
  if (offer.bagFees?.source === 'estimate') estimated = true;
  return {
    carryOnFee,
    carryOnUnits: carryOnMissing ? travellers * slices : 0,
    checkedFee,
    checkedUnits: checkedMissing * travellers * slices,
    estimated,
    unknownAllowance: allowance.carryOn === null || allowance.checked === null,
    included: !carryOnMissing && checkedMissing === 0 && allowance.checked !== null,
  };
}

/** Bag fee estimates are defined in EUR; providers may quote other currencies. */
function eurIn(eur: number, currency: string, fx: FxRates): Money {
  return convert(money(eur, 'EUR'), currency, fx).money;
}

/** Quick cost of a ticket in the user's currency (minor units) for pruning before full assembly. */
export function approxOfferCost(offer: FareOffer, ctx: CostContext): number {
  const need = bagNeeds(offer, ctx);
  let total = offer.price.total.amount;
  if (need.carryOnFee) total += need.carryOnFee.amount * need.carryOnUnits;
  if (need.checkedFee) total += need.checkedFee.amount * need.checkedUnits;
  if (offer.bookingFee && offer.bookingFee.currency === offer.price.total.currency) total += offer.bookingFee.amount;
  return convert({ amount: total, currency: offer.price.total.currency }, ctx.currency, ctx.fx).money.amount;
}

export type CostResult = CostBreakdown;

function describeQuote(original: Money): string {
  return `Quoted ${toDecimal(original).toFixed(2)} ${original.currency}, converted`;
}

/** Full, labelled breakdown. Every estimate is marked as such. */
export function computeCost(tickets: { offer: FareOffer; label: string }[], extras: ExtraCost[], ctx: CostContext): CostResult {
  const lines: CostLine[] = [];
  let converted = false;
  const toUser = (m: Money) => {
    const r = convert(m, ctx.currency, ctx.fx);
    if (r.converted) converted = true;
    return r;
  };
  for (const { offer, label } of tickets) {
    const fare = toUser(offer.price.total);
    lines.push({ kind: 'fare', label: `${label} — fare`, amount: fare.money, estimated: false, note: fare.converted ? describeQuote(offer.price.total) : undefined });

    const need = bagNeeds(offer, ctx);
    let bagsInTicketCurrency = 0;
    const parts: string[] = [];
    if (need.carryOnFee && need.carryOnUnits) {
      bagsInTicketCurrency += need.carryOnFee.amount * need.carryOnUnits;
      parts.push(`${need.carryOnUnits} cabin bag${need.carryOnUnits > 1 ? 's' : ''}`);
    }
    if (need.checkedFee && need.checkedUnits) {
      bagsInTicketCurrency += need.checkedFee.amount * need.checkedUnits;
      parts.push(`${need.checkedUnits} checked bag${need.checkedUnits > 1 ? 's' : ''}`);
    }
    if (bagsInTicketCurrency > 0) {
      const bags = toUser({ amount: bagsInTicketCurrency, currency: need.checkedFee?.currency ?? need.carryOnFee!.currency });
      lines.push({
        kind: 'bags',
        label: `${label} — bags`,
        amount: bags.money,
        estimated: need.estimated,
        note: `${parts.join(' + ')} (per traveller and flight)${need.estimated ? ', fee estimated' : ''}`,
      });
    }
    if (offer.bookingFee && offer.bookingFee.amount > 0) {
      lines.push({ kind: 'booking-fee', label: `${label} — booking fee (${offer.booking.sellerName})`, amount: toUser(offer.bookingFee).money, estimated: false });
    }
    if (offer.paymentFee) {
      const base = offer.price.total.amount + bagsInTicketCurrency;
      const pct = offer.paymentFee.percent ? Math.round((base * offer.paymentFee.percent) / 100) : 0;
      const fixed = offer.paymentFee.fixed ? toUser(offer.paymentFee.fixed).money.amount : 0;
      const amount = toUser({ amount: pct, currency: offer.price.total.currency }).money.amount + fixed;
      if (amount > 0) {
        lines.push({
          kind: 'payment-fee',
          label: `${label} — card payment fee`,
          amount: { amount, currency: ctx.currency },
          estimated: false,
          note: offer.paymentFee.percent ? `${offer.paymentFee.percent}% of fare and bags` : undefined,
        });
      }
    }
  }
  let hotelAmount = 0;
  for (const e of extras) {
    if (e.units <= 0 || e.eurPerUnit <= 0) continue;
    const amount = convert(money(e.eurPerUnit * e.units, 'EUR'), ctx.currency, ctx.fx);
    if (amount.converted) converted = true;
    if (e.kind === 'hotel') hotelAmount += amount.money.amount;
    lines.push({ kind: e.kind, label: e.label, amount: amount.money, estimated: true, note: e.note });
  }
  const total = lines.reduce((s, l) => s + l.amount.amount, 0);
  const estimatedTotal = lines.filter((l) => l.estimated).reduce((s, l) => s + l.amount.amount, 0);
  const travellers = Math.max(1, ctx.passengers.adults + ctx.passengers.children + ctx.passengers.infants);
  return {
    lines,
    total: { amount: total, currency: ctx.currency },
    perTraveler: { amount: Math.round(total / travellers), currency: ctx.currency },
    travelers: travellers,
    estimatedShare: total > 0 ? Math.round((estimatedTotal / total) * 1000) / 1000 : 0,
    fxNote: converted ? `Includes amounts converted to ${ctx.currency} with ${ctx.fx.source.toLowerCase()}${ctx.fx.asOf !== 'bundled' ? ` (${ctx.fx.asOf})` : ''}.` : undefined,
    hotelAmount,
  };
}
