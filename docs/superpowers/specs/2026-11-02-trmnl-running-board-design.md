# TRMNL plugin: Running Board

Date: 2026-11-02
Status: awaiting approval
Plugin: `integrations/trmnl-running-board/`
Depends on: Run-window API (`2026-11-02-run-window-api-design.md`), deployed first

## Intent

One full TRMNL screen dedicated to running, for someone who plans their training in Tredict:

- **Left, full height:** this week, Monday to Sunday. Planned sessions, and actuals for what's done.
- **Right top:** form over the last weeks, with the planned weeks ahead.
- **Right bottom:** today's best time to run, sized to today's planned session.

The maintainer uses it first. It should be publishable as a TRMNL recipe for other Tredict users, which rules out any
backend that holds their Tredict token or data.

## Goals

- Backend-free for Tredict: TRMNL polls Tredict directly with the user's Personal API token.
- The run window matches today's planned session length (or tomorrow's, after today's run is done or on a rest day).
- Glanceable from across a room on the original 800x480 device in 1-bit.
- Honest failure: an inactive token, a missing plan or a weather outage each get a clear message, never a blank or a
  stale-but-confident screen.

## Non-goals

- Layouts other than `full` in v1. Half and quadrant layouts (for example only the run window) are a v1.1 candidate.
- Weekly 80/20 zone split. It needs one activity-detail call per activity; not in v1.
- HRV, sleep, Whoop or any recovery data.
- Routes or maps.
- Imperial units. Metric only.
- Writing anything to Tredict. Read-only scopes.

## Anti-goals

- The Tredict token is sent anywhere it doesn't have to go, or logged by the run-window service (see "Privacy").
- The screen recommends a window that contradicts the run-window API (the plugin must not do its own weather logic).
- The form graph is presented as Tredict's own number when it is our estimate (see "Form").

## Constraints (from TRMNL and Tredict docs, 2026-11-02)

- **Multiple polling URLs:** one per line; responses arrive as `IDX_0`, `IDX_1`, … in polling order. Polling URLs are
  rendered with Liquid first and then split on line breaks.
- **One headers field** for all polling URLs: `authorization=bearer {{ tredict_token }}` goes to every URL, including
  the run-window API. That API strips it (see its spec). **Verify** whether TRMNL offers per-URL headers; if so, use
  them instead.
- **Tredict Personal API:** bearer token with chosen scopes. Needs `activityRead` only. The token goes **inactive
  (401) unless the user opens the Tredict app at least once every 10 days**; it reactivates on the next visit.
- **Tredict rate limits** are per IP, and all TRMNL polls come from TRMNL's few server IPs. Activity download is limited
  to 10 requests/second. Fine for a handful of installs; note it if the recipe grows.
- **Garmin attribution:** activities from Garmin carry `isFromGarminApi: true` and an `attribution` string. If the
  screen shows such data, it must show the attribution visibly.
- **Open-Meteo attribution** must be shown when showing the run window (the API returns the text).
- Plugin format and the shared/layout split as in eu-dayahead's TRMNL plugin (see its design doc): `settings.yml`,
  `shared.liquid`, `full.liquid`, files ≤ 100 KB, animations off, chart IDs via `append_random`.

## Polling URLs

In this order (the indices are part of the contract with the template):

| IDX | URL | Purpose |
|-----|-----|---------|
| 0 | `https://www.tredict.com/api/oauth/v2/plannedTrainingList?startDate={monday}&endDate={sunday}` (+ `&sportType=running` if the sport setting says so) | This week's plan |
| 1 | `https://www.tredict.com/api/oauth/v2/activityList?pageSize=50&extendedSummary=1` | Actuals; newest first, filter to this week in JS |
| 2 | `https://www.tredict.com/api/oauth/v2/efforts` | Daily effort per training; defaults cover 1 year back to 1 month ahead, including planned (`unconfirmed`) sessions |
| 3 | `https://run.xadi.eu/api/window?lat={{ lat \| round: 2 }}&lon={{ lon \| round: 2 }}&avail={{ availability }}&dark={{ dark }}&rain={{ rain }}&lang={lang}` | Run window |

`{monday}` and `{sunday}` are UTC ISO strings for the current local ISO week (Monday 00:00 to Sunday 23:59:59 in the
user's timezone). **Verify** first: which time variables TRMNL exposes to polling URLs (the docs mention global
variables such as the user's timezone and a timestamp) and whether Liquid date math there works. If it doesn't,
fall back to omitting the dates (Tredict then returns from today on) and accept that missed past sessions this week
only show via the activity list. Design call.

Relevant response fields (from Tredict's docs):

- `plannedTrainingList` → `_embedded.plannedWorkoutList[]`: `id`, `date`, `timezone` (hours), `sportType`, optional
  `title`, `notes`, `distance` (m), `duration` (s), `executedTrainingId`. Don't derive pace from distance/duration
  (Tredict's own warning).
- `activityList` → `_embedded.activityList[]`: `id`, `date`, `sportType`, optional `isFromGarminApi`, `attribution`;
  with `extendedSummary=1` also summary metrics. **Verify** the exact extended-summary keys against a real response
  (the detail endpoint uses `distance`, `duration`, `heartrate`, `pace` in s/km; expect the same).
- `efforts` → `trainingEfforts`: `{ "YYYYMMDD": [[effort, {isRace?, unconfirmed?}], ...] }`.

Real responses are personal training data and never get committed. Capture one of each into the gitignored
`tests/fixtures/private/` to learn the exact shape. Committed fixtures in `tests/fixtures/tredict/` are synthetic: same
structure, invented ids, dates, titles, notes and metrics, no token anywhere.

## Settings

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `tredict_token` | password field if TRMNL has one, else string | | Help text: create it in Tredict → Settings → Personal API, scope `activityRead` only; open the Tredict app every 10 days or the token pauses |
| `lat`, `lon` | number | | Help text: where you usually start your runs. Design call: separate fields, because a geocoding step would add a dependency. **Verify** whether TRMNL exposes the user's location to plugins; if so, default to it |
| `availability` | string | `07-09,12-14,17-21` | Same format as the API's `avail` |
| `dark` | select: OK to run in the dark (`ok`), Avoid darkness (`avoid`) | `avoid` | |
| `rain` | select: 20 / 40 / 60 % | `40` | Max chance of rain in a window |
| `sport` | select: Running only (`running`), All sports (`all`) | `running` | Calendar filter. Form always uses all sports, since effort is cumulative |
| `language` | select: Device language (`device`), English (`en`), Nederlands (`nl`) | `device` | Same resolution rules as eu-dayahead's plugin; unsupported locales fall back to English |

Quote every select value in YAML (eu-dayahead's lesson: TRMNL's Ruby YAML reads unquoted `no` as `false`).

## Screen (full, 800x480)

```
┌────────────────────────────┬───────────────────────────────────┐
│ WEEK 45                    │ FORM (est.)                  +4   │
│ Mo ✓ 8.2 km · 5:41 · 142   │  ╭─╮    ╭──╮                       │
│ Tu ✓ Strength (if "all")   │ ─╯ ╰────╯  ╰──╮- - - (planned)     │
│ We ▶ 10 km Z2 · 60 min     │ 6 weeks back | today | 7 days ahead│
│ Th   Rest                  ├───────────────────────────────────┤
│ Fr   45 min intervals      │ BEST TIME TODAY · 60 min           │
│ Sa   —                     │ 12:15–13:15                        │
│ Su   16 km long run        │ dry · 18 km/h SW · 8°C             │
│                            │ start into the wind (SW)           │
│ 18 / 42 km · 1:42 / 4:30   │ Alt 17:00–18:00 · dark after 17:07 │
└────────────────────────────┴───────────────────────────────────┘
  Garmin · Weather data by Open-Meteo.com                (tiny)
```

Left column, about 45% wide:

- One row per day, Monday first. Today's row is inverted (white on black).
- Done: ✓ plus actual distance, pace (min/km) and average heart rate from the matched activity.
- Planned, not done: title (or a sport-type default) plus planned duration and/or distance.
- Missed (past day, planned, nothing done): the plan text struck through or marked with ✗ (design call, pick what
  reads better in 1-bit).
- Nothing planned: "—". Up to 2 sessions per day; more shows "+1".
- Footer: done vs planned this week, distance and time, for the filtered sport.
- Matching actuals to plans: a plan with `executedTrainingId` matches that activity. Activities without a plan still
  show on their day.

Right top, form graph (Highcharts, as in eu-dayahead):

- 6 weeks back to 7 days ahead. One line; the future part dashed (built from `unconfirmed` efforts). Today's value as
  a large number top right. No fitness/fatigue lines: three lines turn to grey noise in 1-bit.

Right bottom, run window:

- Duration: today's first remaining planned session for the filtered sport, rounded up to the next 15 minutes to pick
  `windows[key]`. If today's sessions are all done, or today is a rest day, show tomorrow's with "TOMORROW" in the
  heading. If no plan within two days, show 60 minutes and say "no session planned".
- Shows the API's window: time range, conditions, and "start into the wind (SW)". When `windows[key]` is `null`, show
  "No dry window in your hours" plus the `fallback` if present, clearly labelled as such.
- One extra line: either an alternative (the next-best window isn't in the API in v1, so design call: show daylight
  end instead, "dark after 17:07") or nothing.
- Use the API's fields, not its `label`, so the plugin controls wording and fits the space.

## Form

Tredict exposes daily efforts, not a form value. Compute in the template's JS:

- Daily load = sum of that day's efforts (planned ones included for future days).
- Fitness = 42-day exponentially weighted average, fatigue = 7-day, form = fitness − fatigue (the common
  CTL/ATL/TSB model; design call).
- Warm up on the full year the endpoint returns, so the first displayed day is stable.
- Label it "Form (est.)" / "Vorm (schatting)". **Verify** against the form Tredict shows in its app for the maintainer's data.
  If they differ materially, try to match Tredict's constants (ask Tredict if needed) before publishing; never imply it
  is Tredict's number until they match.

## Errors and empty states

Decide per panel, so one failure doesn't blank the screen:

- Tredict 401 (any of IDX 0–2): whole left column and graph replaced by "Tredict token paused or invalid. Open the
  Tredict app to reactivate it." This will be the most common failure (10-day rule).
- Tredict 403: "Token lacks the activityRead scope."
- No plan this week: calendar shows actuals only, footer shows done totals only.
- Run-window API error or missing `lat`/`lon`: the bottom-right panel says so ("Set your location in the plugin
  settings" / "Weather unavailable"); the rest renders.
- **Verify** how TRMNL presents a non-2xx response for one of several polling URLs (absent `IDX_n`, an error object, or
  the whole render failing). Design the checks around what it actually does, and add fixtures for it.

## Privacy

- The token only travels from TRMNL to Tredict and, because of the single headers field, to `run.xadi.eu`, which
  strips it before anything else. The recipe description says so in one sentence.
- No other server sees Tredict data. All Tredict processing happens in the render.
- Tredict's API terms say it is not a data proxy and does not allow automated forwarding of other parties' data. This
  design forwards nothing: TRMNL fetches on the user's behalf with the user's own Personal API token. Design call;
  The maintainer may want to mention the plugin to Tredict before publishing.

## Language

- en and nl in v1. Strings: day abbreviations, "week", headings, the panel messages above, "start into the wind",
  "dark after", "tomorrow", "no session planned", "Form (est.)".
- Dates, numbers and times via `Intl` in the resolved language, in the user's timezone.

## Refresh

`refresh_interval`: 30 minutes (design call). Fresh enough that a finished run appears soon after syncing, low enough
for Tredict's per-IP limits.

## Verification

Extend eu-dayahead's liquidjs harness for 4 polling URLs. Fixtures and cases:

- A normal week (mixed done, planned, missed, rest), today in the middle of the week.
- Monday morning (nothing done yet) and Sunday evening (week complete).
- Two sessions on one day; a run without a plan; "all sports" vs "running only".
- Today's run done → window shows tomorrow; rest day; no plan within two days.
- Planned duration 52 min → `"60"` key; 200 min → `"180"` with the "doesn't fully fit" note.
- Run window `null` with fallback, and without.
- Tredict 401, 403; run-window 503; missing lat/lon.
- Garmin attribution present and absent.
- en, nl, unknown locale.
- Form: compare the computed series for a private fixture against values read from the Tredict app on a few dates.
  This is a local check: it reads `tests/fixtures/private/` and must not make `npm test` fail where that folder is
  absent. Committed form tests use synthetic efforts.
- 1-bit screenshots of the full layout in TRMNL's editor preview on the original device. Note, don't block on, TRMNL X.

## Rollout

1. Run-window API live and its rollout checks done.
2. Build as a private plugin on the maintainer's account; run the "Verify" items above first, since several design calls
   depend on them (date math in polling URLs, per-URL headers, error handling, location variable).
3. Use it for two weeks. Tune the API's scoring on real runs and check the form estimate.
4. Publish as a recipe. Optionally tell Tredict.

## Left to the builder

- Exact typography, spacing and row layout, as long as it reads from a few metres in 1-bit.
- How to embed the four responses safely in JS (eu-dayahead's `json` filter approach).
- Whether missed sessions use strike-through or ✗.
