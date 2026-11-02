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

The API comes first: the plugin depends on it.

## Status

The API is built and tested but not deployed. The TRMNL plugin is not started: its spec is awaiting approval, and an
implementation plan goes in `docs/superpowers/plans/` before any code. List anything in the plugin spec marked "verify"
as the first tasks.

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

- `npm run dev` / `npm start`: run the API (`PORT` 3001, `HOST` 127.0.0.1 by default).
- `npm test`, `npm run test:coverage`: Jest. `tests/fixtures/private/` is optional and git-ignored.
- `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`.
- `npm run validate-api`: validates `docs/openapi.yaml`.
- `npm run build:css`: rebuilds `public/tailwind.css`; CI fails if the committed file is out of date.
- `npm run docker:build`: builds the image. `docker-compose.yml` uses host networking bound to 127.0.0.1:3001, so
  nginx reaches it over loopback (`trust proxy` is `loopback`). `docker/nginx-run.xadi.eu.conf` is the nginx site: it
  logs a fixed list of paths only, strips `Authorization` and `Cookie`, and allows `/health/cache` from the host only.
