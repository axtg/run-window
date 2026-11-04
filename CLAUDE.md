# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Three things in one repo:

1. **Run-window API** (`run.xadi.eu`, design call): a small, stateless, anonymous Express service. Given a location and
   the hours someone can run, it returns the best weather window for each session length today and tomorrow.
   Spec: `docs/superpowers/specs/2026-11-02-run-window-api-design.md`.
2. **TRMNL "Running Board" plugin** (`integrations/trmnl-running-board/`): one full screen with this week's training
   (Tredict), a form graph (Tredict efforts) and today's run window (the API above).
   Spec: `docs/superpowers/specs/2026-11-02-trmnl-running-board-design.md`.
3. **Web interface** (`public/`, served at `/`): a page where someone opens a GPX/KML route (or uses their location)
   and sees the best window for that run on a day strip. It reads the file in the browser and calls the API with
   `slots=1`. Spec: `docs/superpowers/specs/2026-11-04-run-window-web-ui-design.md`.

The API comes first: the plugin depends on it.

## Status

The API is live at `https://run.xadi.eu` (deployed 2026-11-03). The TRMNL plugin is built and tested; install steps are
in `integrations/trmnl-running-board/README.md`. The install check on the device (plan Task 12) is pending. Publishing
it as a recipe waits for Tredict's written agreement (see the plugin spec, "Tredict's terms"). The web interface is
built, and the manifest lists the page in Android's share sheet for route files (`share_target`). It needs the nginx
`/share-target` location live on the host (see "Web interface").

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

- `npm run dev` / `npm start`: run the API (`PORT` 3003, `HOST` 127.0.0.1 by default).
- `npm test`, `npm run test:coverage`: Jest. `tests/fixtures/private/` is optional and git-ignored.
- `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`.
- `npm run validate-api`: validates `docs/openapi.yaml`.
- `npm run build:css`: rebuilds `public/tailwind.css`; CI fails if the committed file is out of date.
- `npm run build:trmnl`: regenerates `integrations/trmnl-running-board/transform.js` from `src/`. Never edit that file
  by hand; CI fails if it differs from the build output. `node tests/trmnl/preview.js <dir>` writes an HTML preview of
  the render cases.
- `npm run docker:build`: builds the image. `docker-compose.yml` uses host networking bound to 127.0.0.1:3003, so
  nginx reaches it over loopback (`trust proxy` is `loopback`). `docker/nginx-run.xadi.eu.conf` is the nginx site: it
  logs a fixed list of paths only, strips `Authorization` and `Cookie`, and allows `/health/cache` from the host only.

## Web interface

`public/` holds the page (`index.html`, `app.js`) and its modules (`route.js`, `plan.js`, `strip.js`, `settings.js`),
the worker `sw.js`, the manifest and icons.

- Each module is an IIFE that exports its API with `module.exports` in Node and as a global in the browser (the
  eu-dayahead pattern). Jest tests live in `tests/web/`.
- Same-origin only: external `<script src="/...">` files, no inline script, `<style>`, `style=` attribute or
  `setAttribute('style', ...)`. The CSP is unchanged (`script-src 'self'`, `style-src 'self'`, `connect-src 'self'`,
  no hashes). Styling is Tailwind classes in `public/tailwind.css`.
- Tailwind scans only `index.html`, `app.js` and `strip.js`: run `npm run build:css` after editing them, comments too.
- The route file never leaves the browser. The only request the page makes is `/api/window` with `lat` and `lon` at 2
  decimals plus `avail`, `dark`, `rain` and `slots=1`. Nothing from the file goes into storage or the URL.
- Settings (pace, duration, Allow dark, Rain %, Hours) live in `localStorage` only, always in try/catch; the page works
  without it.
- The service worker has one job: catch `POST /share-target` (a route shared from Android's share sheet), put the file
  in the Cache API for the page to read once, and redirect to `/` without a network request. It never calls `fetch`
  and answers nothing else.
- nginx has a `/share-target` location for when the worker isn't there: `client_max_body_size 0` (nginx checks the size
  before `return`, so the default would answer 413), `return 303 /?share=failed`, never proxied, so the body never
  reaches Node. Express has no body parser and must not get one. It is the only location without `proxy_pass`.
- A new public path goes in both `LOGGABLE_PATHS` (`middleware/logging.js`) and the nginx `$run_window_path` map;
  `tests/deployConfig.test.js` checks they match.
- Release order: the manifest's `share_target` entry needs the nginx change live on the host, because without it a
  share would POST the file to Node. The maintainer applies nginx by hand and reloads it after `nginx -t`.
- The shared file sits in the Cache API until the page opens it, then is deleted. Over 5 MB the worker redirects to
  `/?share=too-large`; any other failure is `/?share=failed` (also what nginx answers).
- Known noise: Chrome logs CSP `style-src` errors when it parses a malformed XML file (its `parsererror` element
  carries inline styles). Harmless: the page shows a plain message.

## TRMNL transform script

`transform.js` runs in TRMNL's Node runtime after each poll. It fetches Tredict with the token from the password field
(sent to tredict.com only, never to `run.xadi.eu`) and returns screen-ready merge variables. Constraints:

- Built-ins only (`fetch`, `AbortSignal`, `Intl`, `URLSearchParams`). No `require` in the built file, no npm packages.
  In `src/`, modules use only `const { a } = require('./other');` and one `module.exports = { ... };`.
- `run` never throws and finishes within 5 s: Tredict is called one request at a time (Tredict's condition) within a 4 s
  shared deadline, each call with a timeout of at most 3 s, and the sequence stops and pauses on HTTP 429. A throw makes
  TRMNL keep the old screen.
- No `console.*`, and outputs carry fixed strings only, never an `error.message`: TRMNL logs what a script prints and
  the input holds the token.
- `Intl` has English locale data only: format with `en-US` and take day names and decimals from the plugin's own
  tables.
- Output never holds a raw Tredict response, a token or an activity `summary` (it holds start coordinates). Between
  runs it carries only screen-ready fields plus `intensityCache` (activity ids with their low, moderate and high
  heart-rate seconds) and the two retry times.
  Real Tredict responses go only in the gitignored `tests/fixtures/private/`.
