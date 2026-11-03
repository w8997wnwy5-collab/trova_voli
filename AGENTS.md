<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Flight Hacker conventions

- Read `README.md` (architecture, assumptions) and `IMPLEMENTATION.md` (plan) first.
- Never present synthetic data as real: demo offers carry `dataQuality: 'demo'` and must stay labelled in the UI;
  Duffel test-mode offers are `'test'`. Do not add deep links for demo data.
- Provider-specific code lives only in `src/lib/providers/<name>/`; everything else uses the normalized model in
  `src/lib/domain/types.ts`. Money is in minor units with an explicit currency.
- `src/lib/engine/{filters,rank,impact,explain}.ts` run in the browser: keep them pure (no `server-only` imports).
- Server planning may only depend on search-scope fields (and `unusualRoutes`/`longStopovers`); every other
  strategy rule is a client-side filter so a URL always reproduces the same candidates.
- `src/lib/search/core.ts` and everything it imports must stay isomorphic (no `server-only`, no Node APIs, no
  env access): the GitHub Pages build runs it in the browser. Server wiring belongs in `service.ts`.
- Never ship secrets to the static build: live providers stay server-only (`registry.ts`).
- Do not log secrets, IPs (use `anonymizeIp`) or traveller data. No payments, no passport data.
- Before committing: `npm run check`; for UI changes also `npm run build && npm run test:e2e` and
  `npm run build:pages && npm run test:pages`.
