// Normalized domain model shared by providers, engines, API and UI.
// Money is always stored in minor units (e.g. cents) together with its ISO currency.

export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';
export type TripType = 'one-way' | 'return' | 'multi-city' | 'open-jaw';
export type DataQuality = 'live' | 'cached' | 'test' | 'demo';

export interface Money {
  /** Minor units (cents). */
  amount: number;
  currency: string;
}

export interface PassengerCounts {
  adults: number;
  children: number;
  infants: number;
}

export interface Carrier {
  code: string;
  name: string;
}

export interface AirportInfo {
  code: string;
  name: string;
  city: string;
  country: string;
  countryName?: string;
  tz?: string;
  lat?: number;
  lon?: number;
  metro?: string;
}

export interface FlightSegment {
  marketingCarrier: Carrier;
  operatingCarrier?: Carrier;
  /** e.g. "AU 1203" */
  flightNumber: string;
  origin: string;
  destination: string;
  /** Local wall-clock time at the airport, "YYYY-MM-DDTHH:mm". */
  departureLocal: string;
  arrivalLocal: string;
  /** UTC epoch milliseconds. */
  departureUtc: number;
  arrivalUtc: number;
  durationMinutes: number;
  cabin: CabinClass;
  aircraft?: string;
  distanceKm?: number;
}

/** One directional part of a ticket (an outbound or a return, or one multi-city leg). */
export interface FareSlice {
  segments: FlightSegment[];
  fareBrand?: string;
}

export interface BaggageAllowance {
  /** Cabin bags (trolley) included per passenger; null when the provider does not say. */
  carryOn: number | null;
  /** Checked bags included per passenger; null when unknown. */
  checked: number | null;
}

export interface BagFees {
  /** Price of one cabin trolley, per passenger and per slice. */
  carryOn?: Money;
  /** Price of one checked bag, per passenger and per slice. */
  checked?: Money;
  source: 'provider' | 'estimate';
}

export type BookingChannel = 'airline' | 'ota' | 'api';

export interface BookingInfo {
  channel: BookingChannel;
  sellerName: string;
  /** Deep link when the provider supplies one. Never constructed by us for real providers. */
  url?: string;
  note?: string;
}

/** A bookable product returned by one provider: exactly one ticket (one or more slices). */
export interface FareOffer {
  id: string;
  providerId: string;
  providerName: string;
  providerOfferId?: string;
  slices: FareSlice[];
  /** Price for all passengers in the query. */
  price: { total: Money; base?: Money; taxes?: Money };
  passengers: PassengerCounts;
  validatingCarrier?: Carrier;
  baggage: BaggageAllowance;
  bagFees?: BagFees;
  /** Fee charged per booking by the seller/channel (known, not estimated). */
  bookingFee?: Money;
  /** Card/payment surcharge known for the channel. */
  paymentFee?: { percent?: number; fixed?: Money };
  booking: BookingInfo;
  conditions?: { refundable: boolean | null; changeable: boolean | null };
  fetchedAt: number;
  expiresAt?: number;
  dataQuality: DataQuality;
  seatsLeft?: number;
}

// ---------------------------------------------------------------------------
// Itineraries (server output, consumed by the client engines)
// ---------------------------------------------------------------------------

export interface SegmentView extends FlightSegment {
  /** Index into Itinerary.tickets. */
  ticket: number;
}

export type ConnectionKind = 'protected' | 'self-transfer';

export interface ConnectionView {
  kind: ConnectionKind;
  /** Airport where the previous flight lands. */
  arrivalAirport: string;
  /** Airport where the next flight leaves (differs on an airport change). */
  departureAirport: string;
  layoverMinutes: number;
  requiredMinutes: number;
  airportChange: boolean;
  groundTransfer?: GroundTransferEstimate;
  overnight: boolean;
  longStopover: boolean;
  missProbability: number;
  /** ISO country code where the connection happens. */
  country: string;
  requiresEntry: boolean;
  notes: string[];
}

export interface GroundTransferEstimate {
  from: string;
  to: string;
  minutes: number;
  /** Per person. */
  cost: Money;
  source: 'curated' | 'heuristic';
  description: string;
}

export interface JourneyView {
  index: number;
  origin: string;
  destination: string;
  departureLocal: string;
  arrivalLocal: string;
  departureUtc: number;
  arrivalUtc: number;
  /** First departure to last arrival. */
  flightTimeMinutes: number;
  /** Flight time + airport overhead + extra ground transfers to/from alternative airports. */
  doorToDoorMinutes: number;
  stops: number;
  segments: SegmentView[];
  connections: ConnectionView[];
  /** Extra ground transfer when the journey starts/ends at a nearby (not requested) airport. */
  accessTransfers: GroundTransferEstimate[];
}

export interface TicketView {
  index: number;
  offerId: string;
  providerId: string;
  providerName: string;
  booking: BookingInfo;
  carriers: Carrier[];
  /** Fare in the user's currency. */
  price: Money;
  /** Fare as quoted by the provider when it was converted. */
  originalPrice?: Money;
  baggage: BaggageAllowance;
  bagFees?: BagFees;
  conditions?: { refundable: boolean | null; changeable: boolean | null };
  fetchedAt: number;
  expiresAt?: number;
  dataQuality: DataQuality;
  /** Which journeys this ticket covers (indexes into journeys). */
  journeys: number[];
  route: string;
  fareBrand?: string;
  seatsLeft?: number;
}

export type CostKind = 'fare' | 'bags' | 'booking-fee' | 'payment-fee' | 'transfer' | 'hotel';

export interface CostLine {
  kind: CostKind;
  label: string;
  amount: Money;
  estimated: boolean;
  note?: string;
}

export interface CostBreakdown {
  lines: CostLine[];
  total: Money;
  perTraveler: Money;
  travelers: number;
  /** Share of total (0..1) that comes from estimates rather than quoted prices. */
  estimatedShare: number;
  /** Optional overnight-hotel estimate included in total (minor units); excluded when the user opts out. */
  hotelAmount: number;
  fxNote?: string;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskFlag {
  code:
    | 'self-transfer'
    | 'airport-change'
    | 'tight-connection'
    | 'overnight-layover'
    | 'long-stopover'
    | 'red-eye'
    | 'separate-tickets'
    | 'entry-required'
    | 'transit-visa'
    | 'bag-recheck'
    | 'stale-price'
    | 'unknown-baggage'
    | 'few-seats';
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface RiskAssessment {
  /** 0 (no risk) .. 100. */
  score: number;
  level: RiskLevel;
  /** Probability that at least one unprotected connection is missed (0..1). */
  missProbability: number;
  flags: RiskFlag[];
}

/** Precomputed facts used by filters and ranking on the client. */
export interface ItineraryAttributes {
  totalCost: number;
  totalMinutes: number;
  maxStops: number;
  totalStops: number;
  maxDoorToDoorMinutes: number;
  ticketCount: number;
  selfTransfers: number;
  /** true when every self-transfer is same-airport, not overnight and has >= 1.25x the recommended buffer. */
  selfTransfersSafe: boolean;
  airportChanges: number;
  airportChangesSameCityOnly: boolean;
  overnightFlights: number;
  overnightLayovers: number;
  longStopovers: number;
  /** min(layover / recommended) across self-transfers (99 when there are none). */
  minSelfTransferRatio: number;
  /** min(layover / comfortable reference) across protected connections (99 when there are none). */
  minProtectedRatio: number;
  bagsIncluded: boolean;
  bagsUnknown: boolean;
  usesNearbyAirport: boolean;
  positioning: boolean;
  unusual: boolean;
  requiresEntry: boolean;
  transitVisaRisk: boolean;
  changeableFare: boolean;
  conventional: boolean;
  outboundDate: string;
  returnDate?: string;
  nights?: number;
  outboundDepartMinutes: number;
  outboundWeekday: number;
  returnDepartMinutes?: number;
  returnWeekday?: number;
  riskScore: number;
}

export type ItineraryTag =
  | 'conventional'
  | 'split-ticket'
  | 'self-transfer'
  | 'airport-change'
  | 'nearby-airport'
  | 'positioning'
  | 'overnight-layover'
  | 'red-eye'
  | 'long-stopover'
  | 'different-return-airport'
  | 'demo'
  | 'test';

export interface Itinerary {
  id: string;
  journeys: JourneyView[];
  tickets: TicketView[];
  cost: CostBreakdown;
  risk: RiskAssessment;
  attrs: ItineraryAttributes;
  tags: ItineraryTag[];
  /** Same flights offered by other providers (after de-duplication). */
  alternatives: { providerName: string; sellerName: string; total: Money }[];
  confidence: { level: 'high' | 'medium' | 'low'; reasons: string[]; oldestFetchAt: number };
}

export type ProviderRunStatus = 'ok' | 'partial' | 'failed' | 'timeout' | 'skipped' | 'not-configured';

export interface ProviderStatus {
  id: string;
  name: string;
  status: ProviderRunStatus;
  dataQuality: DataQuality;
  callsPlanned: number;
  callsMade: number;
  cacheHits: number;
  failures: number;
  skippedByBudget: number;
  offers: number;
  durationMs: number;
  message?: string;
}

export interface SearchStats {
  tasksPlanned: number;
  tasksExecuted: number;
  offersReceived: number;
  itinerariesBuilt: number;
  itinerariesAfterDedupe: number;
  candidatesReturned: number;
  durationMs: number;
}

export interface SearchResponse {
  searchId: string;
  generatedAt: number;
  currency: string;
  dataMode: 'demo' | 'live' | 'mixed' | 'none';
  airports: Record<string, AirportInfo>;
  candidates: Itinerary[];
  /** Cheapest conventional itinerary (single ticket, requested airports, no self-transfer). */
  baselineId?: string;
  providers: ProviderStatus[];
  /** Outbound dates that were actually searched (for the calendar heatmap). */
  searchedDates: string[];
  stats: SearchStats;
  warnings: string[];
  fx: { source: string; asOf: string };
}
