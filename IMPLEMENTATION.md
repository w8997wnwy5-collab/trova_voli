# Flight Hacker — implementation plan

Goal: minimise **total trip cost** (fare + bags + fees + ground transfers + optional hotel) while keeping
trade-offs explicit. Everything below is built in this repository; nothing is pseudocode.

## Repository findings

- `trova_voli` was empty (no commits). No conventions to inherit, so the default stack is used:
  Next.js 16 (App Router, Cache Components) + TypeScript, Tailwind CSS 4, Radix UI primitives,
  Zod 4, Prisma 7 + PostgreSQL (optional at runtime), Vitest, Playwright.
- Network checks from the build container: `api.duffel.com`, Duffel docs and the ECB FX feed are not
  reachable here, GitHub raw content is. Real-provider code is therefore verified with fixture tests built
  from Duffel's published TypeScript client types.
- Amadeus Self-Service is reported (third-party sources) as shut down on 17 July 2026, and Kiwi Tequila is
  understood to be closed to new partners, so **Duffel** is the real adapter. Others are listed as backlog,
  not faked.

## Architecture (data flow)

```
SearchForm / URL ──► POST /api/search (Zod) ──► plan.ts      (expand airports, nearby, dates, hubs → prioritised tasks per provider budget)
                                            └► orchestrator (concurrency, timeouts, cache, single-flight, partial failure)
                                                 └► providers/* (mock demo network ×2, Duffel)  → normalized FareOffer
                                            └► engine/combine   (single tickets, split tickets, self-transfers, positioning, multi-city beam search)
                                            └► engine/cost      (fare + bags + booking/payment fees + transfers + hotel, FX)
                                            └► engine/risk      (buffers, missed-connection model, overnight, entry/transit)
                                            └► engine/dedupe + prune (diversity-preserving) + baseline (best conventional)
                     ◄── candidates + provider status + calendar dates
Client: engine/filters (hard/soft) → engine/rank (weighted, explainable) → engine/impact (what each filter costs/saves)
```

Server computes candidates once; filtering, ranking and filter-impact run in the browser with the same pure
modules, so every strategy change is instant and explainable without re-querying providers.

## Key decisions

1. **Money in minor units** with explicit currency; FX conversions are labelled in the breakdown.
2. **Mock data is always labelled "Demo"** (fictional airlines, real airports). Duffel test-mode offers are
   labelled "Test mode". No fare is ever shown as live unless a live provider returned it.
3. **No throwaway/hidden-city ticketing**: every slice of every ticket used must be flown (provider terms).
4. **Budgets**: per-provider call budgets, offers-per-query caps, journey-option caps, beam search for
   multi-city, candidate cap with per-date and per-class diversity.
5. **Ranking** = Σ weight × normalised component (cost, duration, stops, risk, airport changes, preference
   fit). Weights come from the "Save ↔ Comfort" slider or custom weights; tie-breaks are deterministic.
6. **Persistence**: PostgreSQL (Prisma) for a shared provider-response cache (falls back to memory when
   `DATABASE_URL` is unset). Sharing is stateless: the URL holds the whole search and `focus=<id>` points
   at one itinerary, re-priced on open. Favourites are local (no accounts, no personal data).
7. **Two deployments from one codebase**: the server build (API routes, live providers, PostgreSQL) and a
   static GitHub Pages build where the same isomorphic search core runs in the browser with the demo
   providers only (`STATIC_EXPORT=1`, API routes excluded, airport data lazy-loaded).
8. **Security**: secrets stay server-side, Zod at every boundary, per-IP rate limits, structured logs with
   redaction, no payments, no passport data.

## Execution order

1. Scaffold + data (airports from OurAirports/mwgg, metro areas, transfer & hotel estimates).
2. Domain model, schemas, URL codec, presets.
3. Providers: contract, mock network, Duffel.
4. Plan → orchestrator → combine → cost → risk → dedupe/prune → rank/filters/impact/explain.
5. API routes, rate limiting, logging, Prisma cache store.
6. UI: simple search, Trip Strategy drawer, results, calendar heatmap, compare, favourites, share links.
7. Tests (Vitest unit + Playwright E2E + axe), lint, typecheck, build; README.
