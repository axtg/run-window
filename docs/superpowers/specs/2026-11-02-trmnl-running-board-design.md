# TRMNL plugin: Running Board

Date: 2026-11-02, revised 2026-11-03 and 2026-11-04
Status: approved 2026-11-03; data flow revised the same day after "Verify first" (answers in
`2026-11-03-trmnl-running-board-verify.md`). Revised 2026-11-04 after Tredict's reply: Tredict calls in sequence with
429 handling, a paused-token message, and the week's intensity bar (see "Tredict calls" and "Intensity").
Plugin: `integrations/trmnl-running-board/`
Depends on: Run-window API (`2026-11-02-run-window-api-design.md`), live at `run.xadi.eu` since 2026-11-03

## Intent

One full TRMNL screen dedicated to running, for someone who plans their training in Tredict:

- **Left, full height:** this week, Monday to Sunday. Planned sessions, and actuals for what's done.
- **Right top:** form over the last weeks, with the planned weeks ahead, and this week's time at low, moderate and
  high intensity beneath it.
- **Right bottom:** today's best time to run, sized to today's planned session.

The maintainer uses it first, as a private plugin. Publishing it as a TRMNL recipe for other Tredict users is a goal
only if Tredict agrees (see "Tredict's terms"). Either way, no backend holds anyone's Tredict token or data.

## Goals

- Backend-free for Tredict: the plugin's transform script, inside TRMNL, calls Tredict directly with the user's
  Personal API token. The token goes to Tredict and nowhere else.
- The run window matches today's planned session length (or tomorrow's, see "Run window").
- Glanceable from across a room on the original 800x480 device in 1-bit.
- Honest failure: an inactive token, a missing plan, a weather outage or stale weather each get a clear message, never a
  blank or a stale-but-confident screen.

## Non-goals

- Layouts other than `full` in v1. Half and quadrant layouts (for example only the run window) are a v1.1 candidate.
- Zone-by-zone splits or a pace/power basis for intensity. The intensity bar uses Tredict's three heart-rate ranges
  only (see "Intensity"; added 2026-11-04 at Tredict's suggestion).
- HRV, sleep, Whoop or any recovery data.
- Routes or maps.
- Imperial units. Metric only.
- Writing anything to Tredict. Read-only scopes.

## Anti-goals

- The Tredict token is sent anywhere it doesn't have to go, or logged by the run-window service (see "Privacy").
- The screen recommends a window, or words its conditions, in a way that contradicts the run-window API. The plugin does
  no weather logic of its own.
- The form graph shows Tredict's performance number, computed with Tredict's own model (see "Form").

## Verify first

Answered on 2026-11-03; see `2026-11-03-trmnl-running-board-verify.md`. The decisive finding: TRMNL's transform script
can fetch, so it calls Tredict itself and the plugin polls only the run-window API. V1, V2 and V4 are moot as a result. The table stays as the record of what was asked.

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

- **Transform script** (`transform.js`): runs after every poll in TRMNL's Node runtime (Node 24, `fetch`, built-ins
  only, no packages, 5 s and 128 MB per the docs). It gets the polled response, the custom field values (password
  fields in clear) and the previous merge variables, and its return value becomes the merge variables. If it throws,
  TRMNL silently keeps the previous merge variables. Its `Intl` has English locale data only, though timezones work.
- **A failed polled URL** arrives as `{}` (the status is lost); the script still runs.
- **One headers field** for all polling URLs. The plugin sets none.
- **Tredict Personal API:** bearer token with chosen scopes. Needs `activityRead` only, which covers all three
  endpoints. An invalid token gets 403. The token goes **inactive unless the user opens the Tredict app at least once
  every 10 days**; it reactivates on the next visit.
- **Tredict rate limits** are per IP, and all TRMNL polls come from TRMNL's few server IPs. Activity download is limited
  to 10 requests/second. Tredict (2026-11-04): the volume is fine if requests are serialised, not parallel, and HTTP
  429 is respected with a proper retry; otherwise the IP gets rejected. At recipe scale every install shares TRMNL's
  IPs, so stopping on a 429 protects all of them (see "Tredict calls").
- **Paused token:** Tredict answers 401 with "Please log into the Tredict web app to automatically reactivate this
  token. ..." (2026-11-04). An invalid token or missing scope gets 403.
- **Run-window API limits:** 20 requests per second per IP, which every TRMNL install shares, since all polls and
  scripts run from TRMNL's servers; and 300 distinct rounded locations per UTC day for the whole service. Both are far above a handful of installs, and
  both are the recipe's ceiling.
- **Garmin attribution:** activities from Garmin carry `isFromGarminApi: true` and an `attribution` string. If the
  screen shows such data, it must show the attribution visibly.
- **Open-Meteo attribution** must be shown when showing the run window (the API returns it as `attribution`).
- Plugin format and the shared/layout split as in eu-dayahead's TRMNL plugin (see its design doc): `settings.yml`,
  `shared.liquid`, `full.liquid`, plus `transform.js`, files ≤ 100 KB, animations off, chart IDs via `append_random`.

## Tredict's terms

Tredict's terms (effective 12 Oct 2026) say the Personal API token is for personal, semi-automated use, and that "it
is prohibited to use the external interfaces to forward data to third parties in an automated manner". A TRMNL
plugin polling Tredict every 30 minutes may count as automated use, and Tredict can block tokens. This is a reading of
the terms, not a legal opinion.

- **Private plugin on the maintainer's own account:** the lowest-risk case. Build and use it.
- **Published recipe:** only after Tredict has said in writing that it is fine. The maintainer asks before step 4 of the
  rollout, not after.

## Data flow

One polling URL, no headers:

`https://run.xadi.eu/api/window?lat={lat}&lon={lon}&avail={{ availability | url_encode }}&dark={{ dark }}&rain={{ rain }}`

- `{lat}` and `{lon}` are the `lat_lon` setting (`"52.37,4.89"`) rounded to 2 decimals in Liquid. No `lang`: the
  plugin builds its own text from the API's fields, so it never uses `label`.
- Its `generatedAt` changes on every poll, so the merge variables change and TRMNL redraws the screen even on days
  Tredict's data doesn't change.

The transform script then calls Tredict one request at a time, in this order (see "Tredict calls"):

| Name | URL | Purpose |
|------|-----|---------|
| plan | `https://www.tredict.com/api/oauth/v2/plannedTrainingList?startDate={from}&endDate={to}` | This week's plan, plus tomorrow on a Sunday |
| activities | `https://www.tredict.com/api/oauth/v2/activityList?pageSize=50&extendedSummary=1` | Actuals; newest first, filtered to this week |
| efforts | `https://www.tredict.com/api/oauth/v2/efforts` | Daily effort; defaults cover 1 year back to 1 month ahead |
| detail | `https://www.tredict.com/api/oauth/v2/activity/{id}?extraValues=1` | One per activity of this week not yet cached, for "Intensity" |

The script retries the run-window API itself only when the polled body failed (see "Errors and empty states"). That
call is not Tredict's, so it runs alongside the Tredict sequence.

- Headers: `Authorization: Bearer {token}` and `Accept: application/json;charset=UTF-8`.
- `{from}` and `{to}` are UTC ISO strings from the day before this local Monday to the day after next Monday, in the
  user's timezone. The script filters by local date.
- The script returns a small, screen-ready set of merge variables: day rows, footer totals, the form series, the run
  window panel, attribution flags, and `fetchedAt`. It never passes raw responses through: an activity's `summary`
  holds start coordinates.

Relevant response fields (from Tredict's docs):

- `plannedTrainingList` → `_embedded.plannedWorkoutList[]`: `id`, `date` (UTC), `timezone` (UTC offset in hours),
  `sportType`, optional `title`, `notes`, `distance` (m), `duration` (s), `executedTrainingId`. A done plan stays in
  the list. Don't derive pace or duration from distance (Tredict's own warning).
- `activityList` → `_embedded.activityList[]`: `id`, `date` (UTC), `timezone` (IANA), `sportType`, optional
  `isFromGarminApi`, `attribution`; with `extendedSummary=1` also `summary` (`distance`, `duration`, `heartrate`,
  `pace` in s/km, and start coordinates).
- `efforts` → `trainingEfforts`: `{ "YYYYMMDD": [[effort, {isRace?, unconfirmed?}], ...] }`, keyed by local date. Once
  a planned session is done, its `unconfirmed` entry is replaced by the confirmed one.
- `activity/{id}?extraValues=1` → `summary.intensityDistribution.heartrate`: `{ "0": s, "1": s, "2": s }`, seconds in
  Tredict's low, moderate and high ranges; they sum to `summary.duration`. `null` when the activity has no heart rate.
  Checked on the maintainer's data 2026-11-04: without `extraValues=1` the field is absent, and `activityList` never
  has it. A response is about 86 KB, almost all of it `seriesSampled`; the script reads only this one field. The id
  is the list's `id` (the detail calls it `_id`).

## Tredict calls

In sequence, never in parallel (Tredict's condition, see "Constraints"):

- One shared deadline for the whole Tredict sequence: 4 s after the script starts, leaving a second of TRMNL's 5 s
  for the rest. Each call's timeout is the smaller of 3 s and the time left; a call is not started with under 500 ms
  left, and counts as a timeout.
- Order: plan, activities, efforts, then detail calls. The first failure of plan, activities or efforts ends the
  sequence: later calls would fail the same way, and the panels fall back as a whole anyway.
- Detail calls: at most 3 per poll, each only with at least 1 s left. Any others wait for the next poll.
- HTTP 429 from any call ends the sequence at once, with no further Tredict request in that run. The script sets
  `tredictRetryAt` to now plus the response's `Retry-After` seconds, clamped to 30 minutes .. 6 hours, or 30 minutes
  without a readable header. Until then, runs make no Tredict calls and show the previous panels under the stale
  rule ("Errors and empty states"). Like `weatherRetryAt`, it is anchored: skipping doesn't renew it, and a run after
  it passes calls Tredict again.
- 429 on a detail call after the panels loaded: the panels show as normal. The pause still applies, so the next run
  shows them as stale.
- `Retry-After` as an HTTP date, or anything but whole seconds, counts as unreadable (design call).
- Every output carries `tredictRetryAt` and `intensityCache` forward while they are valid, including runs that make
  no Tredict call and the fixed error output, so a throw can't drop a pause (design call).

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
│ WEEK 45                    │ FORM                         4    │
│ Mo ✓ 8.2 km · 5:41 · 142   │  ╭─╮    ╭──╮                       │
│ Tu ✓ Strength (if "all")   │ ─╯ ╰────╯  ╰──╮- - - (planned)     │
│ We ▶ 10 km Z2 · 60 min     │ 6 weeks back | today | 7 days ahead│
│                            │ Intensity this week · 2:42         │
│                            │ [     low      |///mod///|█high█]  │
│                            │ low 78%    moderate 17%    high 5% │
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

Right top, form graph (an SVG path computed by the transform script, so no JS runs at render):

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

Tredict exposes daily efforts, not a form value. Compute in the transform script:

- Daily load = sum of that day's efforts: confirmed ones for past days, all of them for today and later (a done
  session's planned entry is already gone, so nothing counts twice).
- Fitness(d) = fitness(d−1) · e^(−1/14) + load(d); fatigue(d) = fatigue(d−1) · e^(−1/9) + load(d), both from 0 on the
  first day with data. Form = Tredict's performance = 1.66 · fitness − 2 · fatigue, shown as a rounded integer. The
  maintainer's 64 days of Tredict's own series match exactly (V10).
- Warm up on the full year the endpoint returns, so the first displayed day is stable (V8).
- Label it "Form" / "Vorm". The model was fitted against the form Tredict shows in its app for the maintainer's data
  and matches it on every day (V10).

## Intensity

Tredict's suggestion (2026-11-04): this week's intensity distribution beneath the form curve, in the band that is
empty today. The maintainer approved a mockup of the layout in "Screen" the same day.

What it counts:

- This week's done activities as the calendar has them: Monday to now, local, the `sport` setting's filter, planned
  or not, including any beyond the 2 rows a day shows.
- Per activity, `summary.intensityDistribution.heartrate` from its detail call: seconds at low, moderate and high.
  Activities without heart rate add nothing. Heart rate because Tredict's own card shows it first and every run
  with a watch has it.

Cache, so a finished run costs one detail call, once:

- The output carries `intensityCache`: a list of `[id, low, moderate, high]`, the id a string, the three
  finite non-negative seconds. An activity without heart rate is cached as `[id, 0, 0, 0]`, so it isn't fetched
  again.
- Each run reads it from the previous merge variables field by field (as with `reuseWeek`), keeps only this week's
  ids and adds the new ones. Nothing else from a detail response is kept. It never grows past one week.
- A run is not re-fetched if Tredict recomputes its zones later. Design call: done runs rarely change.
- Newest activities are fetched first (design call). A 404, or a 2xx without `summary.intensityDistribution`, is
  cached as zeros, since asking again won't help; 5xx, timeout and 429 are retried on a later run (design call).
- `BOARD_VERSION` stays 1; the new fields are read defensively (design call).

What it shows:

- When every activity of this week is in the cache and their total is above zero: a heading "Intensity this week ·
  {h:mm}" (the total), one bar the width of the graph split low / moderate / high, and "low N%  moderate N%  high N%"
  beneath it. Percentages round to whole numbers that sum to 100 (largest remainder).
- 1-bit: low white with a black outline, moderate black diagonal stripes, high solid black, drawn in SVG (no
  gradients, no dithering). A non-zero range gets at least 4 px so it stays visible.
- When some activity isn't cached yet (budget, a failed or rate-limited detail call): no bar this run. It appears
  once the cache is complete, normally the next poll. When the total is zero (Monday morning, no heart rate): no
  bar.
- The graph gives up height for it, so the run panel keeps all its lines on the 800x480 screen. Checked in the
  preview and on the device.
- Garmin: an activity that adds to the bar with `isFromGarminApi: true` puts its `attribution` in the footer, as
  calendar rows do.
- Stale panels (see "Errors and empty states") reuse the previous output's bar with them.

## Errors and empty states

Decide per panel, so one failure doesn't blank the screen. The script never throws: a throw would silently keep the
previous screen. Every output carries `fetchedAt`, printed small in the footer, so a frozen screen shows its age.

- Tredict 401 (plan, activities or efforts): the token is paused. Whole left column and graph replaced by "Tredict
  token paused. Open the Tredict web app to reactivate it." The 10-day rule makes this the most common failure.
- Tredict 403: "Tredict token invalid. Check it has the activityRead scope."
- Tredict 402: "Tredict says this account can't use the API."
- Tredict 5xx, 429, timeout or unreadable body, or a 429 pause in force: show the last good Tredict panels from the
  previous merge variables, with "Tredict data from {time}". With none, "Tredict unavailable". Last good data is from
  the same local day only, so a pause past midnight shows "Tredict unavailable" until it ends (design call: an old
  week is worse than none).
- A detail call failing in any way only affects the intensity bar (see "Intensity").
- No plan this week: calendar shows actuals only, footer shows done totals only.
- Location not set: the bottom-right panel says "Set your location in the plugin settings"; the rest renders.
- Run-window API error of any kind (the polled body then arrives empty, without `generatedAt`): the bottom-right panel
  says "Weather unavailable"; the rest renders. A 400 means a bad setting: "Check your hours setting".

## Privacy

- The token is stored in TRMNL (masked in the form) and sent only to Tredict, by the transform script. `run.xadi.eu`
  never receives it: the plugin sets no polling headers.
- No server outside TRMNL and Tredict sees Tredict data. The script keeps only what the screen needs, plus this
  week's activity ids with their three intensity totals (`intensityCache`), held in TRMNL's merge variables.
- `run.xadi.eu` gets the location rounded to 2 decimals, the availability hours and the two weather settings. It logs
  the location rounded to 1 decimal only.

## Language

- en and nl in v1. Strings: day abbreviations, "week", headings, the panel messages above, "start into the wind",
  "dark after", "tomorrow", "no session planned", "no duration planned", the null-window lines, "weather may be out of
  date", "Form", and "Intensity this week" / "Intensiteit deze week" with "low / moderate / high" / "laag / gemiddeld
  / hoog". The paused-token text in Dutch: "Tredict-token gepauzeerd. Open de Tredict-webapp om het weer te
  activeren."; the invalid one: "Tredict-token ongeldig. Controleer of het de scope activityRead heeft."
- Day and month names from the plugin's own en/nl tables, because TRMNL's runtime has English locale data only.
  Timezone conversion uses `Intl.DateTimeFormat` with `timeZone`, which works there.

## Refresh

`refresh_interval`: 30 minutes (design call). Fresh enough that a finished run appears soon after syncing, low enough
for Tredict's per-IP limits. It also keeps a location admitted by the run-window API across UTC midnight, because the
API keeps locations it has cached at midnight and holds entries for 3 hours.

## Verification

Jest tests the transform script directly, with a faked `fetch` and a fixed clock; eu-dayahead's liquidjs harness
renders the templates from the script's output. Fixtures and cases:

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
- Tredict 401, 403, 402, 5xx and timeout, with and without previous good data; run-window failure (empty body) and
  400; location not set.
- Garmin attribution present and absent.
- Tredict calls (a fake fetch that records when each call starts and settles): no Tredict call starts before the
  previous one settled; a 429 on any call means no later Tredict call that run, `tredictRetryAt` from `Retry-After`
  (clamped) or 30 minutes, and a following run inside the pause makes none; a run after it calls again; a slow
  first call shrinks later timeouts, and an exhausted deadline skips the rest; 401 gives the paused text, 403 the
  invalid one.
- Intensity: a cold cache with 4 activities fetches 3 and shows no bar, the next run fetches 1 and shows it; a warm
  cache makes no detail calls; ids from last week drop out; an activity without heart rate is cached as zeros;
  percentages sum to 100; a Garmin activity adds its attribution; a malformed `intensityCache` is ignored, not
  trusted. Synthetic detail fixtures, with invented seconds, in `tests/fixtures/tredict/`.
- en, nl, unknown locale.
- Form: compare the computed series for a private fixture against values read from the Tredict app on a few dates.
  This is a local check: it reads `tests/fixtures/private/` and must not make `npm test` fail where that folder is
  absent. Committed form tests use synthetic efforts.
- 1-bit screenshots of the full layout in TRMNL's editor preview on the original device. Note, don't block on, TRMNL X.

## Rollout

1. Run-window API live and its rollout checks done. Done 2026-11-03, apart from the TRMNL request check, which needs
   this plugin.
2. Build as a private plugin on the maintainer's account, starting with "Verify first".
3. Use it for two weeks. Tune the API's scoring on real runs and check the form graph.
4. Publish as a recipe, only if Tredict has agreed (see "Tredict's terms").

## Left to the builder

- Exact typography, spacing and row layout, as long as it reads from a few metres in 1-bit.
- How the graph series reaches the chart JS safely (an escaped data attribute, not script text).
- Whether missed sessions use strike-through or ✗.
