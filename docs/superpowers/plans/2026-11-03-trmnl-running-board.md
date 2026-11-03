# TRMNL Running Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private TRMNL plugin that shows this week's Tredict training, an estimated form graph and today's run window
on one full 800x480 screen.

**Architecture:** The display logic lives in small browser-safe JS modules under `integrations/trmnl-running-board/src/`,
unit-tested with Jest in Node. A build script inlines them into `shared.liquid`, which embeds the polled responses in
HTML attributes and renders the screen. A liquidjs + `vm` harness, copied from eu-dayahead, renders the real templates
against fixtures.

**Tech Stack:** Liquid (TRMNL, framework 3.4.0), plain ES2023 browser JS, Highcharts 12.3.0 from TRMNL's CDN, Jest,
liquidjs, js-yaml.

**Spec:** `docs/superpowers/specs/2026-11-02-trmnl-running-board-design.md` (approved 2026-11-03).

## Global Constraints

- Node >= 22, CommonJS for Node files, Jest, ESLint + Prettier: single quotes, semicolons, 2-space indent, no trailing
  commas, max 120 cols. Every task ends with `npm run lint && npm run format:check` passing.
- Plugin files (`settings.yml`, `shared.liquid`, `full.liquid`) are each ≤ 100 KB. Only the `full` layout in v1.
- No weather logic in the plugin: every window, rain chance and wind value comes from the run-window API response.
- Conditions wording mirrors the API's `lib/labels.js`: "dry" / "droog" only when `qualifies` is true and
  `precipProbMax <= 20`, otherwise "rain N%" / "regen N%"; speed `km/h` / `km/u`; nl compass points NO, O, ZO, Z, ZW
  for NE, E, SE, S, SW (others unchanged); temperature `Math.round(apparentTempAvg) || 0` then `°C`.
- The form is always labelled "Form (est.)" / "Vorm (schatting)".
- Committed Tredict fixtures are synthetic: Tredict's structure, invented ids, dates, titles, notes and metrics, no
  token. Real responses only in the gitignored `tests/fixtures/private/`; `npm test` passes without it, and no test
  prints a value from it.
- No token, real coordinate or personal name anywhere in the repo or sent to a third party. Examples and probes use
  Amsterdam centre (52.37, 4.89).
- Quote every select value in `settings.yml`.
- 1-bit output: black and white only, animations off, element IDs via `append_random`.
- Strings in en and nl; unsupported locales fall back to en. Times and numbers via `Intl` in the resolved language.
- Every text from Tredict or the API reaches the DOM through `escapeHtml`, which escapes `& < > " '`.
- Garmin `attribution` text is shown whenever a shown activity has `isFromGarminApi: true`; the API's `attribution` is
  shown whenever the run window is shown.

## Review Focus

1. Tredict text containing `<`, `</script>`, quotes, `{{` or emoji in a title or note → shown as plain text, page intact.
2. A Tredict 5xx, timeout, HTML body or 402 on one of IDX 0–2 (not 401/403) → that data's panel says so, the rest
   renders.
3. Day boundaries: an activity at 23:30 local on Sunday and one at 00:30 local on Monday land on the right days and
   weeks, including the week of the DST change (2026-10-25).
4. A new account (no efforts, no activities, no plans) → empty states, never `NaN`, `undefined` or a blank graph.
5. Optional fields missing (a plan with distance but no duration; an activity without heart rate or pace) → that part
   is left out, never printed as `undefined`/`NaN`/`0:00`.

Each has a test in the task that owns the code (marked "Review Focus N").

## Decisions this plan makes

- **The Tredict token never reaches `run.xadi.eu`, not even to be stripped** (maintainer, 2026-11-03). An earlier
  version of this plan always polled the run window as IDX 3; that is withdrawn. Which way the run window arrives
  depends on Task 1:
  - V1 `fetch()` works at render: the markup fetches it, tokenless.
  - V2 per-URL headers exist: poll it as IDX 3 with no headers on that URL.
  - V11 Tredict accepts the token in the query string: no headers field at all, poll it as IDX 3.
  - None of these: open, decided by the maintainer after Task 1. Options: no run window on the board, or the run
    window as its own tokenless private plugin shown next to this one in a TRMNL mashup.
  Freeze risk (V12): TRMNL does not re-render a screen whose merge variables are unchanged (help article "Private
  plugins"). If the run window is fetched (V1) and V12 confirms the skip, the Tredict data alone decides when the screen
  redraws, so the window can freeze on quiet days. If so, the maintainer picks between accepting that, the mashup, or
  another option before Task 2. Task 2 does not start until this paragraph has a single answer, and Tasks 3, 6 and 7
  (written for IDX 3) are updated to match it first.
- **Responses go into HTML attributes, not script text:** `data-json="{{ IDX_0 | json | escape }}"`, read with
  `JSON.parse(el.getAttribute('data-json'))`. `escape` behaves the same in Ruby Liquid and liquidjs; backslash escapes
  in Liquid string literals do not (liquidjs decodes them, Ruby does not), so they can't be tested.
- **Copy for a shorter window:** "Only {n} min fits your hours", not the spec's example "Only 45 min dry in your
  hours": a qualifying window can have up to the user's rain limit, so "dry" there could contradict the API's rule.
- **Nothing planned today or tomorrow:** use today while today's hours remain, with "no session planned", because
  nobody planned a rest and today's window is the useful one. A rest day with a plan tomorrow still shows tomorrow, as
  the spec says.
- **Plans unknown (IDX 0 failed):** 60 minutes, heading without a session claim ("60 min"), never "no session
  planned".
- **Tredict range:** IDX 0 asks from the day before this local Monday to the day after next Monday, and the JS filters
  by local date. This covers tomorrow on a Sunday, and makes an offset or DST error in the URL harmless.
- **Timezones:** the calendar and the form use the user's timezone (TRMNL variable per V4; else the API's
  `location.timezone`; else `UTC`). The run window panel uses the API's `location.timezone` for "today", "past today's
  hours" and times, and picks the `days[i]` whose `date` matches.
- **Form model:** CTL += (load − CTL)/42, ATL += (load − ATL)/7, form = CTL − ATL of the same day, both starting at 0 on
  the first day with data. Load per day: past days confirmed efforts only; today confirmed efforts if any, else
  `unconfirmed` ones (so a done session isn't counted twice); future days `unconfirmed`. The constants are exported so
  V10 can try variants.
- **Missed:** a plan on a past day with no `executedTrainingId`. **Rest day:** a day with no planned session of the
  filtered sport.
- **Source layout:** `src/` is not uploaded to TRMNL; only `settings.yml`, `shared.liquid` and `full.liquid` are.

## File Structure

```
integrations/trmnl-running-board/
  settings.yml                 TRMNL settings: polling URLs, headers, custom fields, refresh
  shared.liquid                GENERATED by scripts/build-trmnl.js; do not edit
  full.liquid                  one call: window.renderRunningBoard({ ... sizes })
  src/shared.template.liquid   markup, styles, data attributes; `/* @modules */` marks where modules go
  src/strings.js               STRINGS (en, nl), resolveLanguage, fill, escapeHtml
  src/time.js                  local-date helpers, ISO week, availability end
  src/responses.js             normalise a polled value into ok/error
  src/week.js                  calendar rows and footer totals
  src/form.js                  daily load and form series
  src/runWindow.js             which day, which length, what the panel says
  src/render.js                DOM output and the Highcharts config; defines window.renderRunningBoard
scripts/build-trmnl.js         inlines src/*.js into shared.liquid
tests/trmnl/harness.js         liquidjs + vm harness (from eu-dayahead): IDX_0..3, fixed clock, data attributes
tests/trmnl/preview.js         writes one HTML page per case, for a real-browser check
tests/trmnl/formCheck.js       local only: compares form with values read from the Tredict app
tests/trmnl/*.test.js          unit and render tests
tests/fixtures/tredict/        synthetic Tredict responses
tests/fixtures/trmnl/          run-window responses for the plugin cases (live API shape, Amsterdam)
docs/superpowers/specs/2026-11-03-trmnl-running-board-verify.md   answers to V2–V10
```

Module rules (Task 2 enforces them): each `src/*.js` file has no `require` other than lines of the form
`const { a, b } = require('./other');`, declares its top-level names (functions, `const`, `let`) uniquely across all
modules, contains no `{% endraw`, and ends with exactly one line
`if (typeof module !== 'undefined') module.exports = { ... };`. The build strips both kinds of line and concatenates
the modules, in the order strings, time, responses, week, form, runWindow, render, into one IIFE wrapped in
`{% raw %}` … `{% endraw %}`, so `{{` in module text is never parsed as Liquid.

---

### Task 1: Answer the "Verify first" questions

Run by the controller with the maintainer, not by a subagent: it needs the maintainer's TRMNL account, the TRMNL MCP
tools and a Tredict token. Only the answers file is committed; it holds no token, coordinates, dates or training
values, only names, shapes and yes/no answers.

Rules for every probe: a fresh private plugin per step (deleted after), a unique nonce query parameter in every URL
(TRMNL can keep stale data at an index when URLs change), Amsterdam coordinates only, and a headers field with
`x-probe=1` only. Third-party echo: `https://httpbin.org/anything`. Once the token is in a plugin, the controller reads
that plugin's merge variables only, never its settings (they may return field values).

**Files:**
- Create: `docs/superpowers/specs/2026-11-03-trmnl-running-board-verify.md`

- [ ] **Step 1 (V2, V4, V5, V6):** One plugin with a `lat_lon` field set by searching "Amsterdam", and polling URLs to
  httpbin that echo: the TRMNL time and offset variables (try `trmnl.system.timestamp_utc`, `trmnl.user.utc_offset`,
  `trmnl.user.time_zone_iana`); `0 | date: '%Y-%m-%dT%H:%M:%S%z'`; `7 | divided_by: 2`; `7 | modulo: 3`; the Task 3
  week-start formula; the raw `lat_lon` value; `split` + `round: 2` of it; and `'07-09, 17-21' | url_encode`. Read the
  echoes with `getMergeVariables`. Record the variable names, whether epochs format in UTC, whether `divided_by` on
  integers truncates, the `lat_lon` format, and whether headers can be set per URL.
- [ ] **Step 2 (V3):** One plugin per sequence, each with line 1 a 200 (`run.xadi.eu/api/window?lat=52.37&lon=4.89`)
  and line 2 one of: httpbin `/status/400`, `/status/401`, `/status/503`, `/delay/30`, `/html`. Record what `IDX_1`
  contains and whether the render ran. Then one plugin whose line 2 succeeds once and then fails (switch the httpbin
  path between polls): record whether `IDX_1` keeps the last good data, and whether TRMNL pauses a plugin after
  repeated errors. Also record what `{{ IDX_0 | json }}` emits for a string containing `</script>` (httpbin
  `/anything?t=%3C/script%3E`).
- [ ] **Step 2b (V1, V12):** V1: a plugin polling a static httpbin body, whose markup fetches
  `run.xadi.eu/api/window?lat=52.37&lon=4.89` and prints its `generatedAt` next to a render-time stamp; screenshot it
  and record whether the fetch result appears and how long the renderer waits. V12: refresh the same plugin twice with
  the polled body unchanged and compare the render-time stamps. Record whether the refresh was forced or scheduled, since
  a forced refresh may not follow the scheduled skip rule.
- [ ] **Step 3 (V7, V8, V9, V11, scopes):** The maintainer adds their real token in a `password` field and reports
  whether it is masked. Poll the three Tredict URLs once with the real headers. Record whether each returns 200 with
  the `activityRead` scope alone (a 403 changes the help text and the 403 message). V11: poll `plannedTrainingList`
  once with the token as a query parameter (`access_token=`) and no headers, and record the status. Record whether `IDX_2` (efforts) arrived complete
  and its size in KB. The maintainer saves one real response of each to `tests/fixtures/private/` (`planned.json`,
  `activities.json`, `efforts.json`) and records, without values: the `extendedSummary=1` key names; whether a plan's
  `date` is UTC and how `timezone` relates to its local day; whether activities carry a timezone; whether rest days or
  notes appear in `plannedTrainingList`; and whether a done session appears in efforts both confirmed and
  `unconfirmed` on the same day.
- [ ] **Step 4:** Write the answers file: one row per V1–V9, V11, V12 and the scope check, with the answer, the evidence, and the branch later tasks
  take. V10 is answered in Task 10. Delete the probe plugins.
- [ ] **Step 5:** Commit `docs(plugin): record the TRMNL and Tredict verify answers`.

Later tasks read this file. Where they say "per V3" and similar, they implement the answer recorded here.

---

### Task 2: Scaffold, build script and harness

**Files:**
- Create: `scripts/build-trmnl.js`, `tests/trmnl/harness.js`, `tests/trmnl/build.test.js`,
  `integrations/trmnl-running-board/src/shared.template.liquid`, `integrations/trmnl-running-board/full.liquid`,
  a placeholder `src/strings.js` (real content in Task 4)
- Modify: `package.json` (devDependencies `liquidjs` ^10.30.1, `js-yaml` ^5.5.0; script
  `"build:trmnl": "node scripts/build-trmnl.js"`), `eslint.config.js` (`integrations/**/src/*.js`: `sourceType: 'script'`,
  browser + node globals), `.github/workflows/ci.yml` (after the CSS check: `npm run build:trmnl`, then
  `git diff --exit-code integrations/trmnl-running-board/shared.liquid`)

**Interfaces:**
- Produces: `build({ srcDir, templatePath }) -> string` (the shared.liquid text) and a CLI that writes it.
- Produces, in the harness:
  - `loadSettings() -> object` (parsed `settings.yml`).
  - `createEngine()`: a liquidjs engine with `timezoneOffset: 0` (TRMNL formats epochs in UTC unless V4 says
    otherwise), `append_random` (fixed `-test` suffix) and `json` (`JSON.stringify(value ?? null)`) filters.
  - `variables({ idx, fieldValues, user, now })`: `IDX_0`…`IDX_3` from `idx`, settings as top-level names and under
    `trmnl.plugin_settings.custom_fields_values`, `trmnl.user` from `user`, and `now` (ISO) exposed under the time
    variable names V4 recorded. Liquid never reads `'now'`.
  - `renderPollingUrls({ fieldValues, user, now }) -> Promise<string[]>`: renders `polling_url` and splits it on line
    breaks.
  - `renderHtml(layout, { idx, fieldValues, user, now }) -> Promise<string>`.
  - `renderLayout(layout, opts) -> Promise<{ chart, html, elements, errors }>`: runs the inline scripts in a `vm` whose
    `Date` returns `now` for `new Date()` and `Date.now()`. `elements` maps every `id` to a fake element with
    `innerHTML`, `className`, `style`, `dataset`, and `getAttribute(name)` returning the HTML attribute value with
    `&amp; &lt; &gt; &quot; &#39;` decoded. `chart` is the last Highcharts config.

- [ ] **Step 1: Write `tests/trmnl/build.test.js`**
  - `build()` output starts with `{% comment %} Generated by scripts/build-trmnl.js from src/. Do not edit.
    {% endcomment %}`, has the modules between `{% raw %}` and `{% endraw %}` where `/* @modules */` was, and contains
    no `require(` and no `module.exports`.
  - Top-level declared names are unique across `src/*.js`; a temporary module containing `{% endraw` makes `build()`
    throw.
  - Each `src/*.js` file's last non-empty line matches `/^if \(typeof module !== 'undefined'\) module\.exports = \{.*\};$/`.
  - The committed `shared.liquid` equals `build()` output.
  - `settings.yml` (once it exists), `shared.liquid`, `full.liquid` are each ≤ 100 * 1024 bytes.
  - `renderHtml('full', {})` resolves to a string containing the root `id`; a fake element's `getAttribute` decodes
    `&quot;&lt;&#39;` to `"<'`.
- [ ] **Step 2:** Run `npx jest tests/trmnl/build.test.js`; expect failures (no build script).
- [ ] **Step 3:** Write `scripts/build-trmnl.js`, the template (the two Highcharts `<script src>` tags from eu-dayahead,
  a root `<div id="{{ board_id }}">` with `{% assign board_id = 'rb' | append_random %}`, four hidden
  `<div id="{{ board_id }}-idx-N" data-json="{{ IDX_N | json | escape }}">`), and `full.liquid` calling
  `window.renderRunningBoard({})`. Copy eu-dayahead's `tests/trmnl/harness.js` and change it per the interface.
- [ ] **Step 4:** Run `npm run build:trmnl && npx jest tests/trmnl && npm run lint && npm run format:check`; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): scaffold the plugin build and test harness`.

---

### Task 3: Settings and polling URLs

**Files:**
- Create: `integrations/trmnl-running-board/settings.yml`, `tests/trmnl/settings.test.js`

**Interfaces:**
- Consumes: `loadSettings()`, `renderPollingUrls()` from the harness.
- Produces: custom field keys `tredict_token`, `location` (or `lat` + `lon` per V6), `availability`, `dark`, `rain`,
  `sport`, `language`.

Settings as in the spec's table, with types per V6/V7. `strategy: polling`, `polling_verb: get`,
`framework_version: 3.4.0`, `refresh_interval: 30`, `dark_mode: 'no'`, `no_screen_padding: 'yes'`. Headers:
`authorization=bearer {{ tredict_token }}&accept=application/json;charset=UTF-8` (Tredict's documented `Accept`), per
URL if V2 allows. IDX 3: `https://run.xadi.eu/api/window?lat={lat}&lon={lon}&avail={{ availability | url_encode }}&dark={{ dark }}&rain={{ rain }}`,
with `{lat}`/`{lon}` from the location rounded with `round: 2`.

The IDX 0 dates, in Liquid, from the time variable `T` (epoch seconds) and the offset `O` (seconds), names per V4:
`L = T + O`; `D = L | divided_by: 86400` (followed by `| floor` if V4 says `divided_by` doesn't truncate);
`d = D | plus: 3 | modulo: 7`; start = `(D − d − 1) * 86400 − O`; end = start + 10 * 86400 − 1; both formatted
`%Y-%m-%dT%H:%M:%SZ`. If V4 says epochs format in the user's zone, drop `− O` and format with `%z`. If V4 failed
entirely, omit both parameters. If V8 says the efforts response was cut off, IDX 2 adds `?startDate=` 180 days back,
built the same way.

- [ ] **Step 1: Write `tests/trmnl/settings.test.js`**
  - Every select option value is quoted in the raw YAML text; defaults: availability `07-09,12-14,17-21`, dark
    `avoid`, rain `40`, sport `running`, language `device`.
  - `refresh_interval` is 30; `dark_mode` is `'no'`.
  - The token field's help text mentions `activityRead` and the 10-day rule.
  - With `now = 2026-11-04T10:00:00Z` (Wednesday), offset 3600: IDX 0 has
    `startDate=2026-10-31T23:00:00Z&endDate=2026-11-10T22:59:59Z` (local Sunday 1 Nov 00:00 to the end of Tuesday
    10 Nov) and `&sportType=running`; with sport `all` there is no `sportType`.
  - `now = 2026-11-01T23:30:00Z` (Monday 00:30 local) gives the same range; `now = 2026-11-01T22:30:00Z` (Sunday
    23:30 local) gives `startDate=2026-10-24T23:00:00Z`. That is an hour off true local midnight because the week
    crossed the DST change; the extra day on each side absorbs it.
  - These pass under both `TZ=UTC` and `TZ=Pacific/Auckland` (run the test file twice in the step 4 command).
  - IDX 1 is `.../activityList?pageSize=50&extendedSummary=1`; IDX 2 `.../efforts`.
  - IDX 3 with location `52.373187,4.892241` contains `lat=52.37&lon=4.89`, no `lang=`, and availability
    `07-09, 17-21` encoded with no space.
  - No URL contains `{{`, `{%`, a space or the token value.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Write `settings.yml`.
- [ ] **Step 4:** Run `TZ=UTC npx jest tests/trmnl/settings.test.js && TZ=Pacific/Auckland npx jest tests/trmnl/settings.test.js && npm run lint && npm run format:check`;
  expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): add the settings and polling URLs`.

---

### Task 4: Strings, language, time helpers and response normalising

**Files:**
- Create/replace: `src/strings.js`, `src/time.js`, `src/responses.js`; tests `tests/trmnl/strings.test.js`,
  `tests/trmnl/time.test.js`, `tests/trmnl/responses.test.js`

**Interfaces (Produces):**
- `STRINGS: { en: {...}, nl: {...} }` with identical keys; `resolveLanguage(setting, locale) -> 'en'|'nl'` (same rules
  as eu-dayahead's); `fill(template, values) -> string`; `escapeHtml(text) -> string` (escapes `& < > " '`);
  `conditionsText(window, language) -> { sky, wind, temp }` per the Global Constraints wording.
- `localDate(ms, tz) -> 'YYYY-MM-DD'`; `addDays(date, n) -> 'YYYY-MM-DD'`; `isoWeek(date) -> number`;
  `weekDates(date) -> string[7]` (Monday first); `availabilityEnd(avail, date, tz) -> ms` (end of the last range of
  that local day; `24` means next midnight).
- `normalise(value) -> { ok: true, data } | { ok: false, status: number|null }`, implementing what V3 recorded: a value
  that is missing, `null`, not an object, or the recorded error shape is `ok: false`, with the HTTP status when TRMNL
  exposes it.

- [ ] **Step 1: Write the tests**
  - `en` and `nl` have the same keys; no value is empty. Keys cover every string in the spec's "Language" section,
    plus the Task 6 and 7 messages.
  - `resolveLanguage('device', 'nl-NL') === 'nl'`, `('device', 'fr') === 'en'`, `('EN', 'nl') === 'en'`,
    `(null, null) === 'en'`.
  - `escapeHtml('</script><b>"x"\'')` contains none of `< > " '`.
  - `conditionsText` for `{ qualifies: true, precipProbMax: 20, windAvg: 18, windFromCardinal: 'SW', apparentTempAvg: 7.6 }`:
    en `{ sky: 'dry', wind: '18 km/h SW', temp: '8°C' }`, nl `{ sky: 'droog', wind: '18 km/u ZW', temp: '8°C' }`;
    `precipProbMax: 30` → `rain 30%` / `regen 30%`; `qualifies: false, precipProbMax: 10` → `rain 10%`;
    `apparentTempAvg: -0.4` → `0°C`.
  - `localDate(Date.parse('2026-11-01T23:30:00Z'), 'Europe/Amsterdam') === '2026-11-02'`; around the DST change,
    `2026-10-24T22:30:00Z` → `2026-10-25` and `2026-10-25T22:30:00Z` → `2026-10-25` (Review Focus 3).
  - `weekDates('2026-11-08')[0] === '2026-11-02'`; `isoWeek('2026-11-04') === 45`; `isoWeek('2027-01-01') === 53`.
  - `availabilityEnd('07-09,17-21', '2026-11-04', 'Europe/Amsterdam') === Date.parse('2026-11-04T20:00:00Z')`;
    `'20-24'` gives `2026-11-04T23:00:00Z`; on `2026-03-29` (DST start) `'17-21'` gives `2026-03-29T19:00:00Z`.
  - `normalise` returns `ok: true` for a Tredict body and a run-window body; `ok: false` for `undefined`, `null`, a
    string, and each error shape V3 recorded, with its status (Review Focus 2).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with `Intl.DateTimeFormat` only (no libraries in `src/`).
- [ ] **Step 4:** Run the three test files, `npm run build:trmnl`, lint and format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): add strings, time helpers and response checks`.

---

### Task 5: Week calendar and form series

**Files:**
- Create: `src/week.js`, `src/form.js`, `tests/fixtures/tredict/{planned,activities,efforts}-week.json`,
  `tests/trmnl/week.test.js`, `tests/trmnl/form.test.js`, `tests/trmnl/fixtures.test.js`

**Interfaces:**
- Consumes: Task 4's time helpers.
- Produces: `planDay(plan, tz) -> 'YYYY-MM-DD'` (from the plan's own `date` and `timezone` per V9) and
  `activityDay(activity, tz) -> 'YYYY-MM-DD'`.
- Produces: `buildWeek({ plans, activities, today, tz, sport }) -> { week: number, days: Day[7], totals }`, where
  `plans` is `_embedded.plannedWorkoutList` (or `[]`), `activities` is `_embedded.activityList` (or `[]`),
  `Day = { date, isToday, isPast, items: Item[], more: number }`,
  `Item = { kind: 'done'|'planned'|'missed'|'unplanned', title, sportType, distanceM?, durationS?, paceSPerKm?, heartrate?, garmin?: string }`,
  `totals = { doneDistanceM, doneDurationS, plannedDistanceM?, plannedDurationS? }`. At most 2 items per day; `more`
  counts the rest.
- Produces: `formSeries({ efforts, today, back: 42, ahead: 7 }) -> { points: { date, form, planned: boolean }[], today: number|null }`,
  where `efforts` is `trainingEfforts` (or `{}`), and `FORM_CONSTANTS = { fitnessDays: 42, fatigueDays: 7 }`.

Synthetic fixtures: the week of 2026-11-02 in `Europe/Amsterdam` with a done run (linked by `executedTrainingId`), a
strength session, a missed run, a rest day, two sessions on Thursday, a run with no plan, a Garmin activity with an
`attribution`, a plan with distance but no duration, an activity without heart rate, and a title
`Tempo </script><b>"x"</b> {{ x }} 🏃`; plus activities at 23:30 local on Sunday 1 Nov and 00:30 local on Monday
2 Nov. A second set for the week of 2026-10-19 to 2026-10-25 (DST change) with activities at 00:30 CEST and 23:30
CET on Sunday 25 Oct. Efforts: 400 days of invented values ending 30 days ahead, future ones `unconfirmed`, and today
with both a confirmed and an `unconfirmed` entry. Field names per V9 and Tredict's docs.

- [ ] **Step 1: Write the tests**
  - `fixtures.test.js`: no fixture contains `bearer`, `token`, `52.3731` or an e-mail address. If
    `tests/fixtures/private/*.json` exists, each synthetic fixture has the same key paths as its private twin, after
    replacing `YYYYMMDD` keys and array indices with `*`; on a mismatch it prints only the paths, never values
    (skipped otherwise).
  - `buildWeek` on Wednesday 2026-11-04 12:00 local: Monday `done` with distance, pace and heart rate; the missed plan
    is `missed`; Thursday has 2 items and `more: 1` when a third is added; the run with no plan shows as `unplanned`;
    sport `running` drops the strength session from items and totals, `all` keeps it.
  - Monday 2026-11-02 07:00 (nothing done yet: no `missed`, zero done totals) and Sunday 2026-11-08 21:00 (no
    `planned` left, only `done`/`missed`).
  - Plans empty, activities present → the activities show as `unplanned`, no `planned*` totals.
  - The 23:30 Sunday activity is outside the week of 2 Nov, the 00:30 Monday one is on Monday; in the DST week both
    25 Oct activities are on Sunday 25 Oct (Review Focus 3).
  - The plan without duration has no `durationS` key; the activity without heart rate has no `heartrate` key (Review
    Focus 5). Plans never get a pace.
  - The Garmin item carries its `attribution` text.
  - Empty plans and activities → 7 days with no items and zero done totals (Review Focus 4).
  - `formSeries` with a constant load of 50 for 200 days → form within 1 of 0 at the end; one day of 100 after 0s →
    form that day is `100/42 − 100/7`; future points are `planned: true`; a past `unconfirmed` effort is ignored;
    today with a confirmed 60 and an `unconfirmed` 80 counts 60, today with only an `unconfirmed` 80 counts 80.
  - `formSeries` with `{}` → `points: []`, `today: null` (Review Focus 4).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Pace for activities: the summary's pace if present, else duration ÷ distance; never for
  plans.
- [ ] **Step 4:** Run the tests, the build, lint and format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): build the week calendar and the form series`.

---

### Task 6: Run window panel

**Files:**
- Create: `src/runWindow.js`, `tests/fixtures/trmnl/window-*.json`, `tests/trmnl/runWindow.test.js`

**Interfaces:**
- Consumes: `availabilityEnd`, `localDate`, `addDays`, `planDay`, `conditionsText`, `STRINGS`.
- Produces: `pickSession({ plans, now, tz, avail, sport }) -> { day: 'today'|'tomorrow', minutes, reason: 'planned'|'noDuration'|'noPlan'|'unknown', overLimit: boolean }`,
  where `plans` is the plan list or `null` when IDX 0 failed, and `tz` is the API's `location.timezone`.
- Produces: `windowPanel({ result, session, language, hasLocation }) -> Panel`, where `result` is `normalise()` of
  IDX 3 and `Panel = { kind: 'window'|'shorter'|'fallback'|'none'|'error'|'badSettings'|'noLocation', heading, lines: string[] }`.

`pickSession`, in this order:
1. `plans` is `null` → today if not past today's hours, else tomorrow; 60; `unknown`.
2. Past today's hours = `now` > `availabilityEnd(avail, today, tz)`.
3. Remaining today = plans whose `planDay` is today, for the sport, with no `executedTrainingId`, earliest first.
4. Not past and a remaining plan → today, that plan.
5. Else the first plan tomorrow for the sport → tomorrow, that plan.
6. Else → `noPlan`, 60 minutes: today if not past and no plan of the sport today, otherwise tomorrow.
A plan's `minutes` = `duration / 60` rounded up to 15, min 15; over 180 → 180 with `overLimit`. No or zero duration →
`noDuration`, 60.

`windowPanel` picks the `days[i]` whose `date` is the session's day in `location.timezone`, then
`windows[String(minutes)]`; if null, the longest shorter non-null key (`shorter`), else `fallback` (`fallback`), else
`none`. Heading: "Best time today" or "TOMORROW", then the length ("60 min", with "(no duration planned)",
"no session planned" or "doesn't fully fit" when they apply). Lines: `HH:MM–HH:MM` in `location.timezone`; `sky · wind ·
temp` from `conditionsText`; "start into the wind ({cardinal})" with the localised cardinal; "dark after HH:MM" from
that day's `sunset` when not null; "weather may be out of date" when `warnings` includes `stale_data`.
Errors: `ok: false` with 400 → `badSettings` ("Check the location and hours settings"); any other failure →
`error` ("Weather unavailable"); no location → `noLocation`.

- [ ] **Step 1: Write the tests** (fixtures are trimmed copies of the live API shape, Amsterdam)
  - Wednesday 10:00 with a 52-minute plan → today, 60; 200 minutes → 180 with `overLimit` and the heading containing
    "doesn't fully fit"; no duration → 60, `noDuration`, heading containing "no duration planned".
  - Today's run done, and a rest day with a plan tomorrow → tomorrow, heading "TOMORROW"; 21:30 with avail
    `07-09,17-21` and a plan today → tomorrow; nothing planned today or tomorrow at 10:00 → today, 60, `noPlan`,
    heading containing "no session planned"; the same at 21:30 → tomorrow.
  - `plans: null` → 60, `unknown`, heading "Best time today · 60 min" with no "no session planned".
  - Sunday with a plan on next Monday → tomorrow uses it.
  - A response whose `days[0].date` is yesterday (cached across midnight) → the panel uses the entry matching today.
  - Window present → `kind: 'window'`, lines include `12:15–13:15`, `dry · 18 km/h SW · 8°C`, "start into the wind
    (SW)"; nl → `droog · 18 km/u ZW · 8°C` and "(ZW)".
  - `windows["90"]` null and `"45"` present → `shorter`, heading "Only 45 min fits your hours"; only `fallback` →
    `fallback`, heading "No dry window. Least bad 60 min:", sky never "dry"; neither → `none`, "No dry window in your
    hours".
  - `stale_data` → a line "weather may be out of date"; `sunset: null` → no "dark after" line.
  - 503, 429, null status → `error`, "Weather unavailable"; 400 → `badSettings`; location unset → `noLocation`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, the build, lint and format check; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): choose the run window session and wording`.

---

### Task 7: Render the screen

**Files:**
- Create: `src/render.js`, `tests/trmnl/render.test.js`
- Modify: `src/shared.template.liquid`, `full.liquid` (sizes)

**Interfaces:**
- Consumes: everything above.
- Produces: `window.renderRunningBoard(sizes)`, which reads the four `data-json` attributes and the settings, and fills
  the root element: left column, form chart (Highcharts), run window panel, footer with attributions.

Settings come from `trmnl.plugin_settings.custom_fields_values` (as `data-` attributes on the root, escaped), plus
`trmnl.user.locale` and the timezone variable per V4.

Panel errors (Review Focus 2): if any of IDX 0–2 fails with 401 → left column and graph replaced by the token message;
403 → the scope message; 402 → "Tredict account can't use the API"; any other failure, including a null status →
"Tredict unavailable" in the panel whose data failed (calendar: IDX 0 or 1; graph: IDX 2), plus "If this lasts, open
the Tredict app" when the status is null (the 10-day pause can't be told apart then). The rest renders.

Chart: one series, black, line width 3, dashed from today (`zones` on x), no legend, no credits, `animation: false`;
today's form as a large signed integer top right; x-axis labels "−6w", "today", "+7d". With no points: "No training
data yet" instead of the chart.

- [ ] **Step 1: Write `tests/trmnl/render.test.js`** (every render asserts `errors: []`)
  - The normal week: 7 rows, Monday first, today's row has the class `rb-today` (white on black); "WEEK 45"; the
    footer reads `{done km} / {planned km} km · {done h:mm} / {planned h:mm}` with the sums of the fixture's running
    items, km to 1 decimal in the resolved language; the missed plan is marked as missed; "Form (est.)" heading; the
    run window lines from Task 6.
  - The title with `</script>` and `{{ x }}` shows as text in its row, and the rendered HTML has exactly as many
    `<script` tags as the template (Review Focus 1).
  - IDX 0 401 → token message, no chart, run window still shown with "60 min"; 403 → scope message; 402 → its
    message; IDX 2 503 → calendar shown, graph panel "Tredict unavailable"; IDX 1 null status → calendar panel
    "Tredict unavailable" with the "open the Tredict app" hint (Review Focus 2).
  - Empty account → empty calendar, "No training data yet", and no `NaN`, `undefined` or `null` text anywhere in the
    filled `innerHTML` (Review Focus 4, 5).
  - Garmin activity → its attribution in the footer; none → no Garmin text. Open-Meteo attribution present whenever
    the run window shows.
  - `language: 'nl'` → Dutch strings; locale `fr` with `device` → English.
  - The chart config has `animation: false` on the series and only `#000000`/`#ffffff` colours.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Typography and spacing are left to the builder, readable from a few metres in 1-bit.
- [ ] **Step 4:** Run `npm run build:trmnl && npm test && npm run lint && npm run format:check`; expect PASS.
- [ ] **Step 5:** Commit `feat(plugin): render the running board`.

---

### Task 8: Browser preview

**Files:**
- Create: `tests/trmnl/preview.js` (copied from eu-dayahead, adapted)

- [ ] **Step 1:** Write it: for each render case of Task 7, write an 800x480 HTML page to the given folder, with the
  real Highcharts.
- [ ] **Step 2:** Run `node tests/trmnl/preview.js <scratch dir>` and open three pages (normal week, 401, empty) in a
  browser; check nothing overflows 800x480 and the text is legible at 1-bit (screenshot converted to black and white).
- [ ] **Step 3:** Lint, format check; commit `test(plugin): add a browser preview of the render cases`.

---

### Task 9: Docs

**Files:**
- Modify: `CLAUDE.md` (Status; commands `build:trmnl`, `preview`; IDX 0–3), `readme.md` (plugin line and status)
- Create: `integrations/trmnl-running-board/README.md`: install as a private plugin, the settings, the token rule, the
  privacy sentence for the V2 outcome, and that publishing waits for Tredict.

- [ ] **Step 1:** Write them. The privacy sentence matches the branch V2 took.
- [ ] **Step 2:** `npm run format:check`; commit `docs(plugin): document installing the running board`.

---

### Task 10: Install, check against Tredict, and the API's TRMNL check

Controller with the maintainer.

**Files:**
- Create: `tests/trmnl/formCheck.js`
- Modify: the verify answers file (V10), `docs/superpowers/plans/2026-11-02-run-window-api.md` (tick Task 13 Step 5)

- [ ] **Step 1:** Install on the maintainer's account as a private plugin, real settings. Screenshot on `og_plus` with
  the server-side renderer; check every panel against Tredict's app. Check the next morning that today's row moved.
- [ ] **Step 2:** `formCheck.js` reads `tests/fixtures/private/efforts.json` and `tests/fixtures/private/form-from-app.json`
  (`{ "YYYY-MM-DD": number }`, typed in by the maintainer) and prints the difference per date for the default constants
  and for ATL/CTL starting values and a one-day offset. It exits 0 with a message if the files are absent. Record the
  result as V10 without values; if it differs materially, keep the "(est.)" label and note the gap.
- [ ] **Step 3:** API Task 13 Step 5: in Better Stack, a TRMNL request to `/api/window` shows a rounded location and no
  token.
- [ ] **Step 4:** Commit `docs(plugin): record the install checks`.

Then two weeks of use (spec rollout step 3) before any recipe, and only if Tredict has agreed.
