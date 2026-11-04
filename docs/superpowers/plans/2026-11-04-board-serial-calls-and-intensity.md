# Running Board: serial Tredict calls, 429 pause and intensity bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board calls Tredict one request at a time within a 4 s deadline, stops and pauses on HTTP 429, tells a
paused token (401) from an invalid one (403), and shows this week's heart-rate intensity under the form graph.

**Architecture:** `src/tredict.js` gains a sequence object that runs calls in order against a shared deadline and stops
on 429. A new `src/intensity.js` reads and writes the per-activity cache and builds the bar's view. `src/week.js`
exposes this week's done activities. `src/board.js` wires it together and carries `tredictRetryAt` and
`intensityCache` through every output. `full.liquid` draws the bar in SVG.

**Tech Stack:** Node ≥ 22 (TRMNL runs Node 24), CommonJS, Jest, liquidjs harness in `tests/trmnl/harness.js`.

**Spec:** `docs/superpowers/specs/2026-11-02-trmnl-running-board-design.md`, sections "Tredict calls", "Intensity",
and the 2026-11-04 lines in "Constraints", "Data flow", "Errors and empty states", "Privacy", "Language",
"Verification".

## Global Constraints

- `transform.js` is generated: `npm run build:trmnl`, never edited by hand; CI fails if it differs.
- In `src/`, modules use only `const { a } = require('./other');` and one `module.exports = { ... };`. A new module
  must be added to `MODULE_ORDER` in `scripts/build-trmnl.js` (after `tredict`, before `board`).
- Built-ins only. No `console.*`. Outputs carry fixed strings only, never an `error.message` or response text.
- `buildBoard` never rejects; anything unexpected gives the fixed error output.
- Output never holds a raw Tredict response, a token, a `summary` or `seriesSampled`. The output JSON stays under 10 KB.
- Tests never hit live upstreams. Committed Tredict fixtures are synthetic (invented ids and seconds).
- Deadline 4000 ms for the whole Tredict sequence; per-call timeout `min(3000, remaining)`; no call started with under
  500 ms left (counts as a timeout); detail calls at most 3 per run, each only with ≥ 1000 ms left.
- 429 pause: `Retry-After` whole seconds clamped to 1800 .. 21600 s; unreadable or absent → 1800 s.
- Strings, verbatim:
  - en `tokenPaused`: `Tredict token paused. Open the Tredict web app to reactivate it.`
  - en `tokenInvalid`: `Tredict token invalid. Check it has the activityRead scope.`
  - nl `tokenPaused`: `Tredict-token gepauzeerd. Open de Tredict-webapp om het weer te activeren.`
  - nl `tokenInvalid`: `Tredict-token ongeldig. Controleer of het de scope activityRead heeft.`
  - en `intensityHeading`: `Intensity this week · {time}`; nl: `Intensiteit deze week · {time}`
  - en `intensityLow/Moderate/High`: `low` / `moderate` / `high`; nl: `laag` / `gemiddeld` / `hoog`
- `BOARD_VERSION` stays 1.
- Prettier/ESLint as configured: single quotes, semicolons, 2 spaces, no trailing commas, 120 cols.

## Review Focus

1. **First run after this upgrade:** previous merge variables come from today's board, with no `intensityCache` and no
   `tredictRetryAt`. Expect a normal board, a cold cache and no pause. (Task 5 test)
2. **A `tredictRetryAt` far in the future** (hand-edited or clock skew, e.g. year 3000): it must not pause the board
   forever. A value more than 21600 s ahead of now is ignored. (Task 4 test)
3. **An activity in the list without an `id`:** it can't be fetched, so it is left out of the bar's set rather than
   blocking the bar all week. (Task 3 test)
4. **Monday after a week of runs:** last week's ids drop out of the cache with no detail calls for them, and the bar
   is absent until a run with heart rate exists. (Task 5 test)
5. **A fetch that ignores the abort signal and resolves late:** the sequence moves on when the timer fires; the late
   result is ignored and the next call starts no earlier than that timer. (Task 1 test)

---

### Task 1: Tredict sequence, status kinds and Retry-After

**Files:**
- Modify: `integrations/trmnl-running-board/src/tredict.js`
- Test: `tests/trmnl/tredict.test.js`

**Interfaces:**
- Produces:
  - `fetchJson(fetchFn, url, token, timeoutMs)` → as now, but `kind` is one of `'paused'` (401), `'auth'` (403),
    `'payment'` (402), `'missing'` (404), `'rate'` (429, with `retryAfterS: number|null`), `'unavailable'`. Missing
    token stays `'auth'`.
  - `retryAfterSeconds(response)` → whole non-negative seconds from `response.headers.get('retry-after')` when it
    matches `/^\d+$/`, else `null`. Missing or throwing `headers` → `null`.
  - `detailUrl(id)` → `${TREDICT_BASE}activity/${encodeURIComponent(id)}?extraValues=1`.
  - `tredictSequence({ fetch, token, clock, deadlineMs = 4000 })` → `{ call(url), remaining(), stopped(), rate() }`.
    `call` never rejects; calls run strictly one after another (a `call` made while one is in flight waits for it);
    after a `'rate'` result every later `call` returns `{ ok: false, kind: 'skipped' }` without fetching; with under
    500 ms remaining it returns `unavailable(null)` without fetching. `rate()` → `null` or `{ retryAfterS }` of the
    429. `clock` defaults to `Date.now`; the deadline is `clock()` at creation plus `deadlineMs`.
  - Constants exported: `DEADLINE_MS = 4000`, `CALL_TIMEOUT_MS = 3000`, `MIN_START_MS = 500`.

- [ ] **Step 1: Write the failing tests** in `tests/trmnl/tredict.test.js`:
  - `fetchJson maps 401 to paused, 403 to auth, 404 to missing, 429 to rate` — fake responses with those statuses.
  - `reads Retry-After seconds on a 429` — `headers: { get: name => name === 'retry-after' ? '120' : null }` →
    `retryAfterS: 120`; `'Wed, 21 Oct 2026 07:28:00 GMT'` → `null`; no `headers` → `null`.
  - `detailUrl encodes the id` — `detailUrl('a/b')` ends with `activity/a%2Fb?extraValues=1`.
  - `tredictSequence starts no call before the previous one settled` — a fake fetch that records `start`/`end`
    events and resolves after a delay; fire three `call`s without awaiting between them; assert the event log is
    `start1,end1,start2,end2,start3,end3`.
  - `tredictSequence stops after a 429` — second call answers 429; third `call` resolves `{ ok: false, kind:
    'skipped' }` and the fetch was called exactly twice; `rate()` equals `{ retryAfterS: null }`.
  - `tredictSequence shrinks timeouts to the deadline` — fake clock at 0, first fetch advances the clock to 3200 and
    resolves; the second fetch receives a timeout of 800 (assert via a spy on the `timeoutMs` reaching `fetchJson`,
    or by a fetch that never resolves and checking it settles after ~800 ms with jest fake timers).
  - `tredictSequence refuses to start with under 500 ms left` — clock advanced to 3600 → `call` returns
    `{ ok: false, kind: 'unavailable', status: null }` and fetch not called.
  - `a late resolve after the timer is ignored (Review Focus 5)` — fetch ignores the signal and resolves after the
    timeout; the call settles as `unavailable` at the timeout, and the next call starts after that.
  - Update the existing `fetchJson` 401 test (it expects `'auth'`) to expect `'paused'`.

- [ ] **Step 2: Run** `npx jest tests/trmnl/tredict.test.js` — expect the new tests to FAIL.

- [ ] **Step 3: Implement** in `src/tredict.js`. The sequence chains each call on the previous call's promise
  (`last = last.then(...)`) so ordering holds even when callers don't await.

- [ ] **Step 4: Run** `npx jest tests/trmnl/tredict.test.js` — PASS.

- [ ] **Step 5: Commit** `feat(plugin): call Tredict in sequence with a shared deadline and stop on 429`

---

### Task 2: Intensity module and its strings

**Files:**
- Create: `integrations/trmnl-running-board/src/intensity.js`
- Modify: `integrations/trmnl-running-board/src/strings.js`, `scripts/build-trmnl.js` (`MODULE_ORDER`)
- Test: `tests/trmnl/intensity.test.js` (new), `tests/trmnl/strings.test.js`

**Interfaces:**
- Consumes: `STRINGS`, `fill` from `./strings`.
- Produces:
  - `INTENSITY_PER_RUN = 3`, `DETAIL_MIN_MS = 1000`.
  - `readIntensityCache(value)` → `Map<string, [number, number, number]>`. Accepts only an array of
    `[id, low, moderate, high]` with `id` a non-empty string ≤ 64 chars and three finite numbers ≥ 0; anything else
    (non-array, wrong length, bad entry) is skipped entry by entry; a non-array gives an empty map.
  - `cacheList(map, ids)` → `[[id, l, m, h], ...]` for the `ids` present in `map`, in `ids` order.
  - `intensityOf(data)` → `[l, m, h]` from `data.summary.intensityDistribution.heartrate` keys `"0"`, `"1"`, `"2"`
    (non-finite or negative → 0); `[0, 0, 0]` when any level of that path is missing or `null`.
  - `intensityView(entries, lang)` → `null` when the seconds total is 0, else
    `{ heading, segments: [{ kind: 'low'|'moderate'|'high', x, width }], labels: [string, string, string] }`.
    `entries` is an array of `[l, m, h]`. `heading` = `fill(text.intensityHeading, { time: 'h:mm' })` of the total
    (e.g. 9720 s → `2:42`; 2520 s → `0:42`). Bar viewBox width 360: widths proportional, a non-zero range at least
    4, the largest segment absorbs the difference so widths sum to 360; zero-second ranges are omitted from
    `segments`. `labels` = `low 78%` etc. with whole percentages summing to 100 by largest remainder (ties: low,
    moderate, high order).
  - New string keys in `en` and `nl`: `intensityHeading`, `intensityLow`, `intensityModerate`, `intensityHigh`,
    `tokenPaused`; `tokenInvalid` replaced (values in Global Constraints).

- [ ] **Step 1: Write the failing tests** in `tests/trmnl/intensity.test.js`:
  - `readIntensityCache keeps valid entries and drops the rest` — input
    `[['a', 10, 20, 30], ['b', -1, 0, 0], ['', 1, 1, 1], ['c', 1, 2], 'x', ['d', 1, 2, 3]]` → keys `['a', 'd']`.
  - `readIntensityCache ignores a non-array` — `{}`, `null`, `'x'` → size 0.
  - `intensityOf reads the heart-rate seconds` — `{ summary: { intensityDistribution: { heartrate: { 0: 1800, 1:
    600, 2: 120 } } } }` → `[1800, 600, 120]`; `heartrate: null` → `[0, 0, 0]`; `{}` → `[0, 0, 0]`.
  - `intensityView sums, rounds to 100 and formats the total` — entries `[[5460, 1190, 350]]` (7000 s) → heading
    `Intensity this week · 1:56`, labels `['low 78%', 'moderate 17%', 'high 5%']`, segment widths sum to 360.
  - `percentages sum to 100 by largest remainder` — `[[1, 1, 1]]` → `['low 34%', 'moderate 33%', 'high 33%']`.
  - `a tiny range stays visible` — `[[10000, 0, 10]]` → `high` width ≥ 4, no `moderate` segment, widths sum 360.
  - `no bar for zero seconds` — `[]` and `[[0, 0, 0]]` → `null`.
  - `Dutch` — `intensityView([[3600, 0, 0]], 'nl').heading` = `Intensiteit deze week · 1:00`, labels start `laag 100%`.
  - In `strings.test.js`: the en/nl key sets still match (existing test) and `tokenPaused`/`tokenInvalid` equal the
    Global Constraints values.

- [ ] **Step 2: Run** `npx jest tests/trmnl/intensity.test.js tests/trmnl/strings.test.js` — FAIL.

- [ ] **Step 3: Implement** `src/intensity.js`, the strings, and add `'intensity'` to `MODULE_ORDER` after `tredict`.

- [ ] **Step 4: Run** `npx jest tests/trmnl` — the new tests PASS. Tests that pin the old `tokenInvalid` text may fail
  here; they are Task 4's to update, so note them in the report and leave them.

- [ ] **Step 5: Commit** `feat(plugin): add the intensity cache and bar view`

---

### Task 3: This week's done activities from `buildWeek`

**Files:**
- Modify: `integrations/trmnl-running-board/src/week.js`
- Test: `tests/trmnl/week.test.js`

**Interfaces:**
- Produces: `buildWeek(...)` also returns `done: [{ id, garmin }]` — every activity counted as done this week for the
  `sport` filter (matched to a plan or unplanned, including those beyond `ITEMS_PER_DAY`), newest first by `date`.
  `id` is `String(activity.id)`; activities without an `id` are left out. `garmin` is the activity's attribution text
  (same rule and fallback as the `garmin` list) when `isFromGarminApi === true`, else `null`.

- [ ] **Step 1: Write the failing tests** in `tests/trmnl/week.test.js`, using the synthetic week fixtures and
  `NOW = 2026-11-04T11:00:00Z`, Europe/Amsterdam:
  - `lists this week's done runs newest first` — `done.map(d => d.id)` equals
    `['SynAct04xxxxxxxxxxxxxx', 'SynAct03xxxxxxxxxxxxxx', 'SynAct02xxxxxxxxxxxxxx']` (Act01 is last Sunday 23:30 local,
    Act05/06 are in the future).
  - `marks Garmin activities` — the Act03 entry has a non-empty `garmin` string, the others `null`.
  - `includes runs beyond the two rows a day shows` — add three extra runs on Monday to the fixture list in the test;
    all appear in `done`.
  - `leaves out an activity without an id (Review Focus 3)` — a done run with no `id` is counted in the calendar but
    absent from `done`.
  - `follows the sport filter` — with `sport: 'all'` and an extra done `misc` activity before NOW, it is in `done`.

- [ ] **Step 2: Run** `npx jest tests/trmnl/week.test.js` — FAIL.
- [ ] **Step 3: Implement** in `buildWeek`; `addDone` already sees every done activity.
- [ ] **Step 4: Run** `npx jest tests/trmnl/week.test.js` — PASS.
- [ ] **Step 5: Commit** `feat(plugin): expose this week's done activities`

---

### Task 4: Board — serial calls, 429 pause, paused and invalid token

**Files:**
- Modify: `integrations/trmnl-running-board/src/board.js`
- Modify: `tests/trmnl/boardCases.js` (fake fetch: response `headers`, a `detail` route, an injectable clock)
- Modify: `tests/trmnl/renderCases.js` (`STATE_CASES`: `paused: { plan: 401 }`, `auth: { plan: 403 }`)
- Test: `tests/trmnl/board.test.js`, plus existing tests that pin the old `tokenInvalid` text or `kind: 'auth'` for 401

**Interfaces:**
- Consumes: `tredictSequence`, `DEADLINE_MS` (Task 1); `tokenPaused`, `tokenInvalid` (Task 2).
- Produces:
  - `buildBoard(input, { fetch, now, timeoutMs, clock })` — `clock` (default `Date.now`) feeds `tredictSequence`.
  - Output gains `tredictRetryAt: string|null` (UTC ISO). Kept in `errorBoard(now, previous)` too.
  - `tredict.state` gains `'paused'` (any 401 of plan/activities/efforts, checked before `'auth'`).
  - `recentTredictPause(previous, now)` → ISO string when `previous.tredictRetryAt` parses, is after `now`, and is no
    more than 21600 s after `now`; else `null`.

Behaviour:
- Calls in order plan → activities → efforts through one sequence; the first non-ok result of the three ends the
  sequence (don't issue the rest; treat them as not ok with the same handling as today's failures). The weather retry
  stays in parallel with the sequence (`Promise.all` of the sequence's chain and the retry).
- A pause in force (`recentTredictPause`) → no Tredict call at all; the panels take the stale path; the output keeps
  the same `tredictRetryAt`.
- A 429 → `tredictRetryAt = now + clamp(retryAfterS ?? 1800, 1800, 21600) s`; panels take the stale path unless
  plan, activities and efforts already succeeded.
- No pause and no 429 → `tredictRetryAt: null`.

- [ ] **Step 1: Extend `boardCases.js`**: responses get `headers: { get: () => null }` unless an override supplies
  them; route `detail` for `/api/oauth/v2/activity/` URLs with a default synthetic body (Task 5 adds fixtures; here
  a body with `heartrate: null` suffices); `board()` accepts a `clock` passed through to `buildBoard`; each call record
  gets `start` and `end` indices from one shared counter.

- [ ] **Step 2: Write the failing tests** in `board.test.js`:
  - `calls Tredict one at a time in plan, activities, efforts order` — names in order, and each call's `start` comes
    after the previous call's `end`.
  - `the weather retry runs alongside` — with an empty polled body, the `window` call starts before `efforts` ends.
  - `401 shows the paused text`, `403 shows the invalid text` — states `'paused'` and `'auth'`, messages verbatim.
  - `a 429 stops the sequence and pauses` — `activities` answers 429 with `Retry-After: 3600`: no `efforts` call,
    `tredictRetryAt` = NOW + 3600 s; with `Retry-After: 60` → NOW + 1800 s; with `99999` → NOW + 21600 s; with none →
    NOW + 1800 s.
  - `a run inside the pause calls no Tredict` — previous output with `tredictRetryAt` 10 min ahead and good panels from
    today: zero Tredict calls, state `'stale'`, same `tredictRetryAt`.
  - `a run after the pause calls again` — `tredictRetryAt` 1 min in the past → three calls, `tredictRetryAt: null`.
  - `ignores a pause too far ahead (Review Focus 2)` — `tredictRetryAt: '3000-01-01T00:00:00.000Z'` → calls made.
  - `the error output keeps the pause` — `buildBoard` with a fetch that makes assembly throw (e.g. `input` whose
    getter throws after reading the previous variables) still returns `tredictRetryAt` from the previous output.
  - `a slow plan call leaves less time` — a clock that jumps 3600 ms during `plan`: `activities` is not fetched,
    state `'stale'` or `'unavailable'`.
  - Update existing tests and render cases for 401 → `'paused'` and the new texts.

- [ ] **Step 3: Run** `npx jest tests/trmnl` — new tests FAIL.
- [ ] **Step 4: Implement** in `board.js`. Remove `REQUEST_TIMEOUT_MS` use for Tredict (the sequence sets timeouts);
  the weather retry keeps 3000 ms.
- [ ] **Step 5: Run** `npx jest tests/trmnl` and `npm run lint` — PASS.
- [ ] **Step 6: Commit** `feat(plugin): pause on Tredict 429 and tell a paused token from an invalid one`

---

### Task 5: Board — intensity cache, detail calls and the bar's data

**Files:**
- Create: `tests/fixtures/tredict/activity-detail-hr.json`, `tests/fixtures/tredict/activity-detail-nohr.json`
  (synthetic: `_id`, `sportType`, `summary.duration`, `summary.intensityDistribution` with invented seconds summing to
  `duration`; the no-HR one has `heartrate: null`; a short `seriesSampled` stub; no coordinates)
- Modify: `integrations/trmnl-running-board/src/board.js`, `tests/trmnl/boardCases.js` (detail route serves the HR
  fixture by default, overridable per id)
- Test: `tests/trmnl/board.test.js`

**Interfaces:**
- Consumes: `readIntensityCache`, `cacheList`, `intensityOf`, `intensityView`, `INTENSITY_PER_RUN`, `DETAIL_MIN_MS`
  (Task 2); `week.done` (Task 3); the sequence and `detailUrl` (Task 1).
- Produces: output fields `intensity` (the `intensityView` result or `null`) and `intensityCache` (`cacheList` result).

Behaviour:
- Fresh panels: `ids = week.done.map(d => d.id)`; cache = `readIntensityCache(previous.intensityCache)` limited to
  `ids`; for the uncached ids in `ids` order (newest first), up to `INTENSITY_PER_RUN`, while `remaining() >=
  DETAIL_MIN_MS` and not `stopped()`: `call(detailUrl(id))`; ok → `intensityOf(data)`; `'missing'` → `[0, 0, 0]`;
  anything else → leave uncached. `intensity` = every id cached ? `intensityView(cached entries, lang)` : `null`.
  A 429 here sets `tredictRetryAt` as in Task 4 while the panels stay `'ok'`.
- Stale panels: `intensity` reused from `previous.intensity` field by field (`reuseIntensity`: heading string,
  segments with known `kind` and finite `x`/`width`, three label strings; else `null`); `intensityCache` carried from
  the previous output through `readIntensityCache`/`cacheList`.
- Paused, auth, payment, unavailable without stale data, and the error output: `intensity: null`; `intensityCache`
  carried.
- Attribution: Garmin texts of `week.done` entries that are cached with a non-zero total, added to the footer list
  without duplicates, before the weather attribution.

- [ ] **Step 1: Write the failing tests** in `board.test.js`:
  - `a cold cache fetches this week's runs and shows the bar` — normal case: detail calls for the three `done` ids,
    after `efforts`; `intensity.heading` starts `Intensity this week · `; `intensityCache` has three entries.
  - `a warm cache makes no detail calls` — previous output = the first run's output: zero detail calls, same
    `intensity`.
  - `four new runs: three now, the bar next run` — four done runs (extend the activity list in the test): first run 3
    detail calls and `intensity: null`; second run with the first as previous: 1 detail call and a bar.
  - `last week's ids drop out (Review Focus 4)` — previous `intensityCache` holds only ids not in this week: they are
    absent from the new cache and not fetched.
  - `a run without heart rate is cached as zeros` — detail for one id serves the no-HR fixture: entry `[id, 0, 0, 0]`.
  - `a 404 is cached as zeros, a 503 is retried` — two ids answering 404 and 503: the 404 id cached as zeros, the 503
    id not cached, `intensity: null`.
  - `a 429 on a detail call keeps the panels and pauses` — state `'ok'`, `tredictRetryAt` set, no further detail call.
  - `no detail calls with under a second left` — clock at 3100 ms after `efforts` → zero detail calls.
  - `the Garmin run adds its attribution` — Act03's text appears once in `attribution` even if the week rows already
    listed it.
  - `stale panels keep the bar` — previous with a bar, `efforts` 503: `intensity` deep-equals the previous one.
  - `a malformed cache is ignored` — `intensityCache: 'x'` and `[[1, 2]]` → normal cold-cache run.
  - `first run after the upgrade (Review Focus 1)` — previous = a v1 output without `intensityCache`,
    `tredictRetryAt` and `intensity`: state `'ok'`, cold cache, no pause.
  - Existing `leaks no coordinates, summaries or token and stays under 10 KB` still passes with the cache present; add
    `not.toContain('seriesSampled')` and `not.toContain('intensityDistribution')`.

- [ ] **Step 2: Run** `npx jest tests/trmnl/board.test.js` — FAIL.
- [ ] **Step 3: Implement** in `board.js`.
- [ ] **Step 4: Run** `npx jest tests/trmnl` and `npm run lint` — PASS.
- [ ] **Step 5: Commit** `feat(plugin): fetch and cache this week's intensity`

---

### Task 6: Draw the bar, regenerate, preview

**Files:**
- Modify: `integrations/trmnl-running-board/full.liquid`, `tests/trmnl/renderCases.js` (add an `intensity` case:
  the normal case already has a bar after Task 5; add `no-intensity` with `intensity: null`, and `paused`)
- Modify: `integrations/trmnl-running-board/transform.js` (generated)
- Test: `tests/trmnl/render.test.js`, `tests/trmnl/build.test.js` (existing)

**Interfaces:**
- Consumes: output `intensity` `{ heading, segments: [{ kind, x, width }], labels }`.

Markup (inside `.rb-form`, after `.rb-form__labels`, only `{% if intensity %}`):
- `.rb-intensity__heading` (17px, bold) with `intensity.heading`.
- An `<svg viewBox="0 0 360 22">` with a `<pattern>` of diagonal 2px black lines on white for `moderate`; one `<rect>`
  per segment at `x`/`width`, height 22: `low` white fill, `moderate` `url(#…)` fill, `high` black; one outline
  `<rect>` around the whole bar, 2px black, `vector-effect="non-scaling-stroke"`. Pattern id made unique with
  `append_random` (TRMNL can show the plugin twice on a mashup).
- `.rb-intensity__labels`: three `<span>`s spaced between, 15px.
- With a bar, the form graph yields height: add `rb-form--intensity` to `.rb-form`, which sets the graph's
  `max-height` to 120px.

- [ ] **Step 1: Write the failing tests** in `render.test.js`:
  - `draws the intensity bar` — normal case: heading text present, one `<pattern`, a `<rect` per segment with the
    output's `x`/`width`, three label spans with the output's labels, `rb-form--intensity` present.
  - `no bar without intensity` — `no-intensity` case: no `rb-intensity`, no `rb-form--intensity`.
  - `escapes the labels` — an output with `intensity.heading = '<b>x</b>'` renders `&lt;b&gt;`.
  - `paused case shows the paused text`.
- [ ] **Step 2: Run** `npx jest tests/trmnl/render.test.js` — FAIL.
- [ ] **Step 3: Implement** the markup and CSS. Then `npm run build:trmnl`.
- [ ] **Step 4: Run** `npm test`, `npm run lint`, `npm run format:check` — PASS.
- [ ] **Step 5: Preview:** `node tests/trmnl/preview.js /tmp/claude-preview` and check, at 800x480, that the normal
  case shows the run panel's lines in full (no clipped last line) and the bar under the graph. Report what you saw.
- [ ] **Step 6: Commit** `feat(plugin): draw the week's intensity under the form graph`

---

### Task 7: Docs

**Files:**
- Modify: `CLAUDE.md` ("TRMNL transform script": replace "finishes well within 5 s (parallel calls, 3 s timeouts)"
  with the sequence, the 4 s deadline and the 429 pause; mention `intensityCache` in the output rule)
- Modify: `integrations/trmnl-running-board/README.md` (what the board shows, the extra detail call per run, the 429
  pause, the paused-token message)
- Modify: `docs/superpowers/specs/2026-11-03-trmnl-running-board-verify.md` (Step 1b answered by Tredict 2026-11-04:
  401 with the reactivation text; rows for serialisation and 429 as Tredict's conditions)

- [ ] **Step 1:** Make the edits. Anonymised: "the maintainer", "Tredict", no personal names.
- [ ] **Step 2: Run** `npm run format:check` and `npm test` — PASS.
- [ ] **Step 3: Commit** `docs(plugin): document serial calls, the 429 pause and the intensity bar`

After Task 7 the controller rebuilds the zip
(`cd integrations/trmnl-running-board && zip -qj /mnt/c/Users/Public/running-board.zip settings.yml full.liquid transform.js`)
for the maintainer to re-upload to the existing private plugin, and checks the device screen.
