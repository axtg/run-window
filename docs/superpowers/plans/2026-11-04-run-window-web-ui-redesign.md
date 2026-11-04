# Run-window One-Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the page at `/` into one card (slim settings rows with sliders, a big answer with key numbers, one
timeline joining strip and graph, the "why"), with API and Privacy in header-opened dialogs.

**Architecture:** Pure helpers for the new pieces go into the existing tested modules (`settings.js` for hour rows,
`plan.js` for key numbers). `index.html` gets the new card markup and two `<dialog>`s; `app.js` is rewritten around it,
reusing the modules' existing functions. No API change.

**Tech Stack:** vanilla browser JS, inline SVG, native `<input type="range">`, `<dialog>`, Tailwind 3.4, Jest.

**Spec:** `docs/superpowers/specs/2026-11-04-run-window-web-ui-redesign-design.md` (implementation authorised by the
maintainer), on top of `docs/superpowers/specs/2026-11-04-run-window-web-ui-design.md`. Read both, and CLAUDE.md's
"Web interface" section. Mockup: `.superpowers/brainstorm/1106114-1793817690/content/compact-params.html`, left option.

## Global Constraints

- CommonJS, ESLint + Prettier: single quotes, semicolons, 2-space indent, no trailing commas, max 120 cols. Every task
  ends with `npm run lint && npm run format:check && npm test` passing, and `npm run build:css` leaving no diff.
- Same-origin external scripts only; no inline script, no `<style>`, no `style=`, no `setAttribute('style', …)`. CSP
  unchanged. Slider fills/handles via native range inputs, SVG attributes or classes.
- Tailwind scans `index.html`, `app.js`, `strip.js` only: classes as complete literals there.
- Privacy: the route file and its name never leave memory; one `/api/window` request per change with only `lat`, `lon`
  (2 decimals), `avail`, `dark`, `rain`, `slots`; `localStorage` holds only the five settings. `tests/web/app.smoke.test.js`
  must keep proving this.
- All times in the location's timezone. English copy; units km, m, km/h, °C, %, `m:ss /km`.
- No API change: `/api/window` default response stays byte-identical (golden test).
- Don't touch `integrations/trmnl-running-board/`, `tests/trmnl/`, `package.json`, `eslint.config.js`. Shared files
  (`CLAUDE.md`, `readme.md`) only in the docs task, after messaging the other session (controller does that).
- After each task commit, wait for its roborev job and fix or answer its findings.

## Review Focus

1. **Overlapping or touching hour rows** while dragging (one row's end meets the next row's start): rows clamp at their
   neighbour, the joined string stays valid for the API. Test in Task 1.
2. **A stored `HH:MM` value** (`07:30-09`) shows unchanged and is saved unchanged until that handle moves. Test in Task 1.
3. **Removing the last hour row**: not allowed; at least one row stays. Test in Task 1 (helper) and Task 2 (button hidden).
4. **No route and location denied**: day row keeps the two buttons, status says so, nothing else shows. Task 2 smoke.
5. **Slider drags**: a request per settled change, not per pixel (debounce or `change` event), and a stale response never
   overwrites a newer one (existing request counter). Task 2.

---

### Task 1: Pure helpers for hour rows and key numbers

**Files:**
- Modify: `public/settings.js`, `public/plan.js`
- Test: `tests/web/settings.test.js`, `tests/web/plan.test.js`

**Interfaces:**
- Produces in `RunSettings`:
  - `DEFAULTS.hours = '10-16'` (other defaults unchanged).
  - `splitHours(text) → [{ start: 'HH' | 'HH:MM', end: 'HH' | 'HH:MM', startMin, endMin }]`, sorted by start; `[]` for
    invalid text (use `validHours`). Keeps the original text of each bound.
  - `joinHours(rows) → string`: `rows` sorted, each `start-end` with the stored text kept (`07:30-09,12-14`).
  - `hourText(min) → 'HH'` (whole hours; 1440 → `'24'`).
  - `moveHandle(rows, index, which: 'start' | 'end', hour) → rows`: sets that bound to the whole `hour` (0–24), clamped
    so `start < end` (at least 1 h) and the row never overlaps its sorted neighbours (touching is allowed); returns new
    rows, never mutates.
  - `addRow(rows) → rows`: appends a 1-hour row in the first free whole hour at or after the last row's end, else the
    first free hour from 00; returns `rows` unchanged when no free hour exists.
  - `removeRow(rows, index) → rows`: removes it unless it's the only row.
- Produces in `RunPlan`:
  - `keyNumbers(result, summary | null, minutes) → [{ label, value }]` in this order: `Sky` (`Dry` or `Rain 35 %`,
    same dry rule as `goLine`), `Feels` (`7 °C`, `-0` → `0`), `Wind` (`14 E`: `windAvg` + `windFromCardinal`), then
    `Climb` (`+45 m`, or `–` when `summary.climbM` is null) with a route, or `Run` (`60 min`) without. `[]` when
    `result.kind === 'none'`.
  - `answerLabel(result, minutes) → string`: `Best time · 65 min`; fallback `Least bad · 60 min`; not fits
    `Best 3 h · run is longer`; none `''`.
  - `answerTime(result, { minutes, timeZone }) → string`: `13:15–14:20` (same end rule as `goLine`), `''` for none.
  - `noWindowText(minutes, dayLabel) → string`: `No dry window of 65 min today` (reuse `goLine`'s none wording).

- [ ] **Step 1: Write the failing tests** (settings): default hours `10-16`; `splitHours('12-14,07:30-09')` sorted, keeps
  `'07:30'`; `joinHours(splitHours(x)) === x` for `07:30-09,12-14`; `moveHandle` clamps at a neighbour (`10-12,14-16`,
  move row 0 end to 15 → `10-14`), keeps ≥ 1 h, snaps a moved `07:30` to the given whole hour, leaves other bounds'
  text alone (Review Focus 1–2); `addRow` on `10-16` → `10-16,16-17`, on a full day `00-24` unchanged; `removeRow` keeps
  the last row (Review Focus 3); `loadSettings` with stored `06-22` keeps `06-22`.
- [ ] **Step 2: Write the failing tests** (plan): `keyNumbers` with route / without route / no climb / fallback / none;
  `answerLabel` and `answerTime` for each kind, Tokyo timezone; `noWindowText`.
- [ ] **Step 3: Run** `npx jest tests/web/settings.test.js tests/web/plan.test.js` — Expected: FAIL.
- [ ] **Step 4: Implement** in the two modules (export the new names).
- [ ] **Step 5: Run** `npm run lint && npm run format:check && npm test` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(web): helpers for hour rows and the answer's key numbers`

---

### Task 2: The one-card page

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/strip.js` (only if the builder joins the timeline into one
  model), `public/tailwind.css` (rebuilt), `tests/landing.test.js`, `tests/web/app.smoke.test.js`
- Test: the two test files above, `tests/web/strip.test.js` if `strip.js` changes

**Interfaces:**
- Consumes: Task 1's `splitHours`, `joinHours`, `moveHandle`, `addRow`, `removeRow`, `keyNumbers`, `answerLabel`,
  `answerTime`, `noWindowText`; existing `RouteFile`, `RunPlan`, `DayStrip`, `RunSettings` APIs.
- Keeps for other code: `RunApp.openRouteText(text, fileName)`, `#route-input` (file input, `accept` with `.gpx` and
  `.kml`), `#status` (`aria-live="polite"`), `#tap-line` (`aria-live="polite"`), the share hand-off in `app.js`
  (`SHARE_CACHE`, `SHARE_KEY` literals, `?share=` handling) unchanged.

Markup (spec "The card, top to bottom", "Settled after the builder check"):
- Header bar: logo (from `icon.svg`'s design, inline `<svg>` is fine), "Run window", `<button id="open-api">API</button>`,
  `<button id="open-privacy">Privacy</button>`.
- Card (`<main>` → one `<section>` white `rounded-2xl` card, `max-w-xl` centred):
  - Settings panel: day row (`#day-today`, `#day-tomorrow`, `#zone-note`, source area: `#source` + `#clear-source` ✕,
    or `#route-input` label "Open route" + `#use-location`); `#pace-row` (− `#pace-down`, `#pace-input`, + `#pace-up`,
    5 s steps, 3:00–15:00) or `#duration-row` (− / + 15 min, 15–300) without a route; `#hours-rows` (one row per range,
    each: two range inputs 0–24 step 1 drawn as one two-handle slider, the night hatch as an SVG or class layer behind
    the track, value text, a remove ✕ when more than one row); `#add-hours` "+ add hours"; dark row (`#dark-times`
    text e.g. `dark 17:08–07:28`, `#dark-ok` toggle, `role="switch"`, `aria-checked`); rain row (range 0–100 step 5,
    value `40 %`).
  - Answer: `#answer-label`, `#answer-time` (large), `#key-numbers` (a row of label/value pairs), `#wind-line`,
    `#stale-note`; `#prompt` (empty state); `#status` directly under it.
  - Timeline: one `<svg id="timeline">` with the strip band on top (cells, gap separators, window outline running down
    through the graph, dashed for fallback), the graph below (feels-like, wind, rain bars, dark shading), ticks;
    keyboard/tap selection as now (`tabindex="0"`, `role="img"`, `aria-label` updated); `#tap-line` under it.
  - Why: legend (feels-like, wind, rain %, dark) and `#why-sentence`, always shown when there's a result.
  - Footer row: Open-Meteo attribution link (`https://open-meteo.com/`, text `Open-Meteo.com`), `#copy-link`.
- Dialogs: `<dialog id="api-dialog">` with the current API example (`lat=52.37&amp;lon=4.89`), parameter summary
  incl. `slots`, capacity text and the `openapi.yaml` link; `<dialog id="privacy-dialog">` with today's privacy bullets
  verbatim. Close button, Escape, click on the backdrop.

Behaviour:
- Settings save on every settled change (range `change` event, or `input` with a 300 ms debounce for the visual value);
  then one refresh. Hours saved through `joinHours`.
- Night hatch and `#dark-times` from the chosen day's `sunrise`/`sunset`, formatted in the location's timezone; hidden
  before the first response.
- With a route: run minutes = `runMinutes(distance, pace)`; no one-off duration (removed, spec).

- [ ] **Step 1: Update `tests/landing.test.js` first:** header buttons `#open-api`, `#open-privacy`; two `<dialog>`s with
  ids `api-dialog` and `privacy-dialog`; the API example and every existing privacy assertion now found inside those
  dialogs; controls present: `#pace-input`, `#hours-rows`, `#add-hours`, `#dark-ok` with `role="switch"`, a rain
  `type="range"` input with a `<label>`; `#tap-line` and `#status` with `aria-live="polite"`; no `oneoff-input`, no
  `chip-` ids; keep every script, CSP, external-request and maintainer-name assertion.
- [ ] **Step 2: Update `tests/web/app.smoke.test.js`:** extend the fake DOM for what the new `app.js` needs (e.g.
  `createElement`, `querySelector` inside rows, `dialog.showModal`); keep every privacy assertion; add: after opening the
  route, press `#pace-up`, add an hour row, move the rain range (dispatch `change`): localStorage still holds only the
  five settings keys with `hours` like `10-16,16-17`; each settled change makes exactly one more request, each with only
  the six query keys and 2-decimal coordinates (Review Focus 5); with location denied, `#status` says
  `Location is off. Open a route file instead.` and no request is made (Review Focus 4).
- [ ] **Step 3: Run** `npx jest tests/landing.test.js tests/web/app.smoke.test.js` — Expected: FAIL.
- [ ] **Step 4: Write `public/index.html` and rewrite `public/app.js`** per the markup and behaviour above. Keep the share
  hand-off, `deviceStorage()`, the request counter and `openRouteText` as they are.
- [ ] **Step 5: `npm run build:css`.**
- [ ] **Step 6: Run** `npm run lint && npm run format:check && npm test` — Expected: PASS.
- [ ] **Step 7: Manual check** with the Playwright MCP against `npm run dev` (server in the background, stopped after):
  320 px and 1024 px; open `tests/fixtures/routes/hill-loop.gpx` (via the input's change handler, as the earlier check
  did); drag pace, hours, rain; add and remove an hour row; toggle dark; open and close both dialogs (Escape too); no
  CSP console errors except the known parsererror noise for a bad file; only same-origin requests with 2-decimal
  coordinates; no horizontal scroll. Screenshots only in the scratchpad
  (`/tmp/claude-1001/-home-xander-webapps-run-window/04cccc97-115f-43c4-a1f0-46b03c4142e5/scratchpad`). Never write into
  `/home/xander/webapps/run-window`; if Playwright creates `.playwright-mcp/` there, say so in the report.
- [ ] **Step 8: Commit** `feat(web): one-card page with slim settings and one timeline`

---

### Task 3: Docs

**Files:** Modify: `CLAUDE.md` (Web interface section: chips → settings rows, dialogs, default hours `10-16`, no
one-off duration), `docs/superpowers/specs/2026-11-04-run-window-web-ui-design.md` (one line under its title pointing
to the redesign spec as the current layout), `readme.md` only if it describes the old layout.

- [ ] **Step 1:** Edit; keep the TRMNL sections of CLAUDE.md untouched.
- [ ] **Step 2: Run** `npm test && npm run lint && npm run format:check` — Expected: PASS.
- [ ] **Step 3: Commit** `docs: the one-card page`
