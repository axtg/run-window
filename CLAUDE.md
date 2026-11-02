# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Two things in one repo:

1. **Run-window API** (`run.xadi.eu`, design call): a small, stateless, anonymous Express service. Given a location and
   the hours someone can run, it returns the best weather window for each session length today and tomorrow.
   Spec: `docs/superpowers/specs/2026-11-02-run-window-api-design.md`.
2. **TRMNL "Running Board" plugin** (`integrations/trmnl-running-board/`): one full screen with this week's training
   (Tredict), a form graph (Tredict efforts) and today's run window (the API above).
   Spec: `docs/superpowers/specs/2026-11-02-trmnl-running-board-design.md`.

Build the API first: the plugin depends on it.

## Status

Nothing is built yet. Both specs are **awaiting approval**. Write an implementation plan per spec in
`docs/superpowers/plans/` before writing code, and list anything in the specs marked "verify" as the first tasks.

## Sister project

`../eu-dayahead` (dap.xadi.eu) is the reference implementation for structure, conventions, deployment and the TRMNL
test approach. Read its `CLAUDE.md` first. Reuse rather than reinvent:

- Express app exported without `listen` for supertest; `index.js` mounts middleware and routes.
- `middleware/logging.js` (Better Stack, per-day salted client ID instead of IP), `middleware/rateLimit.js`,
  `middleware/securityHeaders.js`. Copy and adapt; **logging here must not log raw coordinates** (see API spec).
- `utils/httpClient.js` for upstream calls with timeouts.
- `docs/openapi.yaml` as the contract, validated with `@apidevtools/swagger-parser`.
- `tests/trmnl/harness.js`: renders the Liquid templates with liquidjs and runs the inline scripts in a `vm` with a
  fake DOM and a fake Highcharts. Copy it and extend it for multiple polling URLs (`IDX_0` … `IDX_3`).
- Docker: `node:22-alpine`, non-root user, healthcheck script. Deployed next to eu-dayahead behind nginx on the same
  host, so `trust proxy` is `loopback`.

## Conventions (same as eu-dayahead)

- Node >= 22, CommonJS, Express 4, Jest + supertest, ESLint + Prettier.
- Single quotes, semicolons, 2-space indent, no trailing commas, max 120 cols.
- Route handlers pass errors on with `next(error)`; set `statusCode` to choose the status. Only 4xx messages reach
  clients.
- All times in responses are UTC ISO strings; local-day logic uses `date-fns-tz` with the location's IANA timezone.
- Tests never hit live upstreams. Open-Meteo fixtures come from real responses for a public landmark (Amsterdam centre,
  52.37, 4.89), never a personal location. Tredict fixtures are synthetic: same structure as the real API, invented
  values. No tokens anywhere.
- This repo is public. Real personal data (Tredict responses, home coordinates) only goes in the gitignored
  `tests/fixtures/private/`, and `npm test` must pass without that folder.

## Commands

To be added once `package.json` exists. Mirror eu-dayahead: `dev`, `start`, `test`, `test:coverage`, `lint`,
`lint:fix`, `format`, `validate-api`, `docker:build`.
