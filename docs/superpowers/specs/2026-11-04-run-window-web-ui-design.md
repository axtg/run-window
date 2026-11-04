# Run-window web interface

Date: 2026-11-04
Status: draft, awaiting the maintainer's approval (builder check done)
Builds on: `2026-11-02-run-window-api-design.md` (the API), live at `https://run.xadi.eu`

## Intent

The moment: the maintainer is on their phone somewhere new (at work, say), looking for a route that fits that day's
training. Today they open Trail Router (Android), use the current location and a length, and it maps a route. The
training plan sets the length (10 km planned → 10 km route) and ideally the climb (an easy run → no dunes). They rarely
check the weather, but know it matters. Route and weather in one overview is the point.

The page answers "when should I run this route today, and which way round?" in a glance, and shows the data behind it
on request. It is for the maintainer first and open to like-minded people: public on GitHub and listed as an "open
project" on the maintainer's own page, like dap.xadi.eu. Then it's done.

## Goals

- Open a route file (GPX or KML), or use the current location plus a duration, and see the day as one colour strip
  with the best window outlined.
- A three-line overview that needs no interpreting: when to go, which way to run first, distance and climb.
- The "why" folded away underneath, for when they want it.
- Open a route straight from Trail Router's Android share sheet.
- A link to the same answer from the API, for reuse.

## Non-goals

- Making or changing routes. The page reads a route; Trail Router (or anything else) makes it.
- Reading Trail Router share links. Checked and rejected: the short link redirects to `trailrouter.com/#wps=lat,lon|...`
  (waypoints only, no geometry), a browser can't read a cross-origin redirect's target, and there is no public API.
  Files only.
- Elevation from any service. Climb comes from the file or isn't shown.
- Tredict, accounts, tokens, training data. The page knows nothing about the plan; the user brings the route and pace.
- An MCP server, and weather analysis after the run (Tredict already records weather per activity). Both dropped.
- Offline use, caching API responses, push notifications.
- Languages other than English on the page.

## Anti-goals

These count as failure even if everything else works:

- The route file, or any point of it other than the start rounded to 2 decimals, leaves the browser. That includes the
  share sheet: see "Share target", where the default browser behaviour would upload the file.
- Exact coordinates leave the browser, or reach a log. Location is rounded to 2 decimals before any request.
- `/api/window` without `slots=1` changes in any way. The TRMNL board depends on it.
- Third-party requests from the page: no CDN, analytics, fonts or map tiles.
- A climb figure invented by GPS/elevation noise on a flat route.

## Decided by the maintainer

- **Input:** a route file only (GPX or KML), read in the browser; never uploaded, stored or logged. Or location plus a
  duration without a route.
- **Layout:** the `day-view-v2` mockup (reproduced in words below): strip, three-line overview, folded "Why this time",
  "Copy API link". Their words: the strip "is insights, no thinking needed", the chart "shows the data behind it, but
  still needs you to interpret the so what", hence strip plus overview first and the chart folded.
- **Chips:** duration (from the route's distance at the user's pace), "Allow dark" off by default, max rain %.
- **API data for the strip:** an opt-in `slots=1` parameter on `/api/window`. Without it, the response is unchanged.
- **Pace:** one pace, remembered on the device only. Run time = distance × pace. For an interval session the user
  types an average pace for that run.
- **Climb:** from the file's elevation when present, nothing otherwise. Trail Router's GPX export (GraphHopper) has an
  `<ele>` on every track point, so it works for the main source.
- **Share sheet:** Trail Router's Android app shares the GPX file itself (not a link), so the page registers as a share
  target for route files.

## The page

One page at `/`. The tool comes first; the existing API documentation, capacity and privacy text follow below it, as on
dap.xadi.eu (design call: keeps one URL to list, and the landing tests' privacy checks keep applying).

### Top to bottom

1. **Title and source:** "Run window", then the route's name (from the file's `<name>`, else the file name) or "Near
   you", and "Today" / "Tomorrow" as a two-way toggle (design call: the API returns both, and the evening question is
   often about tomorrow; default Today).
2. **Input:** a file picker ("Open route", accepts `.gpx,.kml` and the matching MIME types) and "Use my location". A
   route opened from the share sheet arrives here too.
3. **Chips:**
   - Duration: `10.2 km · 65 min` with a route, or just the duration without one. Tap to edit pace (mm:ss per km,
     remembered) or set a one-off duration for this run (not remembered). Without a route, the duration is set
     directly (remembered).
   - Allow dark: off by default (`dark=avoid`), remembered.
   - Rain ≤ N %: default 40, remembered.
   - Hours: the hours they can run, default `06-22` (the API's default), remembered. Confirmed by the maintainer.
4. **Day strip:** the whole `avail` span of the chosen day, one cell per 15-minute slot, ticks every 3 hours.
   - Usable slots shade from light to dark green, darker = better, scaled to that day's own best and worst usable slot
     (so tuning the API's scores never breaks the page).
   - Excluded slots: grey for dark, past and missing data; muted red for rain over the limit.
   - The best window for the chosen duration is outlined.
   - Tapping a slot shows its time, feels-like, wind and rain % in one line under the strip. Exploring only: it does not
     move the outline.
5. **Overview,** three lines:
   - `Go 13:15–14:20 · dry · 7 °C`: the window's start plus the run's own time (a 65-minute run uses the API's 75-minute
     key, but shows 13:15–14:20), "dry" or the max rain %, and the window's average feels-like.
   - Which way first (see "Wind").
   - `10.2 km · +45 m` (distance and climb; climb left out when the file has no elevation; the line is left out
     without a route).
6. **▸ Why this time,** folded by default. Unfolded: a small chart over the same span with feels-like (line), wind
   (dashed line) and rain % (bars), the window shaded, dark hours shaded; then one sentence built from the data, e.g.
   "Warmest and least windy part of the day. Rain from 18:00, dark from 17:08." Inline SVG drawn by the page's own
   script; no chart library.
7. **Copy API link:** copies the `/api/window` URL for the current location (2 decimals) and chips, without `slots=1`.

### When there is no good answer

- No dry window of the chosen length: the overview says "No dry window of 65 min today" and the strip shows why. For a
  run whose key is `"60"` (46–60 minutes) the API's `fallback` exists; show it as "Least bad: 13:00–14:00 · 60 % rain" with the outline dashed.
  For other lengths there is no fallback; the page does not invent one.
- Over 180 minutes: use the API's `"180"` key and say the run doesn't fully fit ("Best 3 h: ..."), as the API spec
  advises clients.
- API errors: 400 shows the API's message (it names the parameter); 503 at capacity says so and when to retry (from
  `Retry-After`); anything else a fixed "Weather unavailable, try again later". `warnings: ["stale_data"]` shows a small
  "Weather from up to 3 hours ago".
- Geolocation refused or unavailable: say so; the file picker still works.

### Location

- With a route: the route's first point, rounded to 2 decimals. No geolocation prompt.
- Without: browser geolocation, rounded to 2 decimals before the request.
- The page never sends more than `lat`, `lon` (2 decimals), `avail`, `dark`, `rain` and `slots=1`.

### Wind: which way first

The API gives `windFromCardinal` for the window (the direction the wind comes from).

- **Loop or out-and-back:** first and last point within 200 m (design call). It's an out-and-back when the route
  retraces itself: at least 80 % of the second half's points lie within 30 m of a first-half point (design call).
- **Loop:** compare the route's direction of travel over its first
  quarter with the wind. If the file's direction starts into the wind (bearing within 90° of `windFrom`), say "As drawn:
  into the E wind first"; otherwise "Reverse it: into the E wind first". Design call: "as drawn / reverse" instead of
  clockwise/counter-clockwise, because a loop's shape (figure-eights, lollipops) makes clockwise ambiguous.
- **Out and back** or **no route:** "Start into the E wind".
- **Point to point:** "Wind from E" and whether it's a head or tail wind overall (bearing start→end vs `windFrom`).
- Calm (`windAvg` < 10 km/h, design call): "Little wind". The line stays so the layout doesn't jump.

### Reading route files (in the browser)

- **GPX:** `trkpt` points (all `trkseg`s in order), else `rtept`. `lat`/`lon` attributes, optional `<ele>`. `<time>` is
  ignored: in Trail Router's export these are routing estimates, not the runner's pace. Name from `trk/name` or
  `metadata/name`.
- **KML:** `LineString/coordinates` (and `gx:Track` `gx:coord` if simple), in the order they appear. KML is
  `lon,lat[,alt]`, space-separated. Altitude counts as elevation only if every point has one.
- Parse with `DOMParser`; no library. Reject files over 5 MB, files with fewer than 2 points, and anything unparsable,
  with a plain message.
- **Distance:** sum of haversine distances between consecutive points, shown to 0.1 km.
- **Climb:** sum of rises after smoothing, so noise doesn't count. Design call: hysteresis with a 3 m threshold (count a
  rise only once the elevation is 3 m above the last low point), rounded to 5 m; shown as `+N m`. A builder may tune the
  threshold against the fixtures, keeping "a flat route reads +0 m".
- Nothing from the file is stored: not in `localStorage`, not in the URL. Reloading the page forgets the route.

### Remembered on the device

`localStorage`, wrapped in try/catch, the page working when it's unavailable: pace (default 6:00/km, design call),
duration without a route (default 60 min), Allow dark, Rain %, Hours. Never the route or the location.

## API addition: `slots=1`

`GET /api/window?...&slots=1` adds a `slots` array to each entry of `days`. Without the parameter (or with it empty),
the response is byte-for-byte what it is today; a route test asserts this against the current output.

- Valid values: `1` or empty (empty = off, as with the other parameters). Anything else is a 400 naming `slots`.
- One entry per 15-minute slot of the local day that fits entirely inside an `avail` range, the same rule as
  `buildDaySlots` (`minuteOfDay + 15 <= endMin`), so every listed slot could be part of a window. The strip shows only
  the hours the person can run. Uses the same DST-safe walk over UTC quarters as `buildDaySlots`.
- Each slot:

  ```json
  {
    "start": "2026-11-02T12:15:00.000Z",
    "status": "ok",
    "score": 3.2,
    "apparentTemp": 7.1,
    "windSpeed": 14,
    "gust": 28,
    "windFrom": 225,
    "precipProb": 15,
    "precip": 0.0,
    "inDaylight": true
  }
  ```

  - `status`: `ok`, or the first exclusion that applies, in this order: `past`, `dark` (only with `dark=avoid`),
    `missing`, `rain`. `past` only appears today.
  - Weather values and `score` (from `scoreSlot`, rounded to 1 decimal) are present for every slot that has data,
    including excluded ones: the folded chart needs the whole span. `missing` slots have `null` values and score.
  - Values come from the same rows as today (`valuesForSlot`), same rounding as window objects.
- `computeDay`'s existing output is unchanged and `pickWindow` still sees only usable slots. Implementation shape is the
  builder's: e.g. one walk that tags each slot with a reason, with the current exclusion filter derived from it, so the
  two can't disagree.
- Same cache, same upstream calls, same limits: `slots` is applied per request to cached weather.
- `docs/openapi.yaml` gets the parameter and the slot schema; `npm run validate-api` passes.
- Size: up to 64 slots per day at the default `06-22`; fine for a phone, and TRMNL never asks for it.

The other session (TRMNL board work) was told about this shape on 2026-11-04.

## Share target (Android)

The page is installable (a web app manifest plus a service worker) and lists itself in the share sheet for route files.

- Manifest `share_target`: `action` a fixed path (e.g. `/share-target`), `method: POST`, `enctype:
  multipart/form-data`, `params.files` accepting `application/gpx+xml`, `application/vnd.google-earth.kml+xml`,
  `application/xml`, `text/xml`, `application/octet-stream` and the extensions `.gpx`, `.kml` (Android often sends
  route files as `octet-stream`). Check each file's extension or content in the page; reject anything else.
- **The privacy trap:** a share target with files is a POST of the file to our own origin. Only the service worker
  stops that from being an upload. So:
  - The service worker's only job is to catch `POST /share-target`, read the file from the form data, hand it to the
    page (e.g. via `postMessage` to the client it opens, or a `Cache`/`IndexedDB` entry deleted as soon as the page has
    read it), and answer with a redirect to `/` without a network request. No API caching, no other routes.
  - If a POST reaches the server anyway (worker not installed yet, or evicted): nginx answers that path itself with a
    redirect to `/` and does not proxy it, so the body never reaches Node; Express has no body parser and must not
    get one. nginx's access log uses the fixed path map, so the path appears as itself and no body is ever logged.
    `client_max_body_size` for that location stays small so nginx refuses large uploads early. The page then says
    "Open the route again" because the share didn't arrive.
  - A test proves the worker answers the share POST without calling `fetch` to the network.
- Share target only works when the page is installed (Android Chrome). Everywhere else, the file picker is the way in.
- Icons: an SVG icon plus the PNG sizes Android needs to install (192 and 512), same-origin.

## Constraints

- Repo is public. Docs and fixtures anonymised ("the maintainer"); examples use Amsterdam 52.37, 4.89; no personal
  names or places. The page itself carries no maintainer name (the landing test checks this).
- Same-origin only. External script files (`/app.js` and friends), no inline script and no inline style, so the CSP
  stays as it is (`script-src 'self'`, `style-src 'self'`, `connect-src 'self'`) and `securityHeaders.js` needs no
  hashes. Styling through Tailwind classes built into `public/tailwind.css` (`npm run build:css`; CI checks it's
  current). Strip and chart colours via classes or SVG attributes, not `style=`.
- Vanilla JS, no framework, no build step beyond Tailwind, as in eu-dayahead.
- Every new static path (`/app.js`, other scripts, `/manifest.webmanifest`, the worker, icons, `/share-target`) goes
  into `LOGGABLE_PATHS` and the nginx `$run_window_path` map; `tests/deployConfig.test.js` checks they match.
- Accessibility: the strip has a text equivalent (the overview, and each cell labelled when tapped/focused); colours
  carry a second cue (grey/red cells have a pattern or label in the tap line); keyboard-usable chips and fold.
- Works at 320 px wide without horizontal scroll; usable on a desktop too.

## Testing

- Follow eu-dayahead: pure logic in same-origin files that also export for Node
  (`if (typeof module !== 'undefined') module.exports = api; else globalThis.X = api;`), unit-tested with Jest in the
  `node` environment. DOM glue stays thin.
- Pure modules to test: GPX/KML parsing (needs a DOM parser in Node: the builder picks a dev dependency or a small
  parser; the browser uses `DOMParser`), distance, climb smoothing, loop detection and which-way-first, duration →
  API key (round up to 15; over 180), strip shading scale, the "why" sentence, the API link.
- Fixtures: synthetic GPX and KML routes around Amsterdam centre (a flat loop, a loop with a hill, an out-and-back, a
  point-to-point, one without elevation), committed. A real Trail Router export may sit in
  `tests/fixtures/private/` (git-ignored; the maintainer has one in the main checkout, not in a new worktree); tests
  that use it skip when it's absent, and `npm test` passes without it.
- API: `slots=1` route and unit tests (statuses and their order, DST days, `past` only today, `missing` with nulls,
  unchanged output without the parameter, 400 on bad values), and the OpenAPI contract.
- `tests/landing.test.js` changes on purpose:
  - flips: "no scripts" becomes "only same-origin external scripts, none inline"; the page now has an example of the
    tool, not just the API.
  - stays: no external requests, no `<style>` or `style=`, the CSP assertions (`script-src 'self';` etc. and no inline
    hashes), the privacy text, Amsterdam in the example, no maintainer names.
  - adds: privacy bullets saying the route file is read in the browser and never sent, and that the page sends the
    location rounded to 2 decimals.
- Service worker: a test with a fake `self`/`FetchEvent` that the share POST is answered without a network fetch and
  other requests pass through untouched.
- Manual check on the maintainer's Android phone before calling it done: install, share a route from Trail Router,
  see the page answer. Recorded in a short verify doc like `2026-11-03-trmnl-running-board-verify.md`.

## Release order

The maintainer pushes and deploys; nginx config is applied on the host by hand (as in the API plan's deploy step).
So the share target ships in two releases (design call):

1. Everything else, plus the nginx `/share-target` location (answers itself, never proxies; `tests/deployConfig.test.js`
   changes on purpose to allow this one non-proxied location). The maintainer applies the nginx change.
2. Only after that is live: the manifest's `share_target` entry. The plan states this as a gate, and the phone check
   (and "done") waits for the maintainer.

## Docs and housekeeping

- Privacy section of the page and of the API spec: add what the page does (file stays in the browser, location rounded,
  settings in `localStorage`, share target handled on the device).
- `readme.md` and `CLAUDE.md`: mention the web interface.
- Branch `fix/privacy-text` (commit b647e0f) also edits `public/index.html`'s privacy bullets, `tests/landing.test.js`
  and the API spec's Privacy section. The plan does the API, the route-file modules and the worker first; the
  landing-page and privacy tasks come after rebasing on `main` once it lands (design call: no cherry-pick).

## Left to the builder

- File layout under `public/`, module names, how the page and worker pass the shared file.
- Exact colours, shading steps, chart sizes, tick spacing, copy wording (within the examples above).
- The DOM parser used in tests.
- Climb threshold tuning within the rule above.

### Time zones (travel)

The maintainer asked how this behaves far from home (e.g. in Asia). Hours, "today", the strip and every time shown are
the **location's** local time, from the API's `location.timezone`, never the phone's: `06-22` means 06–22 where the
route is. The API already works this way; the page formats with `Intl.DateTimeFormat` and that `timeZone`. When the
location's zone differs from the device's, the source line adds it (e.g. "Today · Asia/Tokyo time"), so a phone still
on home time doesn't mislead. A test covers a location far from the device's zone (fixed `TZ` in Jest).
