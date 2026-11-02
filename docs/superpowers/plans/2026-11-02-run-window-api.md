# Run-window API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `GET /api/window`, a stateless, anonymous service that returns the best weather window per session length for today and tomorrow.

**Architecture:** Pure window selection (`lib/windows.js`) runs per request on cached Open-Meteo data (`lib/weatherCache.js`), so availability, darkness, rain and language never cause upstream calls. `app.js` builds the Express app with injected dependencies for tests; `index.js` only listens. Privacy is handled at three layers: nginx, a first middleware, and a logger that never sees query strings.

**Tech Stack:** Node >= 22, CommonJS, Express 4, `date-fns-tz`, Jest + supertest, ESLint + Prettier, Tailwind 3.4.17 for the landing page, Docker.

**Spec:** `docs/superpowers/specs/2026-11-02-run-window-api-design.md`. Read it first. Reference implementation: `../eu-dayahead`.

## Global Constraints

- Work on branch `feature/run-window-api`. Never push without the maintainer asking. This repo is public.
- Single quotes, semicolons, 2-space indent, no trailing commas, max 120 cols.
- Route handlers use `next(error)` and set `statusCode`. Only 4xx messages and messages on errors with `expose: true` reach clients.
- All response times are UTC ISO strings. Local-day logic uses `date-fns-tz` with the IANA timezone from Open-Meteo.
- Tests never hit live upstreams, and `npm test` passes without `tests/fixtures/private/`.
- No Tredict data, tokens or personal locations in the repo. Open-Meteo fixtures use Amsterdam centre (52.37, 4.89) or another public landmark.
- No log, error report or response contains `Authorization` or `Cookie` values, or coordinates above the precision the spec allows.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions the spec leaves open

Checked against the live API on 2026-11-02 where marked.

- **Row grid (live):** rows are aligned to local hours, not UTC hours (Kolkata `18:30Z`, Kathmandu `18:15Z`). Find a slot's rows from the first row's timestamp, never by flooring to a UTC hour.
- **Polar days (live):** in polar night `sunrise == sunset`; under midnight sun they span the whole day. With `dark=avoid` these need no special case, and sun times are passed through as they are.
- **Timezone names (live):** open ocean returns `Etc/GMT+2`, and these must work.
- **Coordinates (live):** Open-Meteo returns its grid point's coordinates. The response uses the request's rounded coordinates, never the upstream's.
- **`avail`:** `24` / `24:00` is allowed only as an end. A range with end <= start, or overlapping ranges, is a 400. Touching ranges (`07-09,09-11`) stay separate, so no window spans them.
- **`windFrom`:** vector mean of the slots' directions, rounded, with 360 reported as 0.
- **`precipSum`:** sum of each slot's `precip / 4`, 1 decimal. Other rounding: `score`, `apparentTempAvg` 1 decimal; `windAvg`, `gustMax`, `precipProbMax`, `windFrom` integers.
- **Rate limit:** default 20 requests/s per IP (`RATE_LIMIT_RPS`), with no TRMNL IP list. The upstream budget protects the quota, so the per-IP limit only has to allow bursts.
- **Docker networking:** `trust proxy` = `loopback` only works if nginx connects over loopback. In a bridged container the peer is the Docker gateway, and every client would share one rate-limit bucket. Use `network_mode: host`, binding `127.0.0.1:3001`.

## Review Focus

Each line has a test in the task that owns the code.

1. A location with a 30- or 45-minute UTC offset: slots find their rows and rain is not misaligned (Task 2).
2. Wind around north (350° and 10°): reports N, not S (Task 3).
3. Polar night and midnight sun with `dark=avoid`: no crash, and an honest empty or full day (Task 4).
4. Odd coordinate input (`lat=1e1`, `lat=0x10`, `lat[x]=1`, `lat=-0.001`): 400, or one normalised cache key (Task 6).
5. Open-Meteo answers 200 with junk or `{ "error": true }`: treated as a failure, and never replaces a good cache entry (Task 7).

---

### Task 1: Scaffold and capture fixtures

**Files:**
- Create: `package.json`, `jest.config.js`, `eslint.config.js`, `.prettierrc`, `.dockerignore`, `.env.example`, `tests/setup.js`, `utils/httpClient.js`, `tests/httpClient.test.js`
- Create: `tests/fixtures/open-meteo/amsterdam-forecast.json`, `amsterdam-dst-end.json`, `kathmandu-forecast.json`
- Test: `tests/fixtures.test.js`

**Interfaces:**
- Produces: `fetchText(url, { timeoutMs, maxBytes }) → Promise<{ status, body }>`, whose errors never include the URL. npm scripts: `dev`, `start`, `test`, `test:coverage`, `lint`, `lint:fix`, `format`, `format:check`, `validate-api`, `build:css`, `docker:build`.

- [ ] **Step 1: Confirm the branch**

Run: `git branch --show-current`
Expected: `feature/run-window-api`, which already holds the approved spec and this plan.

- [ ] **Step 2: Copy the config from eu-dayahead**

Copy `eslint.config.js`, `.prettierrc`, `tests/setup.js`, `utils/httpClient.js` and `tests/httpClient.test.js` unchanged, and `.dockerignore`, with `docs/` left in the image. In `package.json` keep only `cors`, `date-fns`, `date-fns-tz`, `dotenv`, `express` as dependencies and `@apidevtools/swagger-parser`, `@eslint/js`, `eslint`, `globals`, `jest`, `nodemon`, `prettier`, `supertest`, `tailwindcss@3.4.17` as dev dependencies; name `run-window`, license `MIT`, engines `node >=22`. Set `collectCoverageFrom` to `app.js`, `lib/`, `routes/`, `middleware/`, `utils/`. `.env.example`: `PORT=3001`, `HOST=127.0.0.1`, `NODE_ENV`, `LOGTAIL_TOKEN`, `LOGTAIL_ENDPOINT`, `RATE_LIMIT_RPS=20`, `CORS_ORIGIN=*`.

- [ ] **Step 3: Capture the fixtures**

```bash
H='hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m&daily=sunrise,sunset&wind_speed_unit=kmh&timeformat=unixtime&timezone=auto'
U=https://api.open-meteo.com/v1/forecast; D=tests/fixtures/open-meteo
curl -s "$U?latitude=52.37&longitude=4.89&$H&forecast_days=4" -o $D/amsterdam-forecast.json
curl -s "$U?latitude=52.37&longitude=4.89&$H&start_date=2026-10-24&end_date=2026-10-26" -o $D/amsterdam-dst-end.json
curl -s "$U?latitude=27.72&longitude=85.32&$H&forecast_days=4" -o $D/kathmandu-forecast.json
```

- [ ] **Step 4: Write `tests/fixtures.test.js`**

Assert: the Amsterdam and Kathmandu fixtures have 96 hourly rows and the DST fixture 72, each with every requested variable; the DST fixture's `utc_offset_seconds` is 3600 and its 24 October sunrise is at `06:21Z`; Kathmandu's first row has minute 15 in UTC; each fixture's `latitude` is within 0.2 of 52.37 or 27.72. Past-date `precipitation_probability` may be null, so don't assert on it, and tests using the DST fixture fill its nulls.

- [ ] **Step 5: Run and commit**

Run: `npm install && npm test && npm run lint`
Expected: PASS.

```bash
git add -A && git commit -m "chore: scaffold project and capture Open-Meteo fixtures"
```

---

### Task 2: Parse forecasts and map slots to rows

**Files:**
- Create: `lib/forecast.js`, `tests/helpers/forecast.js`
- Test: `tests/forecast.test.js`

**Interfaces:**
- Produces:
  - `parseForecast(json) → Forecast`; throws on any invalid shape. `Forecast = { timezone, anchorMs, rows: Map<ms, Row>, sun: [{ sunriseMs, sunsetMs }] }`.
  - `valuesForSlot(forecast, slotStartMs) → HourValues | null`. `HourValues = { apparentTemp, windSpeed, windFrom, gust, precipProb, precip }`.
  - Test helper `makeForecastJson({ startMs, hours, timezone, sun, values: i => partialRow }) → json` in Open-Meteo's unixtime shape, with dry, calm, 10 °C defaults.

- [ ] **Step 1: Write the failing tests**

```js
test('rain and gusts read the next row, instant values the current row', () => {
  // rows at 12:00Z and 13:00Z; only 13:00 has rain and gusts; only 12:00 has temp 9 and wind 20
  expect(valuesForSlot(f, at('12:15'))).toMatchObject({ precip: 1, precipProb: 80, gust: 50, apparentTemp: 9, windSpeed: 20 });
});
test('13:15 slot does not see the rain in the 13:00 row', () => {
  expect(valuesForSlot(f, at('13:15')).precip).toBe(0);
});
test('slot on the hour reads the same rows as the rest of that hour', () => {
  expect(valuesForSlot(f, at('12:00'))).toEqual(valuesForSlot(f, at('12:45')));
});
test('works with the Kathmandu grid at +5:45', () => {
  const f = parseForecast(kathmanduFixture);
  const start = kathmanduFixture.hourly.time[12] * 1000;
  expect(valuesForSlot(f, start + 15 * MIN)).not.toBeNull();
  expect(valuesForSlot(f, start + 15 * MIN).precip).toBe(kathmanduFixture.hourly.precipitation[13]);
});
test.each(['precipitation', 'wind_speed_10m'])('null %s gives null', variable => { /* expect(...).toBeNull() */ });
test('no next row, as at the end of the forecast, gives null', () => { /* last row */ });
test.each([{}, { error: true, reason: 'x' }, { hourly: {} }, { timezone: 'Not/AZone', hourly: validHourly }])(
  'rejects %j', json => expect(() => parseForecast(json)).toThrow()
);
test('accepts Etc/GMT+2', () => { /* parses */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/forecast.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `lib/forecast.js`**

Hour start: `hourMs = slotStartMs - ((slotStartMs - anchorMs) % 3600000)`, where `anchorMs` is the first row's time. Instant values come from `rows.get(hourMs)`; rain and gusts from `rows.get(hourMs + 3600000)`. Any missing row or null value returns null. Validate the timezone with `new Intl.DateTimeFormat('en', { timeZone })`. Thrown messages must not contain coordinates or URLs.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/forecast.test.js`
Expected: PASS.

```bash
git add lib/forecast.js tests/forecast.test.js tests/helpers/forecast.js
git commit -m "feat: parse Open-Meteo forecasts and map slots to rows"
```

---

### Task 3: Scoring and picking

**Files:**
- Create: `lib/windows.js`
- Test: `tests/windows.pick.test.js`

**Interfaces:**
- Consumes: `HourValues` from Task 2.
- Produces, with the constants in one `SCORING` object at the top of the file:
  - `Slot = { startMs, rangeIndex, values: HourValues, inDaylight }`
  - `scoreSlot(values) → number`, `fallbackScoreSlot(values) → number`
  - `pickWindow(slots, durationSlots, { scoreFn = scoreSlot, qualifies = true } = {}) → Window | null`
  - `Window = { start, end, score, qualifies, precipProbMax, precipSum, windAvg, gustMax, windFrom, windFromCardinal, apparentTempAvg, inDaylight }`, without `label`.
  - `DURATIONS`: `['15', '30', ..., '180']`.
  - `cardinal(degrees) → 'N' | 'NE' | ... | 'NW'`.

- [ ] **Step 1: Write the failing tests**

```js
const v = o => ({ apparentTemp: 10, windSpeed: 0, windFrom: 0, gust: 0, precipProb: 0, precip: 0, ...o });
test('scoreSlot follows the spec', () => {
  expect(scoreSlot(v({ windSpeed: 18, gust: 31, apparentTemp: 7.5, precipProb: 15 }))).toBeCloseTo(7.25);
  expect(scoreSlot(v({ apparentTemp: 2 }))).toBe(4);
  expect(scoreSlot(v({ apparentTemp: 20 }))).toBe(4);
  expect(scoreSlot(v({ windSpeed: 12, gust: 30, apparentTemp: 6 }))).toBe(0);
});
test('fallback scoring', () => {
  expect(fallbackScoreSlot(v({ precipProb: 70, precip: 1 }))).toBe(55);
});
test('picks the lowest mean score, earliest on a tie', () => { /* ties despite float noise: 0.1+0.2 vs 0.3 */ });
test('requires consecutive slots', () => { /* a 15-minute gap breaks the run */ });
test('does not span two ranges', () => { /* adjacent slots with rangeIndex 0 and 1, 2 slots requested → null */ });
test('window ending exactly at the last slot is found', () => { /* start..end ISO */ });
test('null when nothing fits', () => { /* 3 slots, 4 requested */ });
test('summarises the window', () => {
  // 2 slots, precip 0.4 and 0.4, probs 10 and 15, wind 10 and 20, gusts 20 and 31, temps 7 and 8
  expect(w).toMatchObject({ precipSum: 0.2, precipProbMax: 15, windAvg: 15, gustMax: 31, apparentTempAvg: 7.5, qualifies: true });
});
test('wind around north averages to north', () => {
  const w = pickWindow([slot(0, v({ windFrom: 350 })), slot(1, v({ windFrom: 10 }))], 2);
  expect(w).toMatchObject({ windFrom: 0, windFromCardinal: 'N' });
});
test.each([[22, 'N'], [23, 'NE'], [225, 'SW'], [337, 'NW'], [338, 'N']])('%i° is %s', (deg, name) => {
  expect(cardinal(deg)).toBe(name);
});
test('inDaylight is false if any slot is dark', () => {});
test('qualifies false is passed through for fallbacks', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/windows.pick.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Score per the spec's formulas. Compare with `score < best - 1e-9` while walking from the earliest, so float noise can't beat an earlier window. Round only in the summary. `end` is the last slot's start plus 15 minutes.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/windows.pick.test.js`
Expected: PASS.

```bash
git add lib/windows.js tests/windows.pick.test.js
git commit -m "feat: score slots and pick the best window"
```

---

### Task 4: Local days, exclusions and fallback

**Files:**
- Modify: `lib/windows.js`
- Test: `tests/windows.day.test.js`

**Interfaces:**
- Consumes: `valuesForSlot`, `pickWindow`, `fallbackScoreSlot`, `DURATIONS`.
- Produces:
  - `localDates(nowMs, timezone) → [today, tomorrow]` as `yyyy-MM-dd`.
  - `buildDaySlots({ date, forecast, avail, dark, nowMs }) → Slot[]`, applying every exclusion except rain.
  - `computeDay({ date, forecast, params: { avail, dark, rain }, nowMs }) → { date, sunrise, sunset, windows, fallback? }`.
  - `avail` entries are `{ startMin, endMin }` from Task 6.

- [ ] **Step 1: Write the failing tests**

Exact cases, all built with `makeForecastJson` except where a fixture is named:

```js
test('23-hour day has 92 slots, 25-hour day 100', () => {
  // Europe/Amsterdam, 2027-03-28 and amsterdam-dst-end.json for 2026-10-25, avail 00-24, dark ok
});
test('dst-end fixture: first slot is 2026-10-24T22:00Z, last starts 2026-10-25T22:45Z', () => {});
test('Havana has no midnight on 2027-03-14: 92 slots, all on that local date', () => {});
test('past slots are excluded, using now rounded up to the quarter', () => {
  // now 12:01 → first slot 12:15; now 12:15:00.000 → first slot 12:15
});
test('now does not affect tomorrow', () => {});
test('availability edges', () => {
  // avail 12:00-13:00: 60-minute window 12:00–13:00 found; 75-minute null; 12:10-13:00 → first slot 12:15
});
test('windows do not span touching ranges', () => {
  // 07-09,09-11: "180" null, "120" found
});
test('darkness', () => {
  // sunrise 07:37: avoid → first slot 07:45; sunset 17:09 → last slot ends 17:00; ok → includes dark, inDaylight false
});
test('rain threshold edge', () => {
  // prob 40, rain=40 → window; prob 41, rain=40 → null. precip 0.19 → window; 0.2 → null
});
test('rain in the following row blocks the slot', () => {
  // 13:00 row has prob 80: 12:45 blocked, 13:00 free
});
test('fallback only when windows["60"] is null', () => {
  expect('fallback' in dryDay).toBe(false);
  expect(wetDay.fallback).toMatchObject({ qualifies: false });
});
test('fallback never breaks past, availability or darkness', () => {});
test('fallback is null when nothing fits at all', () => {});
test('polar night with dark=avoid: all windows null, fallback null, no throw', () => {
  // sunrise === sunset
});
test('midnight sun with dark=avoid: full day available', () => {});
test('null row excludes the slot for both windows and fallback', () => {});
test('all 12 duration keys are present', () => {});
test('anti-goals hold across combinations', () => {
  // amsterdam-forecast.json, every combination of now in 0,6,12,23h; avail 06-22 and 07-09,12-14,17-21;
  // rain 0,40,100; dark ok,avoid. Each non-null window: start >= now, inside one range, every slot within rain
  // limit when qualifies, inside sun times when avoid.
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/windows.day.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Walk 15-minute steps from `fromZonedTime(date + 'T00:00:00', tz) - 1h` to the next date's start + 1h, and keep only steps whose local date equals `date`; this covers days with no local midnight. For range checks use the local minute of day `m` from `formatInTimeZone`, with `startMin <= m && m + 15 <= endMin`. Find sun times by comparing the local date of `sunriseMs` with `date`; if none matches, `sunrise` and `sunset` are null and `dark=avoid` excludes every slot. `computeDay` filters rain before picking windows, and runs the fallback on the unfiltered slots.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/windows`
Expected: PASS.

```bash
git add lib/windows.js tests/windows.day.test.js
git commit -m "feat: build local days with exclusions and fallback"
```

---

### Task 5: Labels

**Files:**
- Create: `lib/labels.js`
- Test: `tests/labels.test.js`

**Interfaces:**
- Produces: `formatLabel(window, { timezone, lang }) → string`.

- [ ] **Step 1: Write the failing tests**

```js
const w = { start: '2026-11-02T11:15:00.000Z', end: '2026-11-02T12:30:00.000Z', qualifies: true, precipProbMax: 15,
  windAvg: 18, windFromCardinal: 'SW', apparentTempAvg: 7.5 };
test('en', () => expect(formatLabel(w, { timezone: 'Europe/Amsterdam', lang: 'en' }))
  .toBe('12:15–13:30 · dry · 18 km/h SW · 8°C'));
test('nl', () => expect(formatLabel(w, { timezone: 'Europe/Amsterdam', lang: 'nl' }))
  .toBe('12:15–13:30 · droog · 18 km/u ZW · 8°C'));
test('fallback shows the rain chance', () => expect(formatLabel({ ...w, qualifies: false, precipProbMax: 70 },
  { timezone: 'Europe/Amsterdam', lang: 'en' })).toBe('12:15–13:30 · rain 70% · 18 km/h SW · 8°C'));
test('nl cardinals', () => { /* NE→NO, E→O, SE→ZO, S→Z, SW→ZW, W→W, NW→NW, N→N */ });
test('-0.4° shows as 0°C, not -0°C', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/labels.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement with `formatInTimeZone`.** nl for rain: `regen 70%`. The maintainer checks the nl wording in rollout.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/labels.test.js`
Expected: PASS.

```bash
git add lib/labels.js tests/labels.test.js
git commit -m "feat: format window labels in English and Dutch"
```

---

### Task 6: Query validation

**Files:**
- Create: `lib/params.js`
- Test: `tests/params.test.js`

**Interfaces:**
- Produces:
  - `parseWindowQuery(query) → { lat, lon, avail: [{ startMin, endMin }], availText, dark, rain, lang }`; throws an error with `statusCode = 400` and a message naming the parameter, never its value. `lat` and `lon` are rounded to 2 decimals and never `-0`.

- [ ] **Step 1: Write the failing tests**

```js
const ok = { lat: '52.37', lon: '4.89' };
test('defaults', () => expect(parseWindowQuery(ok)).toMatchObject({ availText: '06-22', dark: 'avoid', rain: 40, lang: 'en' }));
test('empty strings use defaults', () => { /* avail, dark, rain, lang = '' */ });
test('rounds and normalises', () => {
  expect(parseWindowQuery({ lat: '52.3731', lon: '-0.001' })).toMatchObject({ lat: 52.37, lon: 0 });
  expect(Object.is(parseWindowQuery({ lat: '-0.001', lon: '1' }).lat, 0)).toBe(true);
});
test.each(['90', '-90', '0'])('lat %s is valid', () => {});
test.each(['90.01', '1e1', '0x10', ' 5', '', 'abc'])('lat %s is a 400', () => {});
test.each(['180.01', '-180.01'])('lon %s is a 400', () => {});
test('object and repeated values are a 400', () => {
  // lat: { x: '1' }, lat: ['1', '2'], and the same for every other parameter
});
test.each([
  ['07-09,12-14', [[420, 540], [720, 840]]],
  ['07:30-09:15', [[450, 555]]],
  ['17-24', [[1020, 1440]]],
  ['17-24:00', [[1020, 1440]]],
  ['07-09,09-11', [[420, 540], [540, 660]]]
])('avail %s', () => {});
test.each(['09-07', '07-07', '24-24', '07-25', '07:60-08', '7-9', '07-09,08-10', '07-09,', 'x'])('avail %s is a 400', () => {});
test.each(['101', '-1', '4.5', 'a'])('rain %s is a 400', () => {});
test.each(['maybe'])('dark %s is a 400', () => {});
test.each(['de'])('lang %s is a 400', () => {});
test('errors name the parameter and never echo the value', () => {
  expect(() => parseWindowQuery({ lat: '91.123456', lon: '4.89' })).toThrow(/lat/);
  expect(() => parseWindowQuery({ lat: '91.123456', lon: '4.89' })).not.toThrow(/91\.123456/);
});
```

`lat` and `lon` are required, so an empty `lat` is a 400, while empty optional values use defaults. `7-9` is a 400 because the format is `HH`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/params.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** Coordinates must match `/^-?\d{1,3}(\.\d+)?$/` before conversion.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/params.test.js`
Expected: PASS.

```bash
git add lib/params.js tests/params.test.js
git commit -m "feat: validate window query parameters"
```

---

### Task 7: Open-Meteo client and cache

**Files:**
- Create: `lib/openMeteo.js`, `lib/weatherCache.js`
- Test: `tests/openMeteo.test.js`, `tests/weatherCache.test.js`

**Interfaces:**
- Consumes: `fetchText`, `parseForecast`.
- Produces:
  - `fetchForecast(lat, lon) → Promise<Forecast>`, sending exactly the spec's parameters, timeout 10 s, `redirect: 'error'`.
  - `createWeatherCache({ fetchForecast, now = Date.now, onFailure = () => {}, budget = BUDGET, hashKey = hmac }) → { getForecast(lat, lon) → Promise<{ forecast, stale }>, stats() }`. Fails with `statusCode = 503`, `expose = true` and message `Weather data is temporarily unavailable.`.
  - `nextExpiry(ms) → ms`.

- [ ] **Step 1: Write the failing tests**

```js
// openMeteo.test.js, with global.fetch mocked
test('sends forecast_days=4, timeformat=unixtime, timezone=auto and the rounded coordinates', () => {});
test.each([[500, 'x'], [200, 'not json'], [200, '{"error":true,"reason":"Latitude 52.37"}'], [200, '{}']])(
  'status %i body %s rejects, and the error has no coordinates or URL', () => {});

// weatherCache.test.js
test.each([
  ['10:02', '10:05'], ['10:05', '11:05'], ['10:06', '11:05'], ['10:59', '11:05']
])('fetched at %s expires at %s', () => {});
test('a fresh entry makes no second call', () => {});
test('other coordinates in the same key share an entry', () => { /* the key is the rounded pair */ });
test('concurrent requests share one call', () => {});
test('an expired entry is refetched', () => {});
test('upstream failure with an entry under 3 hours old returns it as stale', () => {});
test('upstream failure with an entry over 3 hours old is a 503', () => {});
test('upstream failure with no entry is a 503', () => {});
test('after a failure the key waits 5 minutes', () => {
  // call at t: fails. t+4m59: no call. t+5m: call.
});
test('junk from upstream never replaces a good entry', () => {
  // fetchForecast rejects after a success: the old forecast is still served, stale: true
});
test('entries older than 3 hours are removed', () => { /* stats().entries */ });
test('stale entry from before midnight still has a complete today and tomorrow', () => {
  // amsterdam-forecast.json, fetched 23:50 local on day 1, upstream failing at 00:10:
  // localDates gives day 2 and 3; computeDay for both has slots through 23:45 with non-null rain values
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/openMeteo.test.js tests/weatherCache.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement both files.** `onFailure` receives a reason without a URL or coordinates. Budget is added in Task 8; put a `BUDGET` constant in place now.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/openMeteo.test.js tests/weatherCache.test.js`
Expected: PASS.

```bash
git add lib/openMeteo.js lib/weatherCache.js tests/openMeteo.test.js tests/weatherCache.test.js
git commit -m "feat: fetch and cache forecasts with stale fallback"
```

---

### Task 8: Upstream budget

**Files:**
- Modify: `lib/weatherCache.js`
- Test: `tests/weatherBudget.test.js`

**Interfaces:**
- Produces: `BUDGET = { keysPerDay: 300, callsPerMinute: 300, callsPerDay: 8000 }`. The capacity error has `statusCode = 503`, `expose = true`, `retryAfter` (seconds to UTC midnight), and message `The service is at capacity for new locations today. Try again after midnight UTC.`. `stats() → { entries, oldestAgeSeconds, keysToday, callsToday, callsThisMinute }`.

- [ ] **Step 1: Write the failing tests**

```js
const budget = { keysPerDay: 2, callsPerMinute: 3, callsPerDay: 5 };
test('a new key over the cap gets a 503 with retryAfter, admitted keys keep working', () => {});
test('an admitted key can still refresh after the cap is reached', () => {});
test('the cap is checked before the cache, and resets at UTC midnight', () => {});
test('retries count towards the call limits', () => {});
test('over the minute limit: stale if there is an entry, otherwise 503', () => {});
test('over the day limit: stale if there is an entry, otherwise 503', () => {});
test('call counters reset at the next minute and UTC day', () => {});
test('stats contains counts and ages, and no coordinates', () => {
  expect(JSON.stringify(cache.stats())).not.toMatch(/52\.37|4\.89/);
});
test('keys are stored only as salted hashes, with a new salt each UTC day', () => {
  // inject hashKey(salt, key): it receives the same salt within a UTC day and a different one after midnight,
  // and the key set holds only its return values
});
test('real limits stay under Open-Meteo terms', () => {
  expect(BUDGET.callsPerDay).toBeLessThan(10000);
  expect(BUDGET.callsPerMinute).toBeLessThan(600);
  expect(BUDGET.callsPerDay * 31).toBeLessThan(300000);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/weatherBudget.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement.** Order in `getForecast`: admit the key; return a fresh entry; join an in-flight call; if backing off or over budget, use stale or 503; otherwise count and call. Use `crypto.createHmac('sha256', salt)` for the key set, as `getClientId` does in eu-dayahead's logger.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/weather`
Expected: PASS.

```bash
git add lib/weatherCache.js tests/weatherBudget.test.js
git commit -m "feat: cap distinct locations and upstream calls"
```

---

### Task 9: Privacy middleware

**Files:**
- Create: `middleware/stripAuth.js`, `middleware/logging.js`, `middleware/rateLimit.js`
- Test: `tests/stripAuth.test.js`, `tests/logging.test.js`, `tests/rateLimit.test.js`

**Interfaces:**
- Produces: `stripAuth(req, res, next)`; `loggingMiddleware`, `logError(error, req?)`, `sendToLogtail`, `getClientId`; `createRateLimiter`, `parseRateLimit` with default 20.

- [ ] **Step 1: Write the failing tests**

```js
// stripAuth
test('removes authorization and cookie from headers and rawHeaders, in any case', () => {
  // rawHeaders ['AUTHORIZATION', 'Bearer secret', 'Accept', '*/*', 'cookie', 'a=b'] → ['Accept', '*/*']
});

// logging: capture the payload through a mocked global.fetch, with LOGTAIL_TOKEN set
test.each([
  ['a 200 on the window route', '/api/window?lat=52.3731&lon=4.8922'],
  ['a 404', '/nope?lat=52.3731&lon=4.8922'],
  ['a 400', '/api/window?lat=91.3731&lon=4.8922']
])('%s logs no query string or exact coordinates', (_, url) => {
  expect(JSON.stringify(payload)).not.toMatch(/3731|8922|lat=/);
});
test('referrer with coordinates is not logged', () => {});
test('authorization and cookie values are not logged', () => {});
test('window route logs lat and lon rounded to 1 decimal as separate fields', () => {
  expect(payload).toMatchObject({ lat: 52.4, lon: 4.9 });
});
test('logError logs the path only', () => {
  expect(JSON.stringify(payload)).not.toMatch(/3731|lat=/);
});
test('payload has service run-window-api and no url, query or referrer keys', () => {});

// rateLimit: copy eu-dayahead's tests
test('default limit is 20', () => expect(parseRateLimit(undefined)).toBe(20));
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/stripAuth.test.js tests/logging.test.js tests/rateLimit.test.js`
Expected: FAIL.

- [ ] **Step 3: Copy and adapt from eu-dayahead**

Logging: `message` is `${method} ${req.path} - ${status}`; remove `url`, `query`, `referrer` and `country`; `service: 'run-window-api'`; take `logtailEndpoint` from `LOGTAIL_ENDPOINT` only, with no hard-coded default; the development `console.log` uses `req.path`. Log `lat`/`lon` only on `/api/window`, and only when they parse as valid numbers. `logError` uses `req.path`. `rateLimit.js` is unchanged apart from the default.

- [ ] **Step 4: Run and commit**

Run: `npm test -- tests/stripAuth.test.js tests/logging.test.js tests/rateLimit.test.js`
Expected: PASS.

```bash
git add middleware tests/stripAuth.test.js tests/logging.test.js tests/rateLimit.test.js
git commit -m "feat: strip credentials and keep coordinates out of logs"
```

---

### Task 10: Route, app and health

**Files:**
- Create: `app.js`, `index.js`, `routes/window.js`, `middleware/securityHeaders.js`, `public/index.html` (placeholder until Task 11)
- Test: `tests/window.route.test.js`, `tests/privacy.test.js`, `tests/securityHeaders.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `createApp({ weather = createWeatherCache(...), now = Date.now } = {}) → express app`. `index.js` exports the app and only listens on `PORT` / `HOST` when run directly.
- Middleware order: `stripAuth`, `securityHeaders`, `cors`, `loggingMiddleware`, static, routes. `trust proxy` = `loopback`; `x-powered-by` disabled. `/api` has the rate limiter.

- [ ] **Step 1: Write the failing tests**

Use a fake `weather` returning `parseForecast(amsterdamFixture)`, and `now` set to the fixture's first day at 09:00 UTC.

```js
test('response shape', async () => {
  const { body } = await request(app).get('/api/window?lat=52.3731&lon=4.8922&avail=07-09,12-14,17-21');
  expect(body.location).toEqual({ lat: 52.37, lon: 4.89, timezone: 'Europe/Amsterdam' });
  expect(body.params).toEqual({ avail: '07-09,12-14,17-21', dark: 'avoid', rain: 40 });
  expect(body.days).toHaveLength(2);
  expect(Object.keys(body.days[0].windows)).toHaveLength(12);
  expect(body.attribution).toBe('Weather data by Open-Meteo.com');
  expect(body.warnings).toBeUndefined();
});
test('windows have labels, including the fallback; lang=nl changes them', () => {});
test('stale data adds warnings: ["stale_data"]', () => {});
test('each parameter invalid and repeated is a 400 naming it', () => {});
test('empty values use defaults', () => {});
test('weather failure is a 503 with its message; capacity adds Retry-After', () => {});
test('an unexpected error is a 500 saying only "Internal server error"', () => {});
test('/health is healthy', () => {});
test('/health/cache returns counts and ages only', () => {});
test('unknown route is a 404 JSON', () => {});

// privacy.test.js: end to end through the app, capturing every log payload and response
test('a request with Authorization: Bearer secret leaks it nowhere', async () => {
  // success, 400, 404, 500 and 503 responses: neither payloads, bodies nor headers contain "secret"
});
test('the route never sees the header', () => { /* a test route on the real middleware chain reports req.headers and rawHeaders */ });
test('a failed upstream call logs no coordinates', () => {});
```

Mount the `/openapi.yaml` route in this task; Task 11 adds the file and its test.

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/window.route.test.js tests/privacy.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

Error handler as in eu-dayahead, except: message is `error.message` when `status < 500` or `error.expose`; set `Retry-After` from `error.retryAfter`; call `logError` for 5xx without `expose`. `onFailure` in `createApp`'s default cache calls `logError(new Error(reason))`. `securityHeaders.js`: keep `buildContentSecurityPolicy`, with one policy from `public/index.html`, no `SITE_SOURCES` or docs policy. Copy its tests, removing the docs ones.

- [ ] **Step 4: Run and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add -A && git commit -m "feat: serve the window endpoint with health routes"
```

---

### Task 11: Contract and landing page

**Files:**
- Create: `docs/openapi.yaml`, `public/index.html`, `public/tailwind.css`, `tailwind.config.js`, `tailwind.input.css`
- Test: `tests/openapi.test.js`, `tests/landing.test.js`

**Interfaces:**
- Consumes: the route's real response.

- [ ] **Step 1: Write the failing tests**

```js
test('the spec validates', async () => { await SwaggerParser.validate('docs/openapi.yaml'); });
test('documents every parameter and the 200, 400, 429 and 503 responses', () => {});
test('a real response has exactly the documented top-level, day and window keys', () => {});
test('/openapi.yaml returns 200', () => {});
test('landing page has an example request, the Open-Meteo attribution with a link, and the privacy text', () => {
  // contains /api/window?, Open-Meteo.com, Authorization, "3 hours", "never stores"
});
test('landing page example uses Amsterdam coordinates', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- tests/openapi.test.js tests/landing.test.js`
Expected: FAIL.

- [ ] **Step 3: Write the files**

`windows` values use `nullable`. `fallback` is optional and nullable. Landing page: no scripts, no external requests. It says what the service receives (coordinates, and for TRMNL users a token that is removed and never read), what it keeps (2-decimal coordinates for at most 3 hours, salted hashes for a day), and that it never stores tokens. Run `npm run build:css`.

- [ ] **Step 4: Run and commit**

Run: `npm test && npm run lint && npm run validate-api`
Expected: PASS, and `✅ OpenAPI spec is valid`.

```bash
git add -A && git commit -m "docs: add OpenAPI contract and landing page"
```

---

### Task 12: Packaging, CI and project docs

**Files:**
- Create: `docker/Dockerfile`, `docker/healthcheck.js`, `docker/nginx-run.xadi.eu.conf`, `docker-compose.yml`, `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`, `readme.md`
- Test: `tests/deployConfig.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('nginx config removes credentials and logs no query strings', () => {
  expect(conf).toMatch(/proxy_set_header Authorization "";/);
  expect(conf).toMatch(/proxy_set_header Cookie "";/);
  expect(conf).toMatch(/log_format runwindow[^;]*\$uri/);
  expect(conf).not.toMatch(/log_format runwindow[^;]*(\$request\b|\$args|\$request_uri|\$http_referer)/);
  expect(conf).toMatch(/access_log \S+ runwindow;/);
  expect(conf).toMatch(/error_log \S+ crit;/);
});
test('compose uses host networking on loopback', () => {
  expect(compose).toMatch(/network_mode: host/);
  expect(compose).toMatch(/HOST=127\.0\.0\.1/);
  expect(compose).toMatch(/PORT=3001/);
});
```

`crit` matters because nginx writes the full request line, with its query string, into `error`-level entries such as upstream connection failures.

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- tests/deployConfig.test.js`
Expected: FAIL.

- [ ] **Step 3: Write the files**

Dockerfile as in eu-dayahead, with `EXPOSE 3001`. Healthcheck connects to `127.0.0.1:${PORT}`. CI: copy eu-dayahead's `test` and `security` jobs with their pinned actions, add `npm run validate-api` and the out-of-date `public/tailwind.css` check. Nginx: `listen`, `server_name run.xadi.eu`, `proxy_pass http://127.0.0.1:3001`, `X-Forwarded-For $proxy_add_x_forwarded_for`; leave TLS to the host's existing certbot setup. In `CLAUDE.md`, replace "Status" and "Commands" with the real commands, and mark the API built. In `readme.md`, update the status line.

- [ ] **Step 4: Verify the image**

Run: `npm run docker:build && docker run -d --rm --name rw-test --network host -e PORT=3001 -e HOST=127.0.0.1 run-window && sleep 8 && docker inspect --format '{{.State.Health.Status}}' rw-test; curl -s 'http://127.0.0.1:3001/api/window?lat=52.37&lon=4.89' | head -c 300; docker stop rw-test`
Expected: `healthy` or `starting`, then JSON containing `Europe/Amsterdam`. If Docker isn't available, say so; don't mark this step done.

- [ ] **Step 5: Run everything and commit**

Run: `npm test && npm run lint && npm run format:check && npm run validate-api`
Expected: PASS.

```bash
git add -A && git commit -m "chore: add Docker, nginx and CI configuration"
```

---

### Task 13: Rollout (maintainer, with an agent checking)

Needs host access and approval, so no agent does this unprompted. The API stays unlinked from the plugin until every check passes.

- [ ] **Step 1: Merge the branch**, using superpowers:finishing-a-development-branch.
- [ ] **Step 2: Deploy** next to eu-dayahead, with the nginx config and a `run.xadi.eu` DNS record and certificate. First confirm port 3001 is free on the host.
- [ ] **Step 3: Check a request with a test token**

Run: `curl -s -H 'Authorization: Bearer canary-123' 'https://run.xadi.eu/api/window?lat=52.3731&lon=4.8922' | head -c 300`
Expected, each checked separately:
  - Better Stack shows the path, `lat: 52.4`, `lon: 4.9`, and no `canary-123`, `3731` or `8922`.
  - `grep -E 'canary|3731|lat=' <this site's nginx logs>` finds nothing.
  - `/health/cache` shows no coordinates.
- [ ] **Step 4: Check the rate limiter sees real clients.** Requests from two different networks produce different `clientId`s in Better Stack. If they match, `trust proxy` and the network mode are wrong.
- [ ] **Step 5: Check a real TRMNL request**, from a private plugin that sends a throwaway header, with the same checks as Step 3.
- [ ] **Step 6: Run the week-long sanity check** from the spec: compare the answers with how the runs felt, and check the nl labels.
