# Flight Hacker

Finds the **cheapest practical** way to fly — including combinations standard comparison sites skip — and
ranks them by **total trip cost**, time and risk, with every trade-off explained.

- Exact or flexible dates, date windows with trip-length ranges, cheapest day in a month (price calendar).
- One-way, return, open-jaw and multi-city; nearby airports within a configurable radius.
- Separate outbound/return tickets, mixed airlines and sellers, self-transfers (with recommended buffers and
  missed-connection odds), airport changes, positioning flights, overnight layovers and optional stopovers.
- Total cost = fares + missing bags + booking/card fees + estimated airport transfers + optional hotel for
  overnight connections, per traveller and per group. Estimates are always labelled.
- "Best value" ranking that is deterministic, configurable (Save ↔ Comfort slider or custom weights) and
  explained per itinerary; savings shown against the best conventional itinerary.
- Simple search + a **Trip strategy** drawer with presets (Cheapest possible, Balanced, Comfortable, Weekend
  escape, Business-safe, Custom), hard "Must" vs soft "Prefer" rules and live impact (options and cheapest
  price) for every choice. Sorting, comparison, favourites and shareable URLs.

> Without provider credentials the app runs on a **demo network**: fictional airlines over real airports,
> deterministic synthetic fares. Demo results are labelled everywhere and are never presented as real.

## Online demo (GitHub Pages)

**https://w8997wnwy5-collab.github.io/trova_voli/** — a static build in which the whole search engine runs
in your browser (no server, no keys). Live providers need secret API keys and therefore a server, so the
Pages site always uses the demo network.

One-time setup: GitHub → **Settings → Pages → Build and deployment → Source: GitHub Actions**. After that,
every push to the default branch runs the checks and deploys (`.github/workflows/pages.yml`); pushes to other
branches only build and test.

Preview the static site locally:

```bash
npm run build:pages
```

```bash
npm run preview:pages
```

Then open http://localhost:4173/trova_voli/.

## Quick start (full version with server)

```bash
npm install            # also generates the Prisma client
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

Optional PostgreSQL (shared provider cache across instances):

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/flight_hacker npm run db:deploy
```

To search real fares set `DUFFEL_ACCESS_TOKEN` (and usually `ENABLE_DEMO_PROVIDERS=false`).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run build:pages` / `preview:pages` | Static GitHub Pages build in `out/` (demo engine in the browser) and a local preview server |
| `npm run test:pages` | Playwright smoke tests against the static build |
| `npm run check` | Lint + typecheck + unit tests |
| `npm run lint`, `npm run typecheck` | ESLint (Next config), `next typegen && tsc --noEmit` |
| `npm test` | Vitest unit/integration tests (`TEST_DATABASE_URL=… npm test` also runs the Postgres test) |
| `npm run test:e2e` | Playwright E2E + axe accessibility checks (run `npm run build` first; `test:e2e:ci` builds) |
| `npm run db:migrate` / `db:deploy` | Prisma migrations (dev / deploy) |
| `npm run data:airports -- <airports.csv> <countries.csv> <mwgg.json>` | Rebuild the airport dataset |

## Architecture

```
src/
  app/                      pages (/, /search, /favorites) and API routes
    api/search              POST: Zod-validated search → candidates (rate-limited, gzip)
    api/airports            GET: autocomplete (?q=) and labels (?codes=)
    api/health              GET: providers, database status (no secrets)
  components/               UI (Radix primitives + Tailwind): search form, strategy drawer, results
  lib/
    domain/                 normalized flight model (types), Zod schemas, presets/strategy
    data/                   airports (3,180 with time zones), metro areas, hubs, entry rules, estimates
    providers/              adapter contract + mock (demo network) + Duffel; provider logic stays here
    search/                 core (isomorphic pipeline), plan (airports × dates × hubs → tasks),
                            orchestrator, cache; service.ts wires it for the server
    engine/                 combine · assemble · cost · risk · select (dedupe/prune) — server
                            filters · rank · impact · explain — pure, also run in the browser
    server/                 config (Zod env), logger (redaction), rate limits, Prisma, FX source
    client/                 search hook, favourites, browser-search (static build only, lazy-loaded)
    url/                    shareable search URL codec
prisma/                     schema + migrations (ProviderCacheEntry)
tests/unit, tests/e2e       Vitest and Playwright suites
```

Flow: **plan** expands the request (metro codes, nearby airports, date sets, hubs for self-transfers and
positioning) into prioritised provider tasks → **orchestrator** runs providers concurrently with per-provider
concurrency, call budgets, timeouts, a whole-search deadline, caching, single-flight de-duplication and a
circuit breaker; one failing provider never discards the others → **combine** builds single tickets, split
tickets, self-transfers, positioning trips and multi-city beams with pruning caps → **assemble** prices and
risk-assesses each itinerary → **select** de-duplicates identical flights across sellers and keeps a
diversity-preserving set. The browser then applies hard/soft rules, ranks and computes filter impact
instantly with the same pure modules; the URL is the single source of truth.

**Ranking.** `score = Σ weightᵢ × componentᵢ` (0–100). Components: cost (linear to 0 at 2× the cheapest),
door-to-door time (0 at 2.5× the fastest), stops, connection risk, airport changes/nearby airports, and fit
with soft preferences. Weights interpolate between "save" and "comfort" profiles or come from custom weights.
Ties break on cost, time, then id. Each card shows the component bars and the reasons.

**Risk.** Recommended buffers: protected 50–75 min (+15 passport control); self-transfer 2 h (3 h with checked
bags) + 1 h after long-haul + 30 min passport control + transfer time on an airport change. Miss probability
uses an exponential delay tail plus cancellation risk for unprotected connections. Flags: self-transfer,
airport change, tight connection, overnight layover/flight, separate tickets, entry/transit visa, bag recheck,
stale price, unknown baggage, few seats.

## Assumptions

- Door-to-door = flight time + 2 h airport overhead + extra ground time to/from nearby airports.
- Transfers and hotels are estimates: curated airport pairs (e.g. LGW↔STN) or a distance heuristic; hotel
  rates by country tier. Missing bag fees use provider prices or €20/€35 estimates.
- Nationality is never collected, so visa/ETA results are warnings to check, not decisions.
- FX uses bundled approximate rates unless `FX_SOURCE=ecb`; conversions are labelled.
- Per-traveller price = group total ÷ travellers (lap infants included in the count).
- No accounts: favourites live in the browser. No payments and no passport data are handled or stored.
- Throwaway and hidden-city ticketing are never suggested (every ticketed flight is flown).

## Providers and limitations

| Source | Status |
| --- | --- |
| Demo Air Network / Demo Budget Finder | Built in. Fictional airlines, deterministic fares, not bookable. |
| **Duffel** (Flights API v2) | Implemented (offer requests, mapping, errors, retry, caching ≤ 5 min). Needs `DUFFEL_ACCESS_TOKEN`. Search only: booking needs the Orders API and payments, which are out of scope. |
| Amadeus Self-Service | Not implemented: third-party migration guides report the self-service APIs were shut down on 17 July 2026 (enterprise access needs a contract). Confirm with Amadeus before relying on it. |
| Kiwi Tequila | Not implemented: public sign-up was closed to new partners as far as known; not verifiable from the build environment. |

Live-provider searches are budgeted (`DUFFEL_MAX_CALLS_PER_SEARCH`, default 12): the planner spends calls on
the requested airports and central dates first, then nearby airports, hubs and positioning. Wide searches
(whole month, many airports) therefore cover fewer combinations with a live provider than with the demo
network; the status bar shows how many queries ran. In-memory caches and rate limits are per instance unless
PostgreSQL is configured (cache only).

## Data & licences

Airports: [OurAirports](https://ourairports.com/data/) (public domain) filtered to scheduled-service
large/medium airports, with IANA time zones from [mwgg/Airports](https://github.com/mwgg/Airports) (MIT).

## Backlog (blocked on credentials or contracts)

1. Validate the Duffel adapter against a live `duffel_test_` token (fixture-tested only; `api.duffel.com`
   was not reachable from the build environment) and tune call budgets to the account's rate limits.
2. Booking hand-off: Duffel Orders + payment flow, or deep links from an affiliate/metasearch partner.
3. Additional licensed sources (e.g. an Amadeus Enterprise or Travelport contract, airline NDC partners).
4. Verify `FX_SOURCE=ecb` against the live ECB feed (implemented, but the feed was not reachable from the
   build environment; bundled approximate rates are used meanwhile).
