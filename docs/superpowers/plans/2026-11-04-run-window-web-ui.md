# Run-window Web Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-first page at `run.xadi.eu/` that reads a GPX/KML route (or uses the location plus a duration) in the
browser and shows the day's run-window strip, a three-line overview and a folded "why", backed by an opt-in
`slots=1` addition to `/api/window`, and installable as an Android share target for route files.

**Architecture:** The API gains a per-slot listing (`lib/windows.js` tags every slot of the `avail` span with a status;
`computeDay` adds `slots` only when asked). The page is vanilla same-origin JS: pure modules in `public/` (`route.js`,
`plan.js`, `strip.js`, `settings.js`) that also export for Node and are unit-tested with Jest, plus thin DOM glue in
`public/app.js`. A service worker (`public/sw.js`) does one thing: catch the share POST and hand the file to the page
through the Cache API, never the network. nginx answers `/share-target` itself so a share can't reach Node.

**Tech Stack:** Node >= 22, Express 4, Jest + supertest, vanilla browser JS, Tailwind 3.4 (built CSS), inline SVG,
Web App Manifest + Service Worker, `@xmldom/xmldom` (dev only, for parsing tests).

**Spec:** `docs/superpowers/specs/2026-11-04-run-window-web-ui-design.md` (approved 2026-11-04). Also read
`CLAUDE.md` and the API spec `docs/superpowers/specs/2026-11-02-run-window-api-design.md`.

## Global Constraints

- CommonJS, ESLint + Prettier: single quotes, semicolons, 2-space indent, no trailing commas, max 120 cols. Every task
  ends with `npm run lint && npm run format:check && npm test` passing.
- `/api/window` without `slots=1` (or with `slots=` empty) stays byte-for-byte unchanged. The TRMNL board depends on it.
- Same-origin only: no CDN, analytics, fonts, map tiles. External `<script src="/...">` only; no inline script, no
  `<style>`, no `style=` attribute, no `setAttribute('style', …)`. CSP stays `script-src 'self'`, `style-src 'self'`,
  `connect-src 'self'`, no hashes.
- The route file never leaves the browser. The only request the page makes carries `lat`, `lon` (2 decimals), `avail`,
  `dark`, `rain`, `slots=1`. Nothing from the file goes into `localStorage` or the URL.
- `localStorage` access is always wrapped in try/catch; the page works without it.
- All times shown are the location's local time (`location.timezone` from the API), via `Intl.DateTimeFormat` with
  `timeZone`. Never the device's zone.
- Every new public path is in `LOGGABLE_PATHS` (`middleware/logging.js`) and in the nginx `$run_window_path` map
  (`docker/nginx-run.xadi.eu.conf`); `tests/deployConfig.test.js` checks they match.
- Public repo: fixtures are synthetic routes around Amsterdam centre (52.37, 4.89). No names or places tied to the
  maintainer. `tests/fixtures/private/` is optional and git-ignored; tests using it skip when it's absent.
- Page copy is English. Units: km, m, km/h, °C, %, `m:ss` per km.
- Modules in `public/` follow eu-dayahead's pattern: an IIFE ending in
  `if (typeof module !== 'undefined') module.exports = api; else globalThis.<Name> = api;`.
- After each task commit, wait for its roborev job and fix or answer its findings before the next task.

## Review Focus

1. **`localStorage` throws or holds junk** (private mode, an old version's JSON): the page loads with defaults and
   never crashes. Test in Task 6.
2. **Late evening "today"**: every remaining slot is `past` (or none left at all), so there's no window; the overview
   says "No dry window of N min today" and Tomorrow still works. Tests in Tasks 1 and 4.
3. **Odd route files**: a GPX with only `<wpt>`s, an empty `<trkseg>`, several `trkseg`s, both `trk` and `rte`, a KML
   whose altitudes are all `0`, a text file renamed `.gpx`. Each gives a plain message or a sensible route, never a
   throw. Tests in Task 3.
4. **Bad pace input** (`abc`, `0:00`, `6:75`, `25:00`): rejected, the previous pace kept. Test in Task 4.
5. **API failures**: 400 shows the API's message, 503 with `Retry-After` says when to retry, a network error or 500
   gives "Weather unavailable, try again later." Test in Task 4.

---

## Before Task 1: workspace

- [ ] Work in the worktree `/home/xander/webapps/run-window-site` on branch `feat/web-ui`. Never check out branches in
  `/home/xander/webapps/run-window`: another session works there.
- [ ] `git rebase main` (main moved after the branch was cut), then `npm ci`.
- [ ] Optional: copy `../run-window/tests/fixtures/private/trailrouter-loop.gpx` into this worktree's
  `tests/fixtures/private/` (git-ignored). Never print its coordinates.
- [ ] Check roborev's post-commit hook fires here (`roborev` status after the first commit).
- [ ] **Pin today's response** before any code changes: a one-off script (scratchpad, not committed) requests
  `/api/window?lat=52.37&lon=4.89&avail=07-09,12-14,17-21` from `createApp` with the Amsterdam fixture and
  `now: () => Date.UTC(2026, 10, 2, 9)` and writes the response text to `tests/fixtures/window-response-amsterdam.json`;
  the same with the wet forecast from `window.route.test.js` (fallback present) to
  `window-response-amsterdam-wet.json`. Add `without slots the response is byte-for-byte the golden one` to
  `tests/window.route.test.js` (`response.text` equals each file's text). Commit
  `test(api): pin the current /api/window response`. It stays green through Tasks 1 and 2.

---

### Task 1: Tag every slot of the day with a status

**Files:**
- Modify: `lib/windows.js`
- Test: `tests/windows.slots.test.js` (new); `tests/windows.day.test.js` and `tests/weatherCache.test.js` must pass
  unchanged.

**Interfaces:**
- Produces:
  - `tagDaySlots({ date, forecast, avail, dark, rain, nowMs }) → Array<{ startMs, rangeIndex, values|null, inDaylight,
    status }>`: every 15-minute slot of the local date that fits entirely inside an `avail` range
    (`startMin <= minuteOfDay && minuteOfDay + 15 <= endMin`, as now), sorted by start, same DST-safe UTC-quarter
    walk. `status` is the first that applies of `'past'` (start < now rounded up to the quarter), `'dark'` (only when
    `dark === 'avoid'` and not entirely between sunrise and sunset), `'missing'` (`valuesForSlot` null), `'rain'`
    (`!isDry(values, rain)`), else `'ok'`.
  - `buildDaySlots(...)`: same signature and output as today, now derived from `tagDaySlots` (keep statuses `ok` and
    `rain`, drop `status` from the objects so existing deep-equal tests hold).
  - `serializeSlot(slot) → { start, status, score, apparentTemp, windSpeed, gust, windFrom, precipProb, precip,
    inDaylight }`: `start` ISO; with values: `score` = `round(scoreSlot(values), 1)`, `apparentTemp` 1 decimal,
    `windSpeed`/`gust`/`windFrom`/`precipProb` integers, `precip` 1 decimal; `missing` → all six weather fields and
    `score` `null`.
  - `computeDay({ date, forecast, params, nowMs, includeSlots = false })`: unchanged output when `includeSlots` is
    false; when true, adds `slots: tagDaySlots(...).map(serializeSlot)` as the last key.

- [ ] **Step 1: Write the failing tests** in `tests/windows.slots.test.js`, using `makeForecastJson` from
  `tests/helpers/forecast.js`:
  - `lists only slots that fit inside avail`: `avail` `07-09:10` → 8 slots, last starts 08:45 local; none at 09:00.
  - `status order is past, dark, missing, rain`: a slot that is both past and wet is `past`; dark and wet → `dark`;
    a wet slot whose row is null → `missing`; wet only → `rain`; otherwise `ok`.
  - `dark is a status only with dark=avoid`: same day with `dark: 'ok'` has no `dark` statuses and `inDaylight` false
    on night slots.
  - `past only appears today`: tomorrow's slots never have `past`.
  - `late evening leaves only past slots`: `nowMs` 21:50 local, `avail` `06-22` → every slot `past`;
    `computeDay(...).windows['30']` is `null` (Review Focus 2).
  - `missing slots have null values and score`.
  - `DST days`: on `2026-10-25` (Europe/Amsterdam, use `tests/fixtures/open-meteo/amsterdam-dst-end.json` or the
    helper) with `avail` `00-24`, `dark: 'ok'` → 100 slots; on `2027-03-28` → 92.
  - `buildDaySlots equals the ok and rain slots of tagDaySlots` for the Amsterdam fixture at `NOW`
    (`Date.UTC(2026, 10, 2, 9)`), `avail` `07-09,12-14,17-21`.
  - `computeDay adds slots only when asked`: `Object.keys` without `includeSlots` has no `slots`; with it, `slots` is
    the last key and its `ok` slots' scores match `scoreSlot`.

- [ ] **Step 2: Run** `npx jest tests/windows.slots.test.js` — Expected: FAIL (`tagDaySlots is not a function`).

- [ ] **Step 3: Implement** `tagDaySlots`, `serializeSlot` and the `includeSlots` option in `lib/windows.js`; rewrite
  `buildDaySlots` on top of `tagDaySlots`. Export both new functions.

- [ ] **Step 4: Run** `npx jest tests/windows.slots.test.js tests/windows.day.test.js tests/windows.pick.test.js
  tests/weatherCache.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): tag every slot of the day with a status`

---

### Task 2: `slots=1` on `/api/window`

**Files:**
- Modify: `lib/params.js`, `routes/window.js`, `docs/openapi.yaml`, `readme.md` (one line on `slots=1` is optional;
  the page's API section is Task 7)
- Test: `tests/params.test.js`, `tests/window.route.test.js`, `tests/openapi.test.js`

**Interfaces:**
- Consumes: `computeDay({ ..., includeSlots })` from Task 1.
- Produces: `parseWindowQuery(query)` also returns `slots: boolean` (`'1'` → true; absent or `''` → false; anything
  else → 400 `Invalid slots: must be 1 or empty`). The response's `params` object is unchanged (no `slots` key).
  With `slots=1`, each `days[i]` has `slots: Slot[]` as its last key (shape from Task 1's `serializeSlot`).

- [ ] **Step 1: Write the failing tests** (the golden files come from "Before Task 1"):
  - `params.test.js`: `slots` `'1'` → true, absent/`''` → false, `'true'`, `'0'`, `['1','1']` → 400 whose message
    contains `slots` and not the value.
  - `window.route.test.js`:
    - the golden test also holds with `&slots=` (empty).
    - `slots=1 adds slots to both days and nothing else`: removing `slots` from each day gives the golden body;
      `params` has no `slots`; each day's last key is `slots`.
    - `slots=1 on the default avail lists 64 slots tomorrow`.
    - `slots=1 with a bad value is 400`.
  - `openapi.test.js`: a `slots=1` response validates against the schema (follow the file's existing validation
    helper), and the `slots` parameter is documented.

- [ ] **Step 2: Run** `npx jest tests/params.test.js tests/window.route.test.js tests/openapi.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement:** `parseSlots` in `lib/params.js`; pass `includeSlots: query.slots` in `routes/window.js`;
  in `docs/openapi.yaml` add the `slots` parameter (`type: string, enum: ['1']`, description: "`1` adds a `slots`
  list to each day: every 15-minute slot inside `avail`, with its status and weather. For drawing the day; the
  windows are unchanged.") and a `Slot` schema (`status` enum `ok, past, dark, missing, rain`; nullable numbers) and
  optional `WindowDay.slots`.

- [ ] **Step 4: Run** `npx jest && npm run validate-api` — Expected: PASS, "✅ OpenAPI spec is valid".

- [ ] **Step 5: Commit** `feat(api): opt-in slots=1 lists the day's slots`. Then message the other session
  (`run-window-2d`, via SendMessage/ListAgents) one line: "slots=1 is on feat/web-ui; default response proven
  unchanged by a golden test."

---

### Task 3: Reading route files (`public/route.js`)

**Files:**
- Create: `public/route.js`, `tests/web/route.test.js`, `tests/fixtures/routes/` with synthetic files:
  `flat-loop.gpx`, `hill-loop.gpx`, `out-and-back.gpx`, `point-to-point.gpx`, `no-elevation.gpx`, `two-segments.gpx`,
  `waypoints-only.gpx`, `trk-and-rte.gpx`, `loop.kml`, `zero-alt.kml`, `not-xml.gpx`
  (all around 52.37, 4.89; a few dozen points each; written by hand or by a committed `scripts/make-route-fixtures.js`)
- Modify: `package.json` (devDependency `@xmldom/xmldom`), `eslint.config.js` (public block: `module: 'readonly'`, `require: 'readonly'`)

**Interfaces:**
- Produces `globalThis.RouteFile` / `module.exports`:
  - `parseRoute(text: string, fileName: string, DOMParserImpl) → { ok: true, route: { name, points: [{ lat, lon, ele
    }], hasElevation } } | { ok: false, reason: 'too-large' | 'unreadable' | 'too-few-points' }`. `too-large` when
    `text.length > 5 * 1024 * 1024`. Parse with `new DOMParserImpl().parseFromString(text, 'application/xml')` inside
    try/catch; a `parsererror` element also means `unreadable`. Use only `getElementsByTagName`, `getAttribute`,
    `textContent` (works in browsers and xmldom).
    - GPX: all `trkpt` in document order; if none, `rtept`. `ele` from `<ele>` (number) else `null`. `<time>` ignored.
      Name: first `trk` > `name`, else `metadata` > `name`, else `fileName` without extension.
    - KML: every `coordinates` element inside a `LineString` (`lon,lat[,alt]` tuples separated by whitespace), else
      `gx:coord` (`lon lat alt`). Name: first `Placemark` > `name`, else `Document` > `name`, else file name.
    - `hasElevation`: every point has a finite `ele`, and (KML) not all of them are `0`.
    - Fewer than 2 points → `too-few-points`.
  - `haversineM(a, b) → number` (R = 6371000 m); `bearingDeg(a, b) → 0..360`.
  - `distanceKm(points) → number` (sum of haversine, unrounded).
  - `climbM(points) → number` (dead-band smoothing, threshold `CLIMB_THRESHOLD_M = 3`, result rounded to the nearest
    5):
    ```js
    let gain = 0, ref = points[0].ele;
    for (const { ele } of points) {
      if (ele - ref >= CLIMB_THRESHOLD_M) { gain += ele - ref; ref = ele; }
      else if (ref - ele >= CLIMB_THRESHOLD_M) ref = ele;
    }
    ```
  - `routeShape(points) → 'loop' | 'out-and-back' | 'point-to-point'`: first/last within `LOOP_CLOSE_M = 200` → loop
    or out-and-back; out-and-back when ≥ 80 % of the second half's points lie within `RETRACE_M = 30` of some
    first-half point. Resample to points ≥ 20 m apart first so the check stays cheap.
  - `summarizeRoute(route) → { name, distanceKm, climbM: number|null, shape, startBearing, overallBearing, start: {
    lat, lon } }`. `startBearing`: from the first point to the first point at ≥ 25 % of the distance.
    `overallBearing`: first to last point. `start` rounded to 2 decimals. `climbM` null without elevation.

- [ ] **Step 1: Write the failing tests** in `tests/web/route.test.js` (require `../../public/route` and
  `@xmldom/xmldom`'s `DOMParser`):
  - parses each fixture: point counts, `hasElevation`, names (`trk` name, else metadata, else file name).
  - `two segments are joined in order`; `trk wins over rte`; `waypoints only` → `too-few-points`;
    `not-xml` → `unreadable`; a 6 MB string → `too-large`; `zero-alt.kml` → `hasElevation` false.
  - `distanceKm` of a fixture with known geometry within 1 % (e.g. two points 0.01° of latitude apart ≈ 1.112 km).
  - `climbM`: flat loop with ±1 m noise → 0; hill loop with a 20 m hill → 20; result is a multiple of 5.
  - `routeShape`: each fixture gets its shape.
  - `summarizeRoute`: `start` rounded to 2 decimals; `climbM` null for `no-elevation.gpx`.
  - Private fixture, when present (`test.skip` otherwise): parses, `hasElevation` true, shape `loop`. Assertions must
    not print coordinates.

- [ ] **Step 2: Run** `npx jest tests/web/route.test.js` — Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement** `public/route.js` as an IIFE module.

- [ ] **Step 4: Run** `npx jest tests/web/route.test.js && npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): read GPX and KML routes in the browser`

---

### Task 4: Run plan and copy (`public/plan.js`)

**Files:**
- Create: `public/plan.js`, `tests/web/plan.test.js`

**Interfaces:**
- Consumes: `summarizeRoute` output shape from Task 3 (only `distanceKm`, `climbM`, `shape`, `startBearing`,
  `overallBearing`).
- Produces `globalThis.RunPlan` / `module.exports`:
  - `DRY_MAX_PROBABILITY = 20` (same rule as `lib/labels.js`: dry = `qualifies && precipProbMax <= 20`).
  - `parsePace(text) → seconds | null`: `/^\d{1,2}:\d{2}$/`, seconds < 60, total 180..900. `formatPace(sec) → 'm:ss'`.
  - `runMinutes(distanceKm, paceSec) → integer` (`Math.round(distanceKm * paceSec / 60)`).
  - `durationKey(minutes) → { key: string, fits: boolean }`: round up to 15, minimum `'15'`, over 180 → `{ key:
    '180', fits: false }`.
  - `pickResult(day, minutes) → { kind: 'window' | 'fallback' | 'none', window, key, fits }`: `fallback` when `key ===
    '60'`, `day.windows['60'] === null` and `day.fallback` is non-null.
  - `formatClock(iso, timeZone) → 'HH:mm'` (`Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute:
    '2-digit', hourCycle: 'h23' })`).
  - `goLine(result, { minutes, dayLabel: 'today' | 'tomorrow', timeZone }) → string`:
    - window, fits: `Go 13:15–14:20 · dry · 7 °C` (end = start + `minutes`; sky `dry` or `rain 35 %`; temp
      `Math.round(apparentTempAvg)`, `-0` → `0`).
    - window, not fits: `Best 3 h: 09:00–12:00 · dry · 7 °C` (end = window end).
    - fallback: `Least bad: 13:00–14:00 · 60 % rain` (dashed outline is the page's job).
    - none: `No dry window of 65 min today`.
  - `windLine(summary | null, window) → string`: `windAvg < 10` → `Little wind`; no route or out-and-back →
    `Start into the E wind`; loop → `As drawn: into the E wind first` when the angle between `startBearing` and
    `windFrom` ≤ 90°, else `Reverse it: into the E wind first`; point-to-point → `Headwind overall, wind from E` (angle
    between `overallBearing` and `windFrom` ≤ 90°) or `Tailwind overall, wind from E`. Cardinal from
    `window.windFromCardinal`.
  - `routeLine(summary | null) → string | null`: `10.2 km · +45 m`, or `10.2 km` without climb, `null` without route.
  - `zoneNote(locationTz, deviceTz, nowMs) → string | null`: `Asia/Tokyo time` when the two zones' UTC offsets differ
    at `nowMs`, else `null`.
  - `apiUrl(origin, { lat, lon, hours, allowDark, rain }, { slots = false } = {}) → string`:
    `${origin}/api/window?lat=52.37&lon=4.89&avail=06-22&dark=avoid&rain=40` (+ `&slots=1`), lat/lon `toFixed(2)`.
  - `errorMessage({ status, message, retryAfter }) → string`: 400 → the API's `message`; 503 with `retryAfter` →
    `${message} Try again in N min.` (N = ceil(retryAfter / 60)); anything else, including network failure
    (`status: 0`) → `Weather unavailable, try again later.`
  - `staleNote(body) → string | null`: `Weather from up to 3 hours ago` when `warnings` includes `stale_data`.

- [ ] **Step 1: Write the failing tests** in `tests/web/plan.test.js`, one `describe` per function, with the exact
  strings above. Include:
  - `parsePace`: `'6:20'` → 380; `'abc'`, `'0:00'`, `'6:75'`, `'25:00'`, `''` → null (Review Focus 4).
  - `durationKey`: 1 → `'15'`; 65 → `'75'`; 180 → `'180'` fits; 181 → `'180'` not fits.
  - `goLine` none for a late-evening day (`windows` all null) → `No dry window of 65 min today` (Review Focus 2).
  - `goLine` with timezone `Asia/Tokyo` formats in Tokyo time; `zoneNote('Asia/Tokyo', 'Europe/Amsterdam', now)` →
    `Asia/Tokyo time`; `zoneNote('Europe/Brussels', 'Europe/Amsterdam', now)` → null.
  - `errorMessage` for 400, 503 with and without `retryAfter`, 500, 0 (Review Focus 5).

- [ ] **Step 2: Run** `npx jest tests/web/plan.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** `public/plan.js`.

- [ ] **Step 4: Run** `npx jest tests/web/plan.test.js && npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): turn a route and a day into the overview lines`

---

### Task 5: Strip, chart and "why" (`public/strip.js`)

**Files:**
- Create: `public/strip.js`, `tests/web/strip.test.js`

**Interfaces:**
- Consumes: `Slot` objects from the API (Task 1's `serializeSlot` shape); `formatClock` from `RunPlan` (Task 4).
- Produces `globalThis.DayStrip` / `module.exports`:
  - `SHADES = ['fill-green-100', 'fill-green-300', 'fill-green-500', 'fill-green-700', 'fill-green-900']` (index 4 =
    best), `GREY = 'fill-gray-300'` (past, dark, missing), `RAIN = 'fill-red-300'`.
  - `shadeClasses(slots) → string[]`: `ok` slots scaled between that day's best and worst `ok` score:
    `level = max === min ? 4 : Math.round(4 * (max - score) / (max - min))`.
  - `rangeIndices(slots, startIso, endIso) → { first, last } | null`: slots with `start` in `[startIso, endIso)`.
  - `ticks(slots, timeZone) → [{ index, label }]`: slots at local hours divisible by 3 with minute 0, label `'07'`.
  - `slotLine(slot, timeZone) → string`: `13:15 · feels 7 °C · wind 14 km/h E · rain 15 %`; excluded slots end with
    `· dark`, `· past`, `· rain`, or are `13:15 · no data` when missing (the second cue besides colour).
  - `chartModel(slots, { width, height, range, sunsetIso }) → { feels: string, wind: string, rain: [{ x, y, width,
    height }], window: { x, width } | null, dark: [{ x, width }] }`: x = slot index × `width / slots.length`;
    `feels` and `wind` are SVG path strings, each on its own scale (min..max of the span, 10 % padding), breaking the
    path (`M`) across missing slots; rain bars at the bottom, height `precipProb / 100 × 0.4 × height`; dark = runs of
    slots with `inDaylight === false`.
  - `whySentence(slots, range, { timeZone, sunsetIso }) → string`. Rule: compare the range's mean feels-like and mean
    wind with the mean of all `ok` slots outside it. Clauses: `Warmer` when ≥ 1 °C warmer, `less windy` when ≥ 3 km/h
    calmer. First sentence: `Warmer and less windy than the rest of the day.` / one clause / `Similar all day; this is
    the earliest good time.`; with no `ok` slots outside the range, `The only dry stretch of the day.`. Then `Rain from 18:00.` for the first `rain` slot after the range, and `Dark from
    17:08.` when `sunsetIso` falls inside the span after the range (both optional, joined: `Rain from 18:00, dark from
    17:08.`).

- [ ] **Step 1: Write the failing tests** with small hand-built slot arrays: shading extremes and equal scores; grey
  and red classes; `rangeIndices` edges (end exclusive); `ticks` across a DST day (labels follow local time);
  `slotLine` for every status; `chartModel` breaks at missing slots and counts dark runs; `whySentence` for warmer,
  less windy, both, neither, no `ok` slots outside the range, with and without rain/sunset after.

- [ ] **Step 2: Run** `npx jest tests/web/strip.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** `public/strip.js`. In Node it requires `./plan` for `formatClock`; in the browser it reads
  `globalThis.RunPlan` (load order in the page: route, plan, strip, settings, app).

- [ ] **Step 4: Run** `npx jest tests/web/strip.test.js && npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): model the day strip, chart and why sentence`

---

### Task 6: Remembered settings (`public/settings.js`)

**Files:**
- Create: `public/settings.js`, `tests/web/settings.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces `globalThis.RunSettings` / `module.exports`:
  - `STORAGE_KEY = 'run-window-settings'`.
  - `DEFAULTS = { paceSec: 360, durationMin: 60, allowDark: false, rain: 40, hours: '06-22' }`.
  - `validHours(text) → boolean`: comma-separated `HH` or `HH:MM` ranges like the API (`/^\d{2}(:\d{2})?-\d{2}(:\d{2})?$/`
    per part). The API stays the final judge (a 400 shows its message).
  - `loadSettings(storage) → settings`: reads JSON under `STORAGE_KEY`; every field validated on its own (paceSec
    180..900, durationMin 15..300, allowDark boolean, rain integer 0..100, hours `validHours`), invalid fields fall
    back to `DEFAULTS`. `storage` may be `null`, and any access may throw.
  - `saveSettings(storage, settings) → boolean`: false when storage is missing or throws.

- [ ] **Step 1: Write the failing tests:** defaults for `null` storage; a storage whose `getItem` throws; junk JSON;
  partially valid JSON keeps the valid fields; `setItem` throwing → `false` (Review Focus 1). The saved JSON has
  exactly the five keys (nothing about the route or location).

- [ ] **Step 2: Run** `npx jest tests/web/settings.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** `public/settings.js`.

- [ ] **Step 4: Run** `npx jest tests/web/settings.test.js && npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): remember pace and chips on the device only`

---

> **Gate before Task 7:** `fix/privacy-text` (b647e0f, or its rebased equivalent) must be on `main`, and
> `feat/web-ui` rebased onto it. Check `main`'s `public/index.html` for its privacy wording. If it hasn't landed, stop
> and ask the maintainer. Do not cherry-pick.

### Task 7: The page

**Files:**
- Modify: `public/index.html`, `tests/landing.test.js`, `tailwind.config.js` (content adds `./public/**/*.js`),
  `public/tailwind.css` (rebuilt), `middleware/logging.js` (`LOGGABLE_PATHS`), `docker/nginx-run.xadi.eu.conf` (map),
  `tests/logging.test.js` if it lists paths
- Create: `public/app.js`

**Interfaces:**
- Consumes: `RouteFile` (Task 3), `RunPlan` (Task 4), `DayStrip` (Task 5), `RunSettings` (Task 6).
- Produces: element ids later tasks use: `#route-input` (file input), `#status` (messages, `aria-live="polite"`).
  `app.js` exposes `openRouteText(text, fileName)` on `globalThis.RunApp` for Task 8's share hand-off.

- [ ] **Step 1: Update `tests/landing.test.js` first** (these are the intended flips):
  - replace `has no scripts` with: every `<script` has `src` starting with `/` and `defer`; the scripts are exactly
    `/route.js`, `/plan.js`, `/strip.js`, `/settings.js`, `/app.js` in that order (query strings like `?v=1` allowed);
    no inline script.
  - keep: no external requests, no `<style`/`style=`, `@import`/`url(`, CSP assertions with no inline hashes,
    Amsterdam example, Open-Meteo attribution, no maintainer names, existing privacy and capacity text.
  - add: privacy bullets contain `read in your browser`, `never sent`, and `rounded to 2 decimals before`; the page has
    `#route-input` with `accept` containing `.gpx` and `.kml`; every script path is in `LOGGABLE_PATHS` and served
    with a JavaScript content type.
  - add: `tests/deployConfig.test.js` keeps passing with the new map entries (it already checks map = list).

- [ ] **Step 2: Run** `npx jest tests/landing.test.js` — Expected: FAIL.

- [ ] **Step 3: Write `public/index.html`:** the tool first (spec "The page", items 1–7: title and source line with
  Today/Tomorrow toggle and zone note; "Open route" file input `accept=".gpx,.kml,application/gpx+xml,
  application/vnd.google-earth.kml+xml"` and "Use my location"; chips for duration/pace, Allow dark, Rain ≤ N %,
  Hours as buttons that open small inline editors; strip as an `<svg>` with `role="img"`, `tabindex="0"`; tap line;
  overview; `<details>` "Why this time" with an `<svg>` chart, legend and sentence; "Copy API link" button; `#status`),
  then the existing API, capacity and privacy sections, with the privacy bullets added:
  - The route file is read in your browser and never sent anywhere; the page only sends its start point.
  - The location is rounded to 2 decimals before it leaves your device.
  - Pace and chip settings are kept in your browser's storage; the route and location are not.

- [ ] **Step 4: Write `public/app.js`** (DOM glue only; logic stays in the modules):
  - Load settings; render chips.
  - File input → size check (> 5 MB: `That file is too large for a route.`) → `file.text()` → `openRouteText`.
    `parseRoute` reasons map to `That file has no route in it.` / `That file has fewer than 2 points.` / too large.
  - Location: route `start`, else `navigator.geolocation.getCurrentPosition` (refused → `Location is off. Open a
    route file instead.`), rounded to 2 decimals.
  - `fetch(RunPlan.apiUrl(location.origin, ..., { slots: true }))`; on failure `RunPlan.errorMessage`.
  - Render: strip rects (class from `shadeClasses`, outline rect from `rangeIndices` over start..start+minutes, dashed
    `stroke-dasharray` attribute for fallback), ticks, tap/arrow-key selection updating the tap line via `slotLine`,
    overview from `goLine`/`windLine`/`routeLine`, chart from `chartModel` (SVG elements via `createElementNS` with
    attributes; no `style`), `whySentence`, zone and stale notes.
  - Chip edits re-fetch (settings) or re-render (pace, one-off duration, Today/Tomorrow). Saving goes through
    `saveSettings`.
  - "Copy API link": `navigator.clipboard.writeText(RunPlan.apiUrl(location.origin, ...))`, then `Copied`.
  - Never write the route, file name or coordinates anywhere but memory.

- [ ] **Step 5: Paths and CSS:** add `/route.js`, `/plan.js`, `/strip.js`, `/settings.js`, `/app.js` to
  `LOGGABLE_PATHS` and the nginx map (`~*^/app\.js/?$  /app.js;` style); add `./public/**/*.js` to Tailwind
  `content`; `npm run build:css`.

- [ ] **Step 6: Run** `npm test && npm run lint && npm run format:check` — Expected: PASS.

- [ ] **Step 7: Manual check** with `npm run dev` (live Open-Meteo is fine for a manual check, never in tests) and the
  Playwright MCP: open `http://127.0.0.1:3003/`, upload `tests/fixtures/routes/hill-loop.gpx`, check at 320 px and
  1024 px wide: no horizontal scroll, strip outlined, three overview lines, fold opens with chart and sentence, no CSP
  errors in the console, network panel shows only same-origin requests and the `/api/window` query has 2-decimal
  coordinates. Toggle Tomorrow; set Rain to 0 and see the no-window text.

- [ ] **Step 8: Commit** `feat(web): the run-window page`

---

### Task 8: Installable page, share hand-off worker, nginx guard (release 1)

**Files:**
- Create: `public/manifest.webmanifest` (no `share_target` yet), `public/sw.js`, `public/icon.svg`,
  `public/icon-192.png`, `public/icon-512.png`, `scripts/build-icons.js` (writes the two PNGs with Node's `zlib`, no
  image dependency; committed output), `tests/web/sw.test.js`, `tests/manifest.test.js`
- Modify: `public/index.html` (`<link rel="manifest">`, `<link rel="icon" href="/icon.svg">`, `<meta
  name="theme-color">`), `public/app.js` (register `/sw.js`; on `?share=1` read the hand-off; on `?share=failed` or a
  missing entry show `The shared route didn't arrive. Open it again.`; then `history.replaceState(null, '', '/')`),
  `middleware/logging.js` + nginx map (`/manifest.webmanifest`, `/sw.js`, `/icon.svg`, `/icon-192.png`,
  `/icon-512.png`, `/share-target`), `docker/nginx-run.xadi.eu.conf`, `tests/deployConfig.test.js`,
  `eslint.config.js` (block for `public/sw.js` with `globals.serviceworker`)

**Interfaces:**
- Consumes: `RunApp.openRouteText(text, fileName)` (Task 7).
- Produces:
  - `sw.js` exports for Node `{ SHARE_PATH: '/share-target', SHARE_CACHE: 'shared-route', SHARE_KEY: '/shared-route',
    handleShare(request, caches) → Promise<Response> }`; in the worker it registers `install` (`skipWaiting`),
    `activate` (`clients.claim`) and `fetch`, calling `event.respondWith(handleShare(...))` only for `POST` to
    `SHARE_PATH` and doing nothing for any other request (no `respondWith`, so the browser handles it normally).
  - `handleShare`: `await request.formData()`, `form.get('route')`; a file of ≤ 5 MB → `caches.open(SHARE_CACHE)` then
    `put(SHARE_KEY, new Response(file, { headers: { 'X-File-Name': encodeURIComponent(file.name) } }))` → `303` to
    `/?share=1`; otherwise `303` to `/?share=failed`. Never calls `fetch`.
  - Page hand-off: `caches.open('shared-route')` → `match('/shared-route')` → text and name →
    `caches.delete('shared-route')` → `openRouteText`.
  - nginx: `location ~* ^/share-target/?$ { client_max_body_size 0; return 303 /?share=failed; }` (answers itself,
    no `proxy_pass`, so a body never reaches Node). Design deviation, recorded here: the location sets
    `client_max_body_size 0;`, because nginx checks the size (default 1 MB) before `return` and would answer 413
    instead of the redirect; 0 turns the check off, so the body is discarded.

- [ ] **Step 1: Write the failing tests:**
  - `tests/web/sw.test.js` (Node 22's `Request`, `Response`, `FormData`, `File`; a fake `caches` with `open/put`;
    `global.fetch = jest.fn()`): a share POST with a GPX file → 303 to `/?share=1`, the cache holds the file text and
    name, `fetch` not called; no file or a 6 MB file → 303 to `/?share=failed`, nothing cached; loading the file in a
    fake worker scope, a `GET /` fetch event gets no `respondWith`.
  - `tests/manifest.test.js`: `/manifest.webmanifest` served with `application/manifest+json` (fix the type with
    `express.static`'s `setHeaders` if needed); `start_url` and `scope` `/`, `display` `standalone`; icons 192 and
    512 exist and their PNG headers say those sizes; no `share_target` yet.
  - `tests/deployConfig.test.js`: the proxy test now allows exactly one location without `proxy_pass`: the
    share-target one, which has `return 303 /?share=failed;`, matches `/share-target`, `/SHARE-TARGET`,
    `/share-target/` and not `/share-targetx`.
  - `window.route.test.js` or a new test: `POST /share-target` with a multipart body to the app → 404 JSON, and the
    log payload's path is `/share-target` with no body content in it.

- [ ] **Step 2: Run** `npx jest tests/web/sw.test.js tests/manifest.test.js tests/deployConfig.test.js` — Expected:
  FAIL.

- [ ] **Step 3: Implement** the files above. Icon: a rounded square with a short strip of green bars, readable at 48 px.

- [ ] **Step 4: Run** `npm test && npm run lint && npm run format:check` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): installable page and a share hand-off that stays on the device`

---

### Task 9: Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-11-02-run-window-api-design.md` (Privacy: the page; Endpoint: `slots`),
  `readme.md` (the web interface, one paragraph), `CLAUDE.md` (what this is: three things; the `public/` module
  pattern; the share-target guard and the release order), `REVIEW.md` (flag: anything in `public/` that sends route
  data, writes it to storage or the URL, or adds inline script/style or a third-party request)

- [ ] **Step 1:** Edit the four files. Keep the public-repo rules: "the maintainer", Amsterdam examples.
- [ ] **Step 2: Run** `npm test && npm run lint && npm run format:check` — Expected: PASS.
- [ ] **Step 3: Commit** `docs: the web interface`

Hand over to the maintainer for release 1: push, deploy, and apply the nginx change on the host
(`nginx -t && systemctl reload nginx`). Then check: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST
https://run.xadi.eu/share-target` prints `303 https://run.xadi.eu/?share=failed`.

---

> **Gate before Task 10:** the maintainer confirms release 1 is live, including the nginx check above.

### Task 10: Share target (release 2)

**Files:**
- Modify: `public/manifest.webmanifest`, `tests/manifest.test.js`

- [ ] **Step 1: Write the failing test:** the manifest's `share_target` is `{ action: '/share-target', method: 'POST',
  enctype: 'multipart/form-data', params: { files: [{ name: 'route', accept: ['application/gpx+xml',
  'application/vnd.google-earth.kml+xml', 'application/xml', 'text/xml', 'application/octet-stream', '.gpx', '.kml']
  }] } }`, and `action` equals `sw.js`'s `SHARE_PATH`.
- [ ] **Step 2: Run** `npx jest tests/manifest.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement:** add `share_target`; bump the `?v=` on `app.js` if cached.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run format:check` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): list the page in Android's share sheet for route files`

### Task 11: Phone check (the maintainer)

After release 2 is deployed: on the Android phone, install the page (Chrome menu → Install app), share a route from
Trail Router, and see the page answer with that route. Also open a file with the picker, deny location once, and try
it in a private tab (no storage). Record what happened in `docs/superpowers/specs/2026-11-04-run-window-web-ui-verify.md`
(no coordinates, no place names), and commit `docs: verify the web interface on a phone`.
