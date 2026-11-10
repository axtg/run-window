# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Three things in one repo:

1. **Run-window API** (`besttimetorun.com`, design call): a small, stateless, anonymous Express service. Given a location and
   the hours someone can run, it returns the best weather window for each session length today and tomorrow.
   Spec: `docs/superpowers/specs/2026-11-02-run-window-api-design.md`.
2. **TRMNL "Running Board" plugin** (`integrations/trmnl-running-board/`): one full screen with this week's training
   (Tredict), a form graph (Tredict efforts) and today's run window (the API above).
   Spec: `docs/superpowers/specs/2026-11-02-trmnl-running-board-design.md`.
3. **Web interface** (`public/`, served at `/`): a page where someone opens a GPX/KML route (or uses their location)
   and sees the best window for that run on one card. It reads the file in the browser and calls the API with
   `slots=1`. Spec (current layout): `docs/superpowers/specs/2026-11-04-run-window-web-ui-redesign-design.md`; the
   first version is `docs/superpowers/specs/2026-11-04-run-window-web-ui-design.md`.

The API comes first: the plugin depends on it.

## Status

The site and API are live at `https://besttimetorun.com`, the site's name since 2026-11-06; `run.xadi.eu`
(deployed 2026-11-03) answers every path with a 301 to it. Internal names (repo, Docker service, "run window" for the
API's result) stay. The dated specs and plans under `docs/superpowers/` are records of their day and keep the old
name. The TRMNL plugin is built and tested; install steps are
in `integrations/trmnl-running-board/README.md`. The install check on the device (plan Task 12) is pending. Tredict
agreed to a public recipe (see the plugin spec, "Tredict's terms"); it was submitted on 2026-11-05 and waits on TRMNL's
review. The web interface is
live and was checked on an Android phone on 2026-11-05
(`docs/superpowers/specs/2026-11-04-run-window-web-ui-verify.md`): installed from Chrome, it is in the share sheet for
route files (`share_target`, which needs the nginx `/share-target` location on the host; see "Web interface").

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
  nginx reaches it over loopback (`trust proxy` is `loopback`). `docker/nginx-besttimetorun.com.conf` is the nginx
  site: it logs a fixed list of paths only, strips `Authorization` and `Cookie`, and allows `/health/cache` from the
  host only. www and run.xadi.eu only redirect to `https://besttimetorun.com$request_uri`.

## Web interface

`public/` holds the page (`index.html`, `app.js`) and its modules (`analytics.js`, `route.js`, `plan.js`, `strip.js`,
`settings.js`), the worker `sw.js`, the manifest and icons.

- Each module is an IIFE that exports its API with `module.exports` in Node and as a global in the browser (the
  eu-dayahead pattern). Jest tests live in `tests/web/`.
- Same-origin scripts only, plus Plausible: external `<script src="/...">` files, no inline script, `<style>`, `style=`
  attribute or `setAttribute('style', ...)`. The CSP adds only Plausible (`script-src 'self'` + its one file,
  `PLAUSIBLE_SCRIPT` in `middleware/securityHeaders.js`; `connect-src 'self' https://plausible.io`; `style-src 'self'`;
  no hashes). Styling is Tailwind classes in `public/tailwind.css`.
- Plausible (since 2026-11-06): its snippet's init lives in `analytics.js` (deferred, before `app.js`), since the CSP
  allows no inline script. Events carry names only, from the fixed list in `analytics.js` (`EVENTS`), once per page
  view: `Setting` (which setting was changed), `Dialog` (Method, API, Privacy, the network menu), `Source` (file,
  share, location), `Calendar` (`google`, `outlook` or `ics`) and `Network` (which site in the menu). Never a value, a coordinate or anything from the route.
  Blocked Plausible changes nothing. Each event needs a goal in the Plausible dashboard to show up there.
- Tailwind scans only `index.html`, `app.js` and `strip.js`: run `npm run build:css` after editing them, comments too.
- The route file never leaves the browser. The page makes two requests to its own server: `/api/window` with `lat`
  and `lon` at 2 decimals plus `avail`, `dark`, `rain`, `prefer` and `slots=1`, and `/api/capacity` with nothing (on
  load, and again after a 503); the only other is Plausible's. Nothing
  from the file goes into storage, the URL or analytics.
- The page is one card with slim settings rows:
  - Run, on one line down to 360 px: the duration stepper (without a route) or the route's distance, then the average
    pace as one typed field, `at [6:25] /km` (no steppers, no range: a range was tried on 2026-11-10 and was too many
    fields). Without a route the pace gives the answer's last number, `Plan 7.0 km` (`Plan.planDistance`, also in the
    calendar description); with a route it gives `= 66 min` at the end of the line.
  - No time-zone note: times are the location's own, unlabelled (a "Europe/Amsterdam time" note next to Today /
    Tomorrow was removed on 2026-11-10).
  - The route name sits next to the ✕ on one line (cut short with `…`, full name in `title`), without its distance.
  - With a location, "Near you" (`#source-map`) links to OpenStreetMap at the rounded coordinates (new tab,
    `noreferrer`; a link only, nothing loads from there unless tapped). When the browser's accuracy is worse than
    5 km (an IP guess), `#source-rough` adds `· rough, ±70 km`. The accuracy stays in memory, never in a request.
  - Hours: sliders with a night hatch. A round `+` (`#add-hours`, "Add hours") ends the last row; the other rows end
    in a spacer as wide, so the sliders line up.
  - Dark: the dark times and an OK switch (`#dark-ok`, `role="switch"`).
  - Mind most: Balanced · Wind · Rain · Temp (`#prefer-*`, `aria-pressed`, like Today / Tomorrow), with a line under
    it saying what the choice trades (`Plan.preferHint`). Sends `prefer`; the chosen term counts 3× in the score, and with Wind, wind counts from 8 km/h instead of 12
    (`SCORING.wind.preferComfortableSpeed`), so a calm, colder hour can beat a 12 km/h one. It is
    relative on purpose: no level or threshold, because the day's forecast decides what is possible. The score's
    comfort bands (wind under 12 km/h, feels-like 6–16 °C) give many windows a score of 0, so on a tie the chosen
    term's raw value decides (`TIE_BREAKS` in `lib/windows.js`: wind speed, chance of rain, distance from 11 °C), then
    the earliest. Balanced keeps the earliest. On a phone the
    four options wrap under the label below about 360 px.
  - Rain: a slider.
- Under the settings is a big answer with key numbers: Sky, Feels and Wind (Feels and Wind with a context word such as
  `ideal` or `light`, in a light pill next to the label, so the numbers take one line), then Climb (with a route) or
  Plan (the distance at the pace; the minutes are already in "Best time · 45 min").
  - From `sm:` up, the numbers sit to the right of the time in a 2 × 2 grid (four across doesn't fit the card). On a
    phone they sit under it.
  - The wind line is in words (`Wind from the east · start east, into it`), with a compass whose arrow shows where the
    wind blows to, as on a weather map, so you start running against the arrow. In little wind (under 10 km/h) the
    line and compass are hidden: the Wind pill already says `light` or `calm`. The calendar description keeps
    `Little wind`.
  - When today has no window and tomorrow has one, a `Try tomorrow →` button shows what tomorrow holds.
  - A calendar-plus button (`#add-calendar`) after the time adds the run to a calendar (`Plan.calendarEvent`): title
    like `Sunday afternoon 10.4 km run` (or `60 min`), the conditions and wind line as description. Never the location
    or the route's name. It opens `#calendar-menu` (a dropdown like the others): Google Calendar and Outlook.com links
    (`Plan.googleCalendarUrl`, `Plan.outlookCalendarUrl`, new tab, `noopener noreferrer`, refreshed on each render)
    and Calendar file (.ics), which downloads `run.ics` built in the page (`Plan.icsText`, folded at 75 octets).
    An Android `intent:` URL was tried first (2026-11-07) and doesn't work: Chrome marks web intents browsable and
    the calendar's new-event screen doesn't accept them.
- The page's tint: `<body data-sky="…">`, set by `Plan.skyTheme` from the shown window (wet, then dark, windy, cold,
  warm, else mild) or, without one, the device's hour (morning before 12, else evening). CSS can't animate one
  gradient into another, so two layers behind the page (`#sky-a`, `#sky-b`, `-z-10` in a `relative` body) carry the
  `data-[sky=…]:bg-[linear-gradient(…)]` variants and cross-fade in 700 ms (`data-shown`; none with reduced motion);
  `tests/web/plan.test.js` checks every name has a variant. The
  card stays white. The header sits on milky glass (`bg-white/55 backdrop-blur-md`, `z-20` so its menus stay above
  the card).
- Under the header, `#quota-bar` (an SVG; `Plan.quotaBar`) shows today's new places left from `/api/capacity`: a
  rainbow fixed to the full width, so it shortens from the right; paler (opacity and an SVG saturate filter) as it
  shrinks, amber under 10 %, gone when full. Always shown; any failure leaves it out. app.js sets its `fill` and
  `filter`, as `tests/landing.test.js` allows no `url(` in index.html.
- Below the answer: one timeline joining strip and graph, then one row with the legend (`#chart-legend`: feels, wind,
  rain, dark; no units, the chart has no axis values) and the hint, then the why line. A selected slot's line names
  its own values and takes the row: the legend hides until nothing is selected.
- The source buttons are Route (upload icon) and Location (pin icon), inline SVGs in `currentColor`, so they sit on the
  Today / Tomorrow line down to a card about 320 px wide (a 376 px screen); padding there is tight on purpose.
- `#status` (Checking the weather…, Finding your location…, errors) is centred. When neither the prompt nor an answer
  shows, it takes the prompt's place and padding (`[#prompt[hidden]+#answer[hidden]+&]:py-6`).
- The hint (`Tap a slot.`) names the arrow keys only where the screen can hover (`(hover: none)` drops them).
- The why line is empty (and hidden) when nothing stands out and no rain or dark follows; no "similar all day".
  "Warmer" and "less windy" need a clear lead on the other dry slots' average; they say "than the rest of the day"
  only when no other dry slot is warmer (or calmer), else "than most of the day".
- The header's 3×3 dot icon (`#open-network`, "More by Xander") opens `#network-menu`, a dropdown with the maintainer's
  other sites and Buy me a coffee (new tab, `noopener noreferrer`). A press outside, Escape (focus back on the icon) or
  tabbing out closes it. It is the only place on the page that names the maintainer; `tests/landing.test.js` checks.
- Method, API and Privacy open in `<dialog>`s from the header. On a phone (below `sm:`) they fold into `About ▾`
  (`#open-about`, `#about-menu`), a dropdown that closes like the network menu, so the header stays on one line. From
  `sm:` up the same buttons show as header links; `#about-menu` then keeps its `hidden` attribute, overridden by
  `sm:[&[hidden]]:flex`. Opening About is not counted. Method explains the scoring in words;
  `tests/landing.test.js` checks its numbers against `SCORING` in `lib/windows.js`, so change both together. Copy API link confirms on the button itself (`Copied` or
  `Couldn't copy` for 2 s, announced by a hidden polite note), not in `#status`.
- Default hours are `10-16`; there is no one-off duration.
- Changing pace or duration re-renders from the data already fetched, without a new request; hours, Dark OK, Mind
  most and rain change the request.
- SVG elements have no `hidden` property: show or hide them with `toggleAttribute('hidden', …)`. The smoke test's fake
  DOM follows the browser here.
- Settings (pace, duration, Allow dark, Mind most, Rain %, Hours) live in `localStorage` only, always in try/catch; the
  page works without it. A stored `windMatters: true` (the first, one-day version) loads as `prefer: 'wind'`.
- The service worker has one job: catch `POST /share-target` (a route shared from Android's share sheet), put the file
  in the Cache API for the page to read once, and redirect to `/` without a network request. It never calls `fetch`
  and answers nothing else.
- nginx has a `/share-target` location for when the worker isn't there: `client_max_body_size 0` (nginx checks the size
  before `return`, so the default would answer 413), `return 303 /?share=failed`, never proxied, so the body never
  reaches Node. Express has no body parser and must not get one. It is the only location without `proxy_pass`.
- `/api/capacity` (`routes/capacity.js`, `weatherCache.capacity`): `perDay`, `remainingShare`, `full`, `asOf`,
  `resetsAt`. A live count would show whether a location was requested today (ask for it, watch the count; the reason
  `/health/cache` is host-only), so the share is taken once an hour and rounded down to 5 % steps (at least 0.05 until
  full). `full` is live, as the 503 already tells. The page's bar reads it, and so does the TRMNL plugin: its window
  retry asks `/api/capacity` alongside (never after, so no extra time), and a 503 with `full` shows "Full for today"
  instead of "Weather unavailable".
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
(sent to tredict.com only, never to `besttimetorun.com`) and returns screen-ready merge variables. Constraints:

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
