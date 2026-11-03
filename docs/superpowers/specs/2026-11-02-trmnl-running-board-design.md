# TRMNL plugin: Running Board

Date: 2026-11-02, revised 2026-11-03
Status: awaiting approval
Plugin: `integrations/trmnl-running-board/`
Depends on: Run-window API (`2026-11-02-run-window-api-design.md`), live at `run.xadi.eu` since 2026-11-03

## Intent

One full TRMNL screen dedicated to running, for someone who plans their training in Tredict:

- **Left, full height:** this week, Monday to Sunday. Planned sessions, and actuals for what's done.
- **Right top:** form over the last weeks, with the planned weeks ahead.
- **Right bottom:** today's best time to run, sized to today's planned session.

The maintainer uses it first, as a private plugin. Publishing it as a TRMNL recipe for other Tredict users is a goal
only if Tredict agrees (see "Tredict's terms"). Either way, no backend holds anyone's Tredict token or data.

## Goals

- Backend-free for Tredict: TRMNL polls Tredict directly with the user's Personal API token.
- The run window matches today's planned session length (or tomorrow's, see "Run window").
- Glanceable from across a room on the original 800x480 device in 1-bit.
- Honest failure: an inactive token, a missing plan, a weather outage or stale weather each get a clear message, never a
  blank or a stale-but-confident screen.

## Non-goals

- Layouts other than `full` in v1. Half and quadrant layouts (for example only the run window) are a v1.1 candidate.
- Weekly 80/20 zone split. It needs one activity-detail call per activity; not in v1.
- HRV, sleep, Whoop or any recovery data.
- Routes or maps.
- Imperial units. Metric only.
- Writing anything to Tredict. Read-only scopes.

## Anti-goals

- The Tredict token is sent anywhere it doesn't have to go, or logged by the run-window service (see "Privacy").
- The screen recommends a window, or words its conditions, in a way that contradicts the run-window API. The plugin does
  no weather logic of its own.
- The form graph is presented as Tredict's own number when it is our estimate (see "Form").

## Verify first

The plan's first task runs these on a private plugin, because several design calls below depend on them. Each lists
what to do if the answer is no.

| # | Question | Depends on it | If no |
|---|----------|---------------|-------|
| V1 | Does `fetch()` from the markup's JS work at render time, for `run.xadi.eu`? Undocumented. | Privacy, Polling URLs | Keep the run window as polling URL IDX 3 |
| V2 | Does TRMNL offer per-URL headers? The docs describe one headers field for all URLs. | Privacy | The token also goes to `run.xadi.eu`, which strips it |
| V3 | What does a non-2xx response from one of several polling URLs look like: an absent `IDX_n`, an error object, or a failed render? Undocumented. | Errors | Design the per-panel checks around what it does; add fixtures for it |
| V4 | Which time variables do polling URLs get (the docs mention the user's timezone and a timestamp), and does Liquid date math work there? | IDX 0 dates | Omit the dates: Tredict then returns from today on, and missed past sessions this week only show via the activity list |
| V5 | Do `round` and `split` work in polling-URL Liquid? Test with the Parse button. | IDX 3 coordinates | Without `round`, polled coordinates are exact. The API rounds them before logging or caching, but they would leave TRMNL unrounded |
| V6 | What does a `lat_lon` field's value look like (for example `"52.37,4.89"`)? | Settings | Two `number` fields, `lat` and `lon` |
| V7 | Is a `password` field masked in the settings form and in TRMNL's own logs? | Settings | Use it anyway; say in the help text that the token is visible |
| V8 | Is there a size limit on polling responses? A year of efforts can be large. Undocumented. | Form | Ask Tredict's `efforts` for a shorter range, and say the first weeks of the graph are less settled |
| V9 | What are the exact `extendedSummary=1` keys in a real `activityList` response? | Calendar | Read them from the private fixture; the detail endpoint uses `distance`, `duration`, `heartrate`, `pace` in s/km |
| V10 | Does the computed form match what Tredict's app shows for the maintainer's data? | Form | See "Form" |

## Constraints (from TRMNL and Tredict docs, 2026-11-02)

- **Multiple polling URLs:** one per line; responses arrive as `IDX_0`, `IDX_1`, … in polling order. Polling URLs are
  rendered with Liquid first and then split on line breaks.
- **One headers field** for all polling URLs (V2): `authorization=bearer {{ tredict_token }}` goes to every URL,
  including the run-window API if it is polled (V1). That API strips it (see its spec).
- **Tredict Personal API:** bearer token with chosen scopes. Needs `activityRead` only. The token goes **inactive
  (401) unless the user opens the Tredict app at least once every 10 days**; it reactivates on the next visit.
- **Tredict rate limits** are per IP, and all TRMNL polls come from TRMNL's few server IPs. Activity download is limited
  to 10 requests/second. Fine for a handful of installs; note it if the recipe grows.
- **Run-window API limits:** 20 requests per second per IP, which every TRMNL install shares when the API is polled;
  and 300 distinct rounded locations per UTC day for the whole service. Both are far above a handful of installs, and
  both are the recipe's ceiling.
- **Garmin attribution:** activities from Garmin carry `isFromGarminApi: true` and an `attribution` string. If the
  screen shows such data, it must show the attribution visibly.
- **Open-Meteo attribution** must be shown when showing the run window (the API returns it as `attribution`).
- Plugin format and the shared/layout split as in eu-dayahead's TRMNL plugin (see its design doc): `settings.yml`,
  `shared.liquid`, `full.liquid`, files ≤ 100 KB, animations off, chart IDs via `append_random`.

## Tredict's terms

Tredict's terms (effective 12 Oct 2026) say the Personal API token is for personal, semi-automated use, and that "it
is prohibited to use the external interfaces to forward data to third parties in an automated manner". A TRMNL
plugin polling Tredict every 30 minutes may count as automated use, and Tredict can block tokens. This is a reading of
the terms, not a legal opinion.

- **Private plugin on the maintainer's own account:** the lowest-risk case. Build and use it.
- **Published recipe:** only after Tredict has said in writing that it is fine. The maintainer asks before step 4 of the
  rollout, not after.

## Polling URLs

In this order (the indices are part of the contract with the template):

| IDX | URL | Purpose |
|-----|-----|---------|
| 0 | `https://www.tredict.com/api/oauth/v2/plannedTrainingList?startDate={monday}&endDate={sunday}` (+ `&sportType=running` if the sport setting says so) | This week's plan |
| 1 | `https://www.tredict.com/api/oauth/v2/activityList?pageSize=50&extendedSummary=1` | Actuals; newest first, filter to this week in JS |
| 2 | `https://www.tredict.com/api/oauth/v2/efforts` | Daily effort per training; defaults cover 1 year back to 1 month ahead, including planned (`unconfirmed`) sessions |
| 3 | `https://run.xadi.eu/api/window?lat={lat}&lon={lon}&avail={{ availability }}&dark={{ dark }}&rain={{ rain }}` | Run window. Only if V1 fails; otherwise the markup fetches the same URL |

- `{lat}` and `{lon}` are the location setting rounded to 2 decimals (V5, V6). No `lang`: the plugin builds its own
  text from the API's fields, so it never uses `label`.
- `{monday}` and `{sunday}` are UTC ISO strings for the current local ISO week (Monday 00:00 to Sunday 23:59:59 in the
  user's timezone), if V4 allows.

Relevant response fields (from Tredict's docs):

- `plannedTrainingList` → `_embedded.plannedWorkoutList[]`: `id`, `date`, `timezone` (hours), `sportType`, optional
  `title`, `notes`, `distance` (m), `duration` (s), `executedTrainingId`. Don't derive pace or duration from distance
  (Tredict's own warning).
- `activityList` → `_embedded.activityList[]`: `id`, `date`, `sportType`, optional `isFromGarminApi`, `attribution`;
  with `extendedSummary=1` also summary metrics (V9).
- `efforts` → `trainingEfforts`: `{ "YYYYMMDD": [[effort, {isRace?, unconfirmed?}], ...] }`.

Real responses are personal training data and never get committed. Capture one of each into the gitignored
`tests/fixtures/private/` to learn the exact shape. Committed fixtures in `tests/fixtures/tredict/` are synthetic: same
structure, invented ids, dates, titles, notes and metrics, no token anywhere.

## Settings

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `tredict_token` | `password` (V7) | | Help text: create it in Tredict → Settings → Personal API, scope `activityRead` only; open the Tredict app every 10 days or the token pauses |
| `location` | `lat_lon`, with TRMNL's city and postcode search (V6) | | Help text: where you usually start your runs. Fallback: two `number` fields, `lat` and `lon` |
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
│ 18 / 42 km · 1:42 / 4:30   │ dark after 17:07                   │
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

## Run window

Which day:

- Today, unless one of these holds, then tomorrow with "TOMORROW" in the heading: today's sessions for the filtered sport
  are all done; today is a rest day; or the current time is past the end of today's last `availability` range. The API
  never returns a window that starts in the past, so after that point every one of today's windows is null whatever the
  weather.
- The API's `days[0]` is today and `days[1]` tomorrow, in the location's timezone.

Which length:

- The first remaining planned session that day, for the filtered sport. Its `duration`, rounded up to the next 15
  minutes, picks `windows[key]` (`"15"` to `"180"`). Over 180 minutes: use `"180"` and say the session doesn't fully fit.
- A planned session with no `duration` (Tredict makes both `duration` and `distance` optional): use `"60"` and say
  "60 min (no duration planned)". Never estimate a duration from distance.
- No plan within two days: use `"60"` and say "no session planned".

What it shows:

- Time range in the location's timezone, then conditions from the API's fields: rain wording, `windAvg` with
  `windFromCardinal`, and `apparentTempAvg`. "Start into the wind (SW)" from `windFromCardinal`.
- Rain wording follows the API's own rule, so the two never disagree: "dry" / "droog" only when `qualifies` is true and
  `precipProbMax` is 20 or less; otherwise "rain N%" / "regen N%" with `precipProbMax`.
- One extra line: "dark after 17:07" from that day's `sunset`, or nothing when `sunset` is null (polar day or night).
  The API has no next-best window in v1, so there is no alternative line.
- `warnings` containing `stale_data`: add "weather may be out of date" to the panel. The window still shows.

When `windows[key]` is null (design call):

1. The longest shorter key that is not null, shown with its own length ("Only 45 min dry in your hours").
2. Else, if `fallback` is present: it is always 60 minutes and never qualifies. Show it as "No dry window. Least bad
   60 min:", with its rain wording, which is never "dry".
3. Else: "No dry window in your hours".

## Form

Tredict exposes daily efforts, not a form value. Compute in the template's JS:

- Daily load = sum of that day's efforts (planned ones included for future days).
- Fitness = 42-day exponentially weighted average, fatigue = 7-day, form = fitness − fatigue (the common
  CTL/ATL/TSB model; design call).
- Warm up on the full year the endpoint returns, so the first displayed day is stable (V8).
- Label it "Form (est.)" / "Vorm (schatting)". Check it against the form Tredict shows in its app for the maintainer's
  data (V10). If they differ materially, try to match Tredict's constants (ask Tredict if needed) before publishing;
  never imply it is Tredict's number until they match.

## Errors and empty states

Decide per panel, so one failure doesn't blank the screen. How a failed polling URL shows up depends on V3.

- Tredict 401 (any of IDX 0–2): whole left column and graph replaced by "Tredict token paused or invalid. Open the
  Tredict app to reactivate it." This will be the most common failure (10-day rule).
- Tredict 403: "Token lacks the activityRead scope."
- No plan this week: calendar shows actuals only, footer shows done totals only.
- Location not set: the bottom-right panel says "Set your location in the plugin settings"; the rest renders.
- Run-window API 503, 429 or any other error: the bottom-right panel says "Weather unavailable"; the rest renders.

## Privacy

Depends on V1 and V2:

- **If `fetch()` works (V1):** the run window is fetched from the markup, without the token, so the token only travels
  from TRMNL to Tredict.
- **If not, but TRMNL has per-URL headers (V2):** the token is set on the Tredict URLs only. Same result.
- **Otherwise:** the token also reaches `run.xadi.eu`, which removes it in nginx before it reaches the app, and again in
  the app. The recipe description says so in one sentence.

In every case:

- No other server sees Tredict data. All Tredict processing happens in the render.
- `run.xadi.eu` gets the location rounded to 2 decimals, the availability hours and the two weather settings. It logs
  the location rounded to 1 decimal only.

## Language

- en and nl in v1. Strings: day abbreviations, "week", headings, the panel messages above, "start into the wind",
  "dark after", "tomorrow", "no session planned", "no duration planned", the null-window lines, "weather may be out of
  date", "Form (est.)".
- Dates, numbers and times via `Intl` in the resolved language, in the user's timezone.

## Refresh

`refresh_interval`: 30 minutes (design call). Fresh enough that a finished run appears soon after syncing, low enough
for Tredict's per-IP limits. It also keeps a location admitted by the run-window API across UTC midnight, because the
API keeps locations it has cached at midnight and holds entries for 3 hours.

## Verification

Extend eu-dayahead's liquidjs harness for 4 polling URLs, or for 3 plus a faked `fetch()` if V1 works. Fixtures and
cases:

- A normal week (mixed done, planned, missed, rest), today in the middle of the week.
- Monday morning (nothing done yet) and Sunday evening (week complete).
- Two sessions on one day; a run without a plan; "all sports" vs "running only".
- Run window: today's run done, rest day, and past today's last availability range → tomorrow; no plan within two
  days.
- Planned duration 52 min → `"60"` key; 200 min → `"180"` with the "doesn't fully fit" note; no duration → `"60"`
  with "no duration planned".
- `windows[key]` null with a shorter key available; with only `fallback`; with neither.
- Rain wording: qualifying at 20% says "dry"; qualifying at 30% says "rain 30%"; the fallback never says "dry".
- `stale_data` warning; `sunset` null.
- Tredict 401, 403; run-window 503 and 429; location not set; whatever V3 shows for a failed URL.
- Garmin attribution present and absent.
- en, nl, unknown locale.
- Form: compare the computed series for a private fixture against values read from the Tredict app on a few dates.
  This is a local check: it reads `tests/fixtures/private/` and must not make `npm test` fail where that folder is
  absent. Committed form tests use synthetic efforts.
- 1-bit screenshots of the full layout in TRMNL's editor preview on the original device. Note, don't block on, TRMNL X.

## Rollout

1. Run-window API live and its rollout checks done. Done 2026-11-03, apart from the TRMNL request check, which needs
   this plugin.
2. Build as a private plugin on the maintainer's account, starting with "Verify first".
3. Use it for two weeks. Tune the API's scoring on real runs and check the form estimate.
4. Publish as a recipe, only if Tredict has agreed (see "Tredict's terms").

## Left to the builder

- Exact typography, spacing and row layout, as long as it reads from a few metres in 1-bit.
- How to embed the responses safely in JS (eu-dayahead's `json` filter approach).
- Whether missed sessions use strike-through or ✗.
