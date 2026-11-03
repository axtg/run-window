# TRMNL Running Board: verify answers

Task 1 of `docs/superpowers/plans/2026-11-03-trmnl-running-board.md`, run on 2026-11-03 against the maintainer's TRMNL
account with private probe plugins, Amsterdam coordinates (52.37, 4.89) and httpbin.org. This file holds names, shapes
and yes/no answers only: no token, no personal coordinates, no training values.

## The finding that changes the design

TRMNL private plugins can run a **transform script** (`transform.js`, "Serverless" in the editor). It runs after every
poll in TRMNL's Node runtime, with `fetch`, and whatever it returns becomes the merge variables the markup renders.

- It receives the polled responses (one URL: the body's keys at top level; several: `IDX_0`…`IDX_n`) and `trmnl`, with
  `trmnl.user`, `trmnl.device`, `trmnl.plugin_settings.custom_fields_values` (password fields included, in clear),
  `trmnl.state` and `trmnl.previous_merge_variables`.
- It can call Tredict with the token from a password field and get real status codes, and call `run.xadi.eu` with no
  token at all.
- So the plugin polls only `run.xadi.eu/api/window`, with no headers, and the script fetches Tredict. The token goes to
  Tredict only. The API's `generatedAt` changes on every poll, so the merge variables change and the screen redraws.

## Answers

| # | Question | Answer | Evidence | Branch taken |
|---|---|---|---|---|
| V1 | `fetch()` from the markup at render | Moot. Inline JS does run at render (`DOMContentLoaded` handler changed the text in the screenshot), but the script fetches instead. | Preview of probe markup | Markup JS only draws the graph |
| V2 | Per-URL headers | Moot. One headers field for all URLs (docs); the plugin sends no headers at all now. | Help article "Private plugins" | No headers |
| V3 | What a failed polled URL looks like | 401, 402 and 503 all arrive as `{}`; an HTML page arrives as `{ data: "<html…" }`. The status is lost. When the only URL fails, the script still runs and its input holds only `trmnl`. | Probe with five URLs; probe with a single 503 URL | Tredict is fetched by the script, not polled. Weather failure = no `generatedAt` in the input. |
| V3b | Script throws | TRMNL keeps the previous merge variables and shows nothing; the refresh reports `script_error`. | Probe throwing on run 2 | The script never throws; every output carries `fetchedAt` |
| V4 | Timezone variables | `trmnl.user.time_zone_iana` (`Europe/Amsterdam`), `trmnl.user.utc_offset` (seconds, `3600`), `trmnl.system.timestamp_utc`. | Script input | Script uses `time_zone_iana`, else the API's `location.timezone`, else `UTC` |
| V5 | `split` and `round` in polling-URL Liquid | Yes. `{% assign ll = lat_lon \| split: ',' %}…lat={{ ll[0] \| strip \| round: 2 }}` turned `52.373187,4.892241` into `lat=52.37&lon=4.89`; `availability \| url_encode` gave `07-09%2C+17-21`. TRMNL's own log line printed a fragment after the last comma of the URL, so the URL must hold no unrounded value. | Probe via httpbin | Round in the polling URL |
| V6 | `lat_lon` value | A `"lat,lon"` string, for example `"52.37,4.89"`. | Script input | `lat_lon` field |
| V7 | Password field masked | Yes, in the settings form while pasting and after saving (maintainer). The MCP shows it as `"[set]"`. The script receives it in clear. | Maintainer; `getMergeVariables` | `password` field |
| V8 | Tredict response size | Efforts 2.3 KB, plan 1.9 KB, activities 66 KB. A 66 KB merge-variable set was accepted. | Probe | Script returns a small, screen-ready set |
| V9 | Tredict shapes | See below. | Real responses in `tests/fixtures/private/` | Synthetic fixtures copy these shapes |
| V11 | Token in the query string | Moot (no polling headers). | | |
| V12 | Re-render skipped on unchanged data | Moot: `generatedAt` changes every poll. | | |
| Scope | `activityRead` covers all three endpoints | Yes: `plannedTrainingList`, `activityList` and `efforts` all 200. | Probe with the maintainer's token | Help text: `activityRead` only |
| Auth | Invalid token | 403 with body `Forbidden` (not 401). Paused-token status not seen. | Probe with an invalid token | 401 and 403 share one message; 402 keeps its own |
| Runtime | Script environment | Node v24.18.1, ICU 76.1, `AbortSignal.timeout` present, process TZ `UTC`. Timezone conversion works (`Pacific/Auckland`, `America/New_York` checked), but locale data is English only: `nl-NL` formats in English. Docs: 128 MB, 5 s, no packages. | Probe | Built-ins only, no `require`; Dutch strings from our own table; dates via `formatToParts` in `en-US` |
| Files | Export format | `settings.yml`, `full.liquid`, `transform.js`; `serverless_language` empty means the default runtime used here. The language can't be set over the API. | `getPluginSettingFiles` | Build writes these three files (plus `shared.liquid` if used) |
| Edits | API guard | `polling_url` can't move to another host while `polling_headers` is set. | Probe | Install note only |

### Tredict shapes (V9)

- `plannedTrainingList`: `{ count, _embedded: { plannedWorkoutList: [...] } }`. Each item: `id`, `date` (UTC ISO),
  `timezone` (a number: the UTC offset in hours, `1` in November), `sportType`, `title`, `notes`, `distance` (m),
  `duration` (s), `updatedAt`, and `executedTrainingId` once done. A done plan stays in the list. No rest-day or note
  items seen.
- `activityList?pageSize=50&extendedSummary=1`: `{ count, _links: { self, next: { href, cursor } }, _embedded:
  { activityList: [...] } }`. Each item: `id`, `date` (UTC ISO), `timezone` (IANA string), `sportType`, `subSportType`,
  `title`, `notes`, `summary` (`distance`, `duration`, `durationTotal`, `heartrate`, `pace`, `speed`, `power`,
  `cadence`, `calories`, maxima, `altitude {…}`, `positionLat`, `positionLong`, `walkingDuration`), `createdAt`,
  `trainingType`, `attribution`, `isFromGarminApi`, and sometimes `enjoyment`, `perceivedEffort`, `mcpUpdatedFields`.
  `pageSize=8` still returned 50: the parameter is ignored or has a floor. `summary` holds start coordinates, so the
  script must never pass it through.
- `efforts`: `{ trainingEfforts: { "YYYYMMDD": [[load], [load, { unconfirmed: true }], …] }, filterStartDate,
  filterEndDate }`. Keys are local dates without dashes. A day can hold several entries. Future planned sessions carry
  `{ unconfirmed: true }`; once a plan is done its unconfirmed entry is gone and only the confirmed one remains (today
  had `[[73]]` only). `filterStartDate` and `filterEndDate` are swapped (start is a month ahead, end a year back).

## Not verified

- Scheduled polls run the script: only forced refreshes were tested. Checked in Task 10 on the device.
- The status Tredict returns for a token paused after 10 days of inactivity.
- That the default runtime has the same 5 s / 128 MB limits as the documented Serverless runtime (same
  `[TransformRuntime]` pool in the logs).
- Recipe use: every install would fetch `/api/window` from TRMNL's egress addresses, so the API's per-IP rate limit
  would answer 429. Private use is unaffected.
