# TRMNL Running Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private TRMNL plugin that shows this week's Tredict training, an estimated form graph and today's run window
on one full 800x480 screen.

**Architecture:** The plugin polls only the run-window API, with no headers. A transform script (`transform.js`, run
by TRMNL after each poll) fetches Tredict with the user's token, works out the week, the form and the run window, and
returns a small, screen-ready set of merge variables. The markup is plain Liquid that prints those values with
`| escape`, and draws the form graph as an SVG path the script computed: no JS runs at render. The script's logic
lives in small CommonJS modules under `src/`, unit-tested with Jest; a build script concatenates them into
`transform.js`.

**Tech Stack:** Node (TRMNL's runtime: Node 24, built-ins only), Liquid (TRMNL framework 3.4.0), Jest, liquidjs,
js-yaml.

**Spec:** `docs/superpowers/specs/2026-11-02-trmnl-running-board-design.md` (approved 2026-11-03, data flow revised
after Task 1). **Verify answers:** `docs/superpowers/specs/2026-11-03-trmnl-running-board-verify.md`. Read both.

## Global Constraints

- Node >= 22 for the repo, CommonJS, Jest, ESLint + Prettier: single quotes, semicolons, 2-space indent, no trailing
  commas, max 120 cols. Every task ends with `npm run lint && npm run format:check && npm test` passing.
- `transform.js` is one generated file: built-ins only (`fetch`, `AbortSignal`, `Intl`, `URLSearchParams`), no
  `require`, no npm packages. It defines `async function run(input)`.
- `run` never throws and never takes 5 s: every outbound call is in parallel with `AbortSignal.timeout(3000)`, and
  every branch returns an object. A throw would make TRMNL silently keep the previous screen.
- Every output carries `fetchedAt` (ISO) and `fetchedAtText` (day and time in the user's timezone, "We 12:00" /
  "wo 12:00"), printed in the footer, so a frozen screen shows its age even a day later.
- No `console.*` in `src/`, and outputs carry fixed strings only, never an `error.message`: TRMNL logs what a script
  prints, and the input holds the token in clear. Task 2's build test fails on `console.` or `.message` in
  `transform.js`.
- Source modules live in `integrations/trmnl-running-board/src/`. `transform.js` is generated: ESLint and Prettier
  ignore it, and CI checks it equals the build output.
- The output never contains a raw Tredict response, a token, or an activity's `summary` (it holds start coordinates).
- `Intl` in TRMNL has English locale data only: never format with an `nl` locale. Timezone conversion uses
  `Intl.DateTimeFormat('en-US', { timeZone, ... }).formatToParts`. Day and month names, decimal separators and all
  text come from `STRINGS.en` / `STRINGS.nl`.
- No weather logic: every window, rain chance and wind value comes from the run-window API response.
- Conditions wording mirrors the API's `lib/labels.js`: "dry" / "droog" only when `qualifies` is true and
  `precipProbMax <= 20`, otherwise "rain N%" / "regen N%"; speed `km/h` / `km/u`; nl compass points NO, O, ZO, Z, ZW
  for NE, E, SE, S, SW (others unchanged); temperature `Math.round(apparentTempAvg) || 0` then `°C`.
- The form is always labelled "Form (est.)" / "Vorm (schatting)".
- Every value the markup prints goes through `| escape`, except SVG path data and coordinates, which the script
  validates (`/^[ML0-9. -]*$/` for paths, finite numbers) before output and replaces with `''` / `0` otherwise.
- Committed Tredict fixtures are synthetic: Tredict's structure (see the verify answers), invented ids, dates, titles,
  notes and metrics, no token. Real responses only in the gitignored `tests/fixtures/private/`; `npm test` passes
  without it, and no test prints a value from it.
- No token, real coordinate or personal name anywhere in the repo. Examples use Amsterdam centre (52.37, 4.89).
- Quote every select value in `settings.yml`. Plugin files each ≤ 100 KB. Only the `full` layout in v1.
- Garmin `attribution` text is shown whenever a shown activity has `isFromGarminApi: true`; the API's `attribution` is
  shown whenever a run window is shown.

## Review Focus

1. Tredict text containing `<`, `</script>`, quotes, `{{`, `{%` or emoji in a title → shown as plain text, page intact.
2. One Tredict call fails (5xx, timeout, HTML body, unparseable JSON, 402) while the others succeed → that panel says so
   or shows last good data with its time; the rest renders.
3. Day boundaries: activities at 23:30 local on Sunday and 00:30 local on Monday land on the right days and weeks,
   including the week of the DST change (2026-10-25).
4. A new account (no efforts, no activities, no plans) → empty states, never `NaN`, `undefined`, `null` or a broken
   graph.
5. Garbage input to `run` (`{}`, no `trmnl`, `fetch` rejecting, a body that is not JSON, a never-resolving `fetch`) →
   an object with `fetchedAt` and error panels, within the timeout.

Each has a test in the task that owns the code (marked "Review Focus N").

## Decisions this plan makes

- **Data flow** (from Task 1, spec "Data flow"): poll only `run.xadi.eu/api/window`, no headers; the script fetches
  Tredict. The token never reaches `run.xadi.eu`.
- **Weather retry:** a failed poll arrives as `{}` (status lost). The script then fetches the same window URL itself
  (tokenless, built by `windowUrl(settings)`, which a test keeps equal to the rendered polling URL). Its status picks
  the message: 400 → "Check your hours setting"; anything else → "Weather unavailable". No retry when the previous
  output's `run.kind` was `error` and its `fetchedAt` is under 30 minutes old (no extra load during an outage).
- **Settings in the URL:** the polling URL removes spaces from `availability` (the API rejects `07-09, 17-21`) and
  uses the same defaults as `readSettings` for empty fields, so the API and the script agree on the hours. Without a
  location the URL has no `lat`/`lon` (the API answers 400 without spending location budget).
- **Sport filter:** `running` matches `sportType === 'running'` exactly (the maintainer's data: `running`, `cycling`,
  `misc`; plans `running`). `all` matches everything.
- **Form graph as SVG**, not Highcharts: the script computes the path, so the screen runs no JS, needs no CDN script,
  and has no JSON-in-script escaping problem. Deviates from the spec's "Highcharts, as in eu-dayahead".
- **Last good Tredict data:** each output carries `tredictAt` / `tredictAtText`: the time of the last successful
  Tredict fetch, set on `ok` and copied unchanged on `stale`. On a Tredict 5xx, timeout or unreadable body, the script
  reuses `week` (with its `garmin` list) and `form` from `trmnl.previous_merge_variables` only when that `tredictAt`
  is on today's local date; the message is "Tredict data from {tredictAtText}". Otherwise `unavailable`. 401/403/402
  never reuse old data. An efforts response with no keys counts as `unavailable` (the endpoint always covers a year;
  an empty one may be a paused token).
- **Copy for a shorter window:** "Only {n} min fits your hours", not "Only 45 min dry in your hours": a qualifying
  window can have up to the user's rain limit, so "dry" could contradict the API's rule.
- **Nothing planned today or tomorrow:** today while today's hours remain, with "no session planned". A rest day with
  a plan tomorrow shows tomorrow, as the spec says.
- **Plans unknown (Tredict failed):** 60 minutes, heading "60 min" without a session claim.
- **Tredict range:** from the day before this local Monday to the day after next Monday; filter by local date.
- **Timezones:** the calendar and form use `trmnl.user.time_zone_iana`, else the API's `location.timezone`, else `UTC`.
  The run window panel uses the API's `location.timezone` and picks the `days[i]` whose `date` matches.
- **Plan day:** a plan's local day is its `date` in the user's IANA timezone. Its numeric `timezone` is an offset
  fixed when the plan was made, wrong across a DST change, so it is ignored. An activity's day is its `date` in its own
  IANA `timezone`, else the user's.
- **Spec deviations that follow from the above:** the location setting's key is `lat_lon` (spec: `location`); no
  `shared.liquid` and no `append_random` chart ids (no chart JS); the en headings are "BEST TIME TODAY" / "TOMORROW",
  nl "BESTE TIJD VANDAAG" / "MORGEN".
- **Form model:** CTL += (load − CTL)/42, ATL += (load − ATL)/7, form = CTL − ATL, both from 0 on the first day with
  data. Load: confirmed efforts for past days; all entries for today and later (a done plan's `unconfirmed` entry is
  already gone). Constants exported for V10.
- **Missed:** a plan on a past local day with no `executedTrainingId`. **Rest day:** no planned session of the filtered
  sport.
- **Output contract** (`v: 1`), produced by Task 8 and printed by Task 9:

  ```
  { v: 1, lang: 'en'|'nl', fetchedAt, fetchedAtText,
    tredict: { state: 'ok'|'stale'|'auth'|'payment'|'unavailable', message: string },
    tredictAt: ISO|null, tredictAtText: string,
    week: null | { title, days: [{ label, today: bool, items: [{ kind: 'done'|'planned'|'missed'|'unplanned', text }], more }], footer, garmin: [string] },
    form: null | { heading, today, pastPath, futurePath, zeroY, todayX, labels: { back, today, ahead }, empty: string },
    run: { kind: 'window'|'shorter'|'fallback'|'none'|'error'|'badSettings'|'noLocation', heading, lines: [string] },
    attribution: string }
  ```

  `message` is `''` when `state` is `ok`. `more` is `''` or `'+N'`. A day with no items prints "—". SVG coordinates
  are in a 360x150 box.

## File Structure

```
integrations/trmnl-running-board/
  settings.yml          polling URL, custom fields, refresh; no headers
  transform.js          GENERATED by scripts/build-trmnl.js from src/; do not edit
  full.liquid           the screen: prints the merge variables, draws the SVG
  src/settings.js       readSettings(input), windowUrl(settings)
  src/strings.js        STRINGS (en, nl), resolveLanguage, fill, conditionsText, formatKm, formatDuration
  src/time.js           timezone helpers (localDate, localTime, addDays, weekDates, isoWeek, availabilityEnd)
  src/tredict.js        tredictRange, fetchJson (timeout, status classification)
  src/week.js           planDay, activityDay, buildWeek, weekView
  src/form.js           FORM_CONSTANTS, formSeries, formChart
  src/runWindow.js      pickSession, windowPanel
  src/board.js          buildBoard(input, { fetch, now }) -> output contract
scripts/build-trmnl.js  concatenates src/*.js into transform.js and appends run()
tests/trmnl/harness.js  loadSettings, renderPollingUrl, renderFull (liquidjs), loadTransform (vm)
tests/trmnl/preview.js  writes one HTML page per render case
tests/trmnl/formCheck.js local only: compares the form with values read from the Tredict app
tests/trmnl/*.test.js
tests/fixtures/tredict/ synthetic Tredict responses
tests/fixtures/trmnl/   run-window responses for the plugin cases (live API shape, Amsterdam)
```

Module rules (Task 2 enforces them): each `src/*.js` has no `require` other than statements of the form
`const { a, b } = require('./other');` (Prettier may wrap them over several lines), declares top-level names uniquely
across all modules, and ends with one `module.exports = { ... };` statement (also possibly wrapped). The build strips
both with multi-line patterns (`/^const \{[^}]*\} = require\([^)]*\);\n/gm`, `/^module\.exports = \{[^}]*\};\s*$/m`),
concatenates the modules that exist in the order strings, time, settings, tredict, week, form, runWindow, board, and
appends:

```js
async function run(input) {
  return buildBoard(input, { fetch, now: Date.now() });
}
```

---

### Task 1: Answer the "Verify first" questions — done 2026-11-03

Answers in `docs/superpowers/specs/2026-11-03-trmnl-running-board-verify.md` (commit 5c9402d); real responses in
`tests/fixtures/private/{planned,activities,efforts}.json`. V10 is answered in Task 12. The two probe plugins
(`probe-rw-serverless`, `probe-rw-errors`) are deleted by the maintainer.

---

### Task 2: Scaffold, build script and harness

**Files:**
- Create: `scripts/build-trmnl.js`, `tests/trmnl/harness.js`, `tests/trmnl/build.test.js`,
  `integrations/trmnl-running-board/full.liquid` (placeholder: root element and `{{ fetchedAtText | escape }}`),
  `integrations/trmnl-running-board/src/board.js` (placeholder `buildBoard` returning
  `{ v: 1, fetchedAt, fetchedAtText: '' }` from `now`)
- Modify: `package.json` (devDependencies `liquidjs` ^10.30.1, `js-yaml` ^5.5.0; script
  `"build:trmnl": "node scripts/build-trmnl.js"`), `eslint.config.js` if `integrations/**` needs Node globals,
  `.github/workflows/ci.yml` (after the CSS check: `npm run build:trmnl`, then
  `git diff --exit-code integrations/trmnl-running-board/transform.js`), `eslint.config.js` and `.prettierignore`
  (ignore `transform.js`)

**Interfaces:**
- Produces: `build({ srcDir }) -> string` (the `transform.js` text) and a CLI that writes it.
- Produces, in the harness: `loadSettings() -> object`; `renderPollingUrl(fieldValues) -> Promise<string>` (liquidjs,
  fields as top-level names); `renderFull(output) -> Promise<string>` (liquidjs with the output's keys as top-level
  names, `append_random` with a fixed `-test` suffix); `loadTransform({ fetch, now }) -> run` (runs the built file in a
  `vm` context with `fetch`, `AbortSignal`, `Intl`, `URLSearchParams`, `setTimeout`, `clearTimeout` and a `Date` whose
  `now()` and `new Date()` return `now`; `Date.parse`, `Date.UTC` and `new Date(arg)` behave normally). Compare its
  results with `toEqual` after a `JSON.parse(JSON.stringify(...))` round trip (vm objects fail `toStrictEqual`).

- [ ] **Step 1: Write `tests/trmnl/build.test.js`**
  - `build()` starts with `// Generated by scripts/build-trmnl.js from src/. Do not edit.`, contains no `require(` and
    no `module.exports`, and ends with the `run` function above.
  - Top-level names are unique across `src/*.js`; each file ends with one `module.exports = { … };` statement.
  - `transform.js` contains no `console.` and no `.message`.
  - The committed `transform.js` equals `build()`; `settings.yml` (once it exists), `full.liquid` and `transform.js` are
    each ≤ 100 * 1024 bytes.
  - `loadTransform({ fetch: async () => { throw new Error('x'); }, now: Date.parse('2026-11-04T10:00:00Z') })` gives a
    `run` whose result has `v: 1` and `fetchedAt: '2026-11-04T10:00:00.000Z'`.
  - `renderFull({ fetchedAtText: '<b>' })` contains `&lt;b&gt;`.
- [ ] **Step 2:** Run `npx jest tests/trmnl/build.test.js`; expect failures.
- [ ] **Step 3:** Write the build script, the harness (take `createEngine` and `loadSettings` from eu-dayahead's
  `tests/trmnl/harness.js`), the placeholders.
- [ ] **Step 4:** Run `npm run build:trmnl && npx jest tests/trmnl && npm run lint && npm run format:check`; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): scaffold the transform build and test harness`.

---

### Task 3: Settings and the polling URL

**Files:**
- Create: `integrations/trmnl-running-board/settings.yml`, `src/settings.js`, `tests/trmnl/settings.test.js`

**Interfaces:**
- Produces: custom field keys `tredict_token` (`password`), `lat_lon` (`lat_lon`), `availability`, `dark`, `rain`,
  `sport`, `language`.
- Produces: `readSettings(input) -> { token, lat, lon, availability, dark, rain, sport, language, hasLocation }` from
  `input.trmnl.plugin_settings.custom_fields_values`, defaults applied, `lat`/`lon` rounded to 2 decimals (numbers or
  `null`), never throwing on a missing or malformed input.
- Produces: `windowUrl(settings) -> string|null` (`null` without a location). `readSettings` removes spaces from `availability`.

`settings.yml`: `strategy: polling`, `polling_verb: get`, no `polling_headers`, `framework_version: 3.4.0`,
`refresh_interval: 30`, `dark_mode: 'no'`, `no_screen_padding: 'yes'`, fields as in the spec's Settings table (the
token's help text: Tredict → Settings → Personal API, scope `activityRead` only, open the Tredict app every 10 days).
Polling URL (one line):
`https://run.xadi.eu/api/window?{% assign ll = lat_lon | split: ',' %}{% if ll.size == 2 %}lat={{ ll[0] | strip | round: 2 }}&lon={{ ll[1] | strip | round: 2 }}&{% endif %}avail={{ availability | default: '07-09,12-14,17-21' | remove: ' ' | url_encode }}&dark={{ dark | default: 'avoid' }}&rain={{ rain | default: '40' }}`

- [ ] **Step 1: Write `tests/trmnl/settings.test.js`**
  - Every select option value is quoted in the raw YAML; defaults: availability `07-09,12-14,17-21`, dark `avoid`,
    rain `40`, sport `running`, language `device`; `refresh_interval` 30; no `polling_headers` key or an empty one.
  - The token field is `password` and its help text mentions `activityRead` and 10 days.
  - `renderPollingUrl({ lat_lon: '52.373187,4.892241', availability: '07-09, 17-21', dark: 'avoid', rain: '40' })` is
    `https://run.xadi.eu/api/window?lat=52.37&lon=4.89&avail=07-09%2C17-21&dark=avoid&rain=40`, and equals
    `windowUrl(readSettings(...))` for the same values; same for `lat_lon: '-33.8688, 151.2093'`.
  - The API accepts it: `parseWindowQuery` (from `lib/params.js`) on that URL's query returns without throwing and
    with two `avail` ranges.
  - Empty `availability`, `dark` and `rain` render the defaults, and `readSettings` gives the same values.
  - Without `lat_lon` (or `'abc'`) the URL has no `lat=`; `readSettings` gives `hasLocation: false` and `windowUrl`
    `null`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Write `settings.yml` and `src/settings.js`. `windowUrl` encodes `avail` the way Liquid's `url_encode`
  does (`encodeURIComponent` with `%20` → `+`).
- [ ] **Step 4:** Build, run the tests, lint, format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): add the settings and the polling URL`.

---

### Task 4: Strings and time helpers

**Files:**
- Create: `src/strings.js`, `src/time.js`, `tests/trmnl/strings.test.js`, `tests/trmnl/time.test.js`

**Interfaces (Produces):**
- `STRINGS: { en, nl }` with identical keys; `resolveLanguage(setting, locale) -> 'en'|'nl'` (same rules as
  eu-dayahead's: explicit `en`/`nl` win, case-insensitive; `device` uses the locale's language; anything else `en`);
  `fill(template, values) -> string`; `conditionsText(window, lang) -> { sky, wind, temp }`;
  `formatKm(meters, lang) -> '8.2'|'8,2'`; `formatDuration(seconds) -> 'h:mm'`; `formatPace(sPerKm) -> 'm:ss'`.
- `localDate(ms, tz) -> 'YYYY-MM-DD'`; `localTime(ms, tz) -> 'HH:MM'`; `addDays(date, n) -> date`;
  `weekDates(date) -> string[7]` (Monday first); `isoWeek(date) -> number`; `dayOfWeek(date) -> 0..6` (Monday 0);
  `zonedMidnight(date, tz) -> ms`; `availabilityEnd(avail, date, tz) -> ms` (end of the last range that local day;
  `24` means the next midnight). All via `Intl.DateTimeFormat('en-US', …).formatToParts`.

- [ ] **Step 1: Write the tests**
  - `en` and `nl` have the same keys, none empty; keys cover the spec's "Language" list, the error messages in the
    spec's "Errors and empty states", day abbreviations (Mo…Su / ma…zo) and "WEEK" / "WEEK".
  - `resolveLanguage('device', 'nl-NL') === 'nl'`, `('device', 'fr') === 'en'`, `('EN', 'nl') === 'en'`,
    `(null, null) === 'en'`.
  - `conditionsText({ qualifies: true, precipProbMax: 20, windAvg: 18, windFromCardinal: 'SW', apparentTempAvg: 7.6 })`:
    en `{ sky: 'dry', wind: '18 km/h SW', temp: '8°C' }`, nl `{ sky: 'droog', wind: '18 km/u ZW', temp: '8°C' }`;
    `precipProbMax: 30` → `rain 30%` / `regen 30%`; `qualifies: false, precipProbMax: 10` → `rain 10%`;
    `apparentTempAvg: -0.4` → `0°C`.
  - `formatKm(8150, 'nl') === '8,2'`; `formatDuration(6120) === '1:42'`; `formatPace(341) === '5:41'`.
  - `localDate(Date.parse('2026-11-01T23:30:00Z'), 'Europe/Amsterdam') === '2026-11-02'`;
    `2026-10-24T22:30:00Z` → `2026-10-25`; `2026-10-25T22:30:00Z` → `2026-10-25` (Review Focus 3).
  - `weekDates('2026-11-08')[0] === '2026-11-02'`; `isoWeek('2026-11-04') === 45`; `isoWeek('2027-01-01') === 53`.
  - `availabilityEnd('07-09,17-21', '2026-11-04', 'Europe/Amsterdam') === Date.parse('2026-11-04T20:00:00Z')`;
    `'20-24'` → `2026-11-04T23:00:00Z`; on `2026-03-29` `'17-21'` → `2026-03-29T19:00:00Z`.
  - The time tests pass under `TZ=UTC` and `TZ=Pacific/Auckland` (step 4 runs them twice).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `TZ=UTC npx jest tests/trmnl/time.test.js && TZ=Pacific/Auckland npx jest tests/trmnl/time.test.js`,
  then the build, all tests, lint, format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): add strings and time helpers`.

---

### Task 5: Tredict client and synthetic fixtures

**Files:**
- Create: `src/tredict.js`, `tests/fixtures/tredict/{planned,activities,efforts}-week.json`,
  `tests/fixtures/tredict/{planned,activities}-dst.json`, `tests/trmnl/tredict.test.js`, `tests/trmnl/fixtures.test.js`

**Interfaces:**
- Consumes: `zonedMidnight`, `weekDates`, `addDays` (Task 4).
- Produces: `TREDICT_BASE = 'https://www.tredict.com/api/oauth/v2/'`; `tredictRange(now, tz) -> { from, to }` (UTC ISO,
  the day before this local Monday 00:00 to the end of the day after next Monday); `tredictUrls(range) -> { plan,
  activities, efforts }`; `fetchJson(fetch, url, token, timeoutMs = 3000) -> Promise<{ ok: true, data } | { ok: false,
  kind: 'auth'|'payment'|'unavailable', status: number|null }>` (401/403 → `auth`, 402 → `payment`, other non-2xx,
  timeout, network error or a body that isn't JSON → `unavailable`; never rejects). Headers `Authorization: Bearer
  {token}` and `Accept: application/json;charset=UTF-8`. With no token: `{ ok: false, kind: 'auth', status: null }`
  without calling `fetch`.

Synthetic fixtures copy the shapes in the verify answers. The week of 2026-11-02 in `Europe/Amsterdam`: a done run
(plan with `executedTrainingId`, activity with `summary` incl. `positionLat`/`positionLong` set to Amsterdam centre), a
strength session, a missed run, a rest day, two sessions on Thursday plus a third, a run with no plan, a Garmin
activity with an `attribution`, a plan with distance but no duration, an activity without `heartrate`, and a plan
titled `Tempo </script><b>"x"</b> {{ x }} {% raw %} 🏃`; activities at 23:30 local on Sunday 1 Nov and 00:30 local on
Monday 2 Nov. The DST set: the week of 2026-10-19, activities at 00:30 CEST and 23:30 CET on Sunday 25 Oct. Efforts:
400 days of invented values ending 30 days after 2026-11-04, future ones `[[n, { unconfirmed: true }]]`, some days
with two entries, and today (2026-11-04) holding one confirmed and one `unconfirmed` entry.

- [ ] **Step 1: Write the tests**
  - `tredictRange(Date.parse('2026-11-04T10:00:00Z'), 'Europe/Amsterdam')` is
    `{ from: '2026-10-31T23:00:00.000Z', to: '2026-11-10T22:59:59.999Z' }`; Sunday 2026-11-01T22:30Z (23:30 local) gives
    `from: '2026-10-24T22:00:00.000Z'` (Sunday 25 Oct 00:00, still CEST).
  - `fetchJson` with a fake `fetch`: 200 JSON → `ok`; 401 and 403 → `auth`; 402 → `payment`; 500, an HTML 200 body,
    and a rejected promise → `unavailable`; a `fetch` that never resolves with `timeoutMs: 50` → `unavailable` within
    1 s (it must pass the `signal` to `fetch` and also race its own timer); the request carries both headers and the
    token only in `Authorization` (Review Focus 2, 5).
  - `fixtures.test.js`, over `tests/fixtures/tredict/` and `tests/fixtures/trmnl/` only: no file contains `bearer`,
    `token` or an e-mail address, and every `positionLat`, `positionLong`, `lat` and `lon` key holds a value within
    0.01 of 52.37 / 4.89. If `tests/fixtures/private/{planned,activities,efforts}.json` exist: each synthetic twin has
    the same key paths after replacing `YYYYMMDD` keys and array indices with `*`, compared as sets of value types per
    path (optional keys may be missing from either side); and no `id`, `title` or `executedTrainingId` value of a
    synthetic fixture appears in the private files. On a mismatch print only the paths. Skipped without the folder.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement and write the fixtures.
- [ ] **Step 4:** Build, all tests, lint, format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): add the Tredict client and synthetic fixtures`.

---

### Task 6: Week calendar and form

**Files:**
- Create: `src/week.js`, `src/form.js`, `tests/trmnl/week.test.js`, `tests/trmnl/form.test.js`

**Interfaces:**
- Consumes: Task 4 helpers and strings; Task 5 fixtures.
- Produces: `planDay(plan, tz) -> 'YYYY-MM-DD'`; `activityDay(activity, tz) -> 'YYYY-MM-DD'`.
- Produces: `buildWeek({ plans, activities, now, tz, sport }) -> { week, days: Day[7], totals, garmin: string[] }`
  (`now` in ms; today is `localDate(now, tz)`; activities after `now` are ignored),
  with `plans`/`activities` the `_embedded` lists or `[]`,
  `Day = { date, isToday, isPast, items: Item[], more: number }`,
  `Item = { kind: 'done'|'planned'|'missed'|'unplanned', title, sportType, distanceM?, durationS?, paceSPerKm?, heartrate? }`,
  `totals = { doneDistanceM, doneDurationS, plannedDistanceM?, plannedDurationS? }`, at most 2 items per day.
- Produces: `weekView(week, lang) -> output.week` (strings per the contract: `title` "WEEK 45", day `label`, item
  `text` such as `✓ 8.2 km · 5:41 · 142`, `Tempo · 50 min`, missed with `✗ ` prefix, footer
  `18.2 / 42.0 km · 1:42 / 4:30` or done-only when nothing is planned; `garmin` passed through).
- Produces: `FORM_CONSTANTS = { fitnessDays: 42, fatigueDays: 7 }`;
  `formSeries({ efforts, today, back: 42, ahead: 7 }) -> { points: { date, form, planned }[], today: number|null }`,
  where `efforts` is the response's `trainingEfforts` object and `today` a date string; it walks every calendar day
  from the earliest key (load 0 on days without entries) and returns the window from `today − back` to
  `today + ahead`;
  `formChart(series, lang) -> output.form` (360x150 box, `pastPath`/`futurePath` as `M x y L x y …` with numbers to 1
  decimal, `zeroY`, `todayX`, `today` as a signed integer string like `+4` / `−3` / `0`, the y-scale always including
  0, `empty` set and paths `''` when there are no points).

- [ ] **Step 1: Write the tests**
  - `buildWeek` on Wednesday 2026-11-04 12:00 local: Monday `done` with distance, pace and heart rate; the missed plan
    is `missed`; Thursday has 2 items and `more: 1`; the unplanned run shows as `unplanned`; sport `running` drops the
    strength session from items and totals, `all` keeps it; the Garmin attribution is in `garmin`.
  - Monday 2026-11-02 07:00: no `missed`, and done totals hold only the 00:30 Monday activity. Sunday 2026-11-08
    21:00 (the fixture's Sunday plan is done): only `done`/`missed` items.
  - The 23:30 Sunday activity is outside the week of 2 Nov, the 00:30 Monday one is on Monday; in the DST week both
    25 Oct activities, and a plan at 2026-10-25T22:30Z with `timezone: 2`, are on Sunday 25 Oct (Review Focus 3).
  - The plan without duration has no `durationS`; the activity without heart rate has no `heartrate`; `weekView` never
    prints `undefined`, `NaN`, `null` or `0:00` for them. Plans never get a pace.
  - Empty plans and activities → 7 days, no items, footer of zero done totals (Review Focus 4).
  - `weekView` keeps the `</script>` title verbatim in `text` (escaping is the markup's job).
  - `formSeries` with a constant load of 50 for 200 days → final form within 1 of 0; one day of 100 after zeros → form
    that day `100/42 − 100/7` to 6 decimals; future points `planned: true`; a past `unconfirmed` effort is ignored;
    today's confirmed 60 plus `unconfirmed` 80 counts 140.
  - `formSeries` with `{}` → `points: []`, `today: null`; `formChart` of that → paths `''`, `empty` "No training data
    yet" (Review Focus 4). A normal series → both paths start with `M`, contain no `NaN`, and all x in 0..360, y in
    0..150.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Activity pace: `summary.pace` if present, else duration ÷ distance; never for plans.
- [ ] **Step 4:** Build, all tests, lint, format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): build the week calendar and the form graph`.

---

### Task 7: Run window panel

**Files:**
- Create: `src/runWindow.js`, `tests/fixtures/trmnl/window-*.json`, `tests/trmnl/runWindow.test.js`

**Interfaces:**
- Consumes: `availabilityEnd`, `localDate`, `localTime`, `addDays`, `planDay`, `conditionsText`, `STRINGS`, `fill`.
- Produces: `pickSession({ plans, now, tz, avail, sport }) -> { day: 'today'|'tomorrow', date: 'YYYY-MM-DD', minutes, reason:
  'planned'|'noDuration'|'noPlan'|'unknown', overLimit }`, `plans` `null` when Tredict failed, `tz` the API's
  `location.timezone`.
- Produces: `windowPanel({ body, status, session, lang, hasLocation }) -> output.run`, where `body` is the run-window
  response (or `null`) and `status` the HTTP status of the script's own retry (or `null`).

`pickSession`, in order:
1. `plans` is `null` → today unless past today's hours, else tomorrow; 60; `unknown`.
2. Past today's hours = `now > availabilityEnd(avail, today, tz)`.
3. Remaining today = plans whose `planDay` is today, of the sport, without `executedTrainingId`, earliest first.
4. Not past and a remaining plan → today, that plan.
5. Else the first plan of the sport tomorrow → tomorrow, that plan.
6. Else `noPlan`, 60: today if not past and no plan of the sport today, else tomorrow.
Minutes = `duration / 60` rounded up to 15, min 15; over 180 → 180 with `overLimit`; no or zero duration →
`noDuration`, 60.

`windowPanel`: no location → `noLocation`; `body` without `days` → `badSettings` when `status` is 400, else `error`.
Otherwise the `days[i]` whose `date` is `session.date` (none matches → `error`), then `windows[String(minutes)]`; if null, the
longest shorter non-null key (`shorter`), else `fallback` (`fallback`), else `none`. Heading: "Best time today" /
"TOMORROW" (heading words per the Decisions), then the length ("60 min", plus "(no duration planned)", "no session planned" or "doesn't fully fit"
where they apply). Lines: `HH:MM–HH:MM` in `location.timezone`; `sky · wind · temp`; "start into the wind
({cardinal})"; "dark after HH:MM" when that day's `sunset` is not null; "weather may be out of date" when `warnings`
includes `stale_data`.

- [ ] **Step 1: Write the tests** (fixtures: trimmed live API shape, Amsterdam)
  - Wednesday 10:00, 52-minute plan → today, 60; 200 minutes → 180, `overLimit`, heading has "doesn't fully fit"; no
    duration → 60, `noDuration`, heading has "no duration planned".
  - Today's run done, or a rest day with a plan tomorrow → tomorrow, heading "TOMORROW"; 21:30 with `07-09,17-21` and
    a plan today → tomorrow; nothing planned today or tomorrow at 10:00 → today, `noPlan`, heading has "no session
    planned"; same at 21:30 → tomorrow.
  - `plans: null` → 60, `unknown`, heading "Best time today · 60 min" without "no session planned".
  - Sunday with a plan next Monday → tomorrow uses it.
  - `days[0].date` yesterday (cached across midnight) → the panel uses the entry for today; no entry for the
    session's date → `error`.
  - Window present → `window`, lines include `12:15–13:15`, `dry · 18 km/h SW · 8°C`, "start into the wind (SW)";
    nl → `droog · 18 km/u ZW · 8°C` and "(ZW)".
  - `"90"` null and `"45"` present → `shorter`, heading "Only 45 min fits your hours"; only `fallback` → heading "No
    dry window. Least bad 60 min:", sky never "dry"; neither → `none`, "No dry window in your hours".
  - `stale_data` → "weather may be out of date"; `sunset: null` → no "dark after".
  - `body: null` with status 503, 429 or `null` → `error` "Weather unavailable"; 400 → `badSettings`; no location →
    `noLocation`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Build, all tests, lint, format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): choose the run window session and wording`.

---

### Task 8: Board orchestration

**Files:**
- Modify: `src/board.js`
- Create: `tests/trmnl/board.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `buildBoard(input, { fetch, now }) -> Promise<output>` per the output contract.

Steps inside `buildBoard`, wrapped so nothing can throw (a top-level `try` returns the error output with
`fetchedAt`): read settings; language from the setting and `trmnl.user.locale`; user timezone; start in parallel the
three Tredict calls and, when the polled body (the input's own top-level keys) has no `generatedAt` and a location is
set, a retry of `windowUrl(settings)` via `fetch` with the same 3 s timeout; build `tredict`, `week`, `form`, `run`,
`attribution` (Garmin names joined with `·`, then the API's `attribution` when a window shows).

Tredict state: any `auth` → `auth` with the token message, `week`/`form` `null`; else any `payment` → `payment`; else
any `unavailable` (including efforts with no keys) → `stale` per the Decisions (previous output with `v: 1`, panels
present, `tredictAt` on today's local date; `tredictAt`/`tredictAtText` copied), otherwise `unavailable` with `null`
panels; else `ok` with `tredictAt = fetchedAt`. Plans for `pickSession` are `null` unless the plan call succeeded.
`attribution` uses `week.garmin` (fresh or reused). The top-level `catch` returns fixed strings only.

- [ ] **Step 1: Write `tests/trmnl/board.test.js`** (fake `fetch` routing by URL to fixtures; `now` 2026-11-04T11:00Z)
  - Normal: `tredict.state` `ok`, `week.title` "WEEK 45", 7 days, `form.today` a signed integer string, `run.kind`
    `window`, `attribution` contains the Garmin text and "Open-Meteo"; `fetchedAtText` `12:00`.
  - The output JSON contains no `positionLat`, `summary`, `Bearer` or the token value, and is under 10 KB.
  - Tredict 401 on any one call → `auth`, `week` and `form` `null`, `run` still `window` with heading "… · 60 min"
    (plans unknown). 402 → `payment`.
  - Efforts 503, others 200 → `stale` from a previous output given as `previous_merge_variables`, message contains
    its `tredictAtText`, and its Garmin attribution is kept; two failures in a row keep the first `tredictAt`; a
    previous output whose `tredictAt` was yesterday → `unavailable`; without a previous output → `unavailable`;
    efforts `{ trainingEfforts: {} }` → treated as unavailable (Review Focus 2).
  - Polled body `{}` and the retry answering 400 → `run.kind` `badSettings`; retry 503 → `error`; the retry is not
    made when the polled body has `generatedAt`, nor when the previous output's `run.kind` was `error` less than 30
    minutes ago.
  - A previous output with `form.pastPath` `'M 0 0"/><script>'` is reused with that path replaced by `''`.
  - Review Focus 5: `buildBoard({}, …)`, `buildBoard({ trmnl: null }, …)`, `fetch` rejecting, `fetch` returning `'<html>'`
    as text, and a never-resolving `fetch` all resolve (the last within 4 s via a 3000 ms timeout; run it with a
    shortened timeout parameter if the implementation exposes one) to an object with `v: 1` and `fetchedAt`.
  - The built `transform.js`, run via `loadTransform`, returns the same output as `buildBoard` for the normal case.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Build, all tests, lint, format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): assemble the board in the transform script`.

---

### Task 9: The screen

**Files:**
- Modify: `integrations/trmnl-running-board/full.liquid`
- Create: `tests/trmnl/render.test.js`

**Interfaces:**
- Consumes: the output contract (Task 8), `renderFull` (Task 2).

Layout per the spec's Screen section: left column (~45%) with `week.title`, seven rows (today inverted, white on
black), `more`, footer; right top `form.heading`, `form.today` large, an inline `<svg viewBox="0 0 360 150">` with the
zero line, `pastPath` solid (stroke 3), `futurePath` dashed, a today marker, and the three labels; right bottom
`run.heading` and `run.lines`. When `tredict.state` is `auth`, `payment` or `unavailable`, the left column and graph
show `tredict.message` instead; `stale` shows the panels plus the message. Footer line: `attribution` and "data
{fetchedAtText}". Only TRMNL framework classes plus a small `<style>`; black and white only.

- [ ] **Step 1: Write `tests/trmnl/render.test.js`** (outputs from Task 8's cases, via `buildBoard`)
  - Normal: 7 rows Monday first, today's row has the inverted class, "WEEK 45", the footer totals, "Form (est.)", the
    run window lines, the attribution, `data 12:00`.
  - The `</script>` title appears as `&lt;/script&gt;` and `{{ x }}` / `{% raw %}` as text; the rendered HTML has no
    `<script` at all (Review Focus 1). Assertions on escaped quotes accept both `&quot;` and `&#34;` (Ruby Liquid and
    liquidjs differ).
  - A day with no items shows "—".
  - Every `{{ … }}` in `full.liquid` that prints a string ends in `| escape` (a test reads the template and checks each
    output tag, allowing only `pastPath`, `futurePath`, `zeroY`, `todayX` without it).
  - `auth`, `payment`, `unavailable`, `stale`: the message shows; the run window still shows.
  - Empty account: "No training data yet", and no `NaN`, `undefined` or `null` text in the HTML (Review Focus 4).
  - `lang: 'nl'` output → Dutch text in the HTML.
  - No colour other than black and white in the template (`#000`, `#fff`, `black`, `white`, framework classes).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Typography and spacing are left to the builder, readable from a few metres in 1-bit.
- [ ] **Step 4:** Build, all tests, lint, format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): render the running board`.

---

### Task 10: Browser preview

**Files:**
- Create: `tests/trmnl/preview.js` (adapted from eu-dayahead's)

- [ ] **Step 1:** For each render case of Task 9, write an 800x480 HTML page (with TRMNL's framework CSS 3.4.0 from its
  CDN, as eu-dayahead's preview does) to the folder given as the argument.
- [ ] **Step 2:** Run `node tests/trmnl/preview.js <scratch dir>`; open the normal, `auth` and empty pages in a browser;
  check nothing overflows 800x480 and the text is legible as 1-bit (screenshot converted to black and white).
- [ ] **Step 3:** Lint, format check; commit `test(plugin): add a browser preview of the render cases`.

---

### Task 11: Docs

**Files:**
- Modify: `CLAUDE.md` (Status; `build:trmnl`; the transform script and its constraints), `readme.md` (plugin line)
- Create: `integrations/trmnl-running-board/README.md`: install as a private plugin (import `settings.yml`,
  `full.liquid`, `transform.js`; the runtime stays on the default), the settings, the token rule, the privacy
  sentence (token goes to Tredict only), a device refresh of 30 minutes or less (the screen shows the last image
  until then), and that publishing waits for Tredict.

- [ ] **Step 1:** Write them.
- [ ] **Step 2:** `npm run format:check`; commit `docs(plugin): document installing the running board`.

---

### Task 12: Install, check against Tredict, and the API's TRMNL check

Controller with the maintainer.

**Files:**
- Create: `tests/trmnl/formCheck.js`
- Modify: the verify answers file (V10, scheduled runs), `docs/superpowers/plans/2026-11-02-run-window-api.md` (tick
  Task 13 Step 5)

- [ ] **Step 1:** Install on the maintainer's account as a private plugin with real settings (the maintainer enters
  the token). Preview on `og_plus`; check every panel against Tredict's app. After a scheduled poll (not a forced
  refresh), check the plugin's logs show the transform ran, and count runs per hour (Tredict load); the next
  morning, check today's row moved. Once, with a temporary `timings` field (removed afterwards), record how long each
  Tredict call takes; if activities nears 3 s, note it as a follow-up.
- [ ] **Step 1b:** Record what a paused token returns: either the maintainer leaves the Tredict app unopened for 10
  days with the board running, or asks Tredict. Update the error mapping if it is not 401/403.
- [ ] **Step 2:** `formCheck.js` reads `tests/fixtures/private/efforts.json` and
  `tests/fixtures/private/form-from-app.json` (`{ "YYYY-MM-DD": number }`, typed in by the maintainer) and prints the
  difference per date for the default constants, other starting values and a one-day offset. It exits 0 with a
  message if the files are absent. Record V10 without values; if it differs materially, keep "(est.)" and note it.
- [ ] **Step 3:** API Task 13 Step 5: in Better Stack, a TRMNL request to `/api/window` shows a rounded location; no
  token is involved any more.
- [ ] **Step 4:** Commit `docs(plugin): record the install checks`.

Then two weeks of use (spec rollout step 3) before any recipe, and only if Tredict has agreed.
