# Run-window API

Date: 2026-11-02
Status: awaiting approval
Consumer: TRMNL Running Board plugin (`2026-11-02-trmnl-running-board-design.md`), and anyone else who wants it

## Intent

Answer "when should I run today?" from the weather, for a run of a given length, inside the hours the person can
actually run. The TRMNL plugin knows today's planned session length from Tredict; this API does not and must not. It
returns the best window for a fixed set of session lengths, and the client picks the one that matches.

The service is a free public utility next to dap.xadi.eu: stateless, anonymous, no accounts, no keys.

## Goals

- One endpoint: location and availability in, the best window per session length for today and tomorrow out.
- Windows never start in the past, never fall outside the given availability, and never contain rain above the
  threshold. A window that breaks any of these is worse than no window.
- When no window qualifies, say so and return the least-bad option, flagged as such.
- Wind direction in the answer, so a client can say "start into the wind".
- Correct local days and daylight for the location's timezone, including DST days.

## Non-goals

- Knowing anything about the user's training. No Tredict calls, no tokens, no session data.
- Routes, elevation, surface. (Separate idea; not this service.)
- Multi-day planning beyond tomorrow.
- Air quality, pollen, UV. Possible later; not v1.
- Imperial units. Metric only in v1 (km/h, °C, mm).

## Anti-goals

These count as failure even if everything else works:

- A Tredict token, or any `Authorization` header value, appears in a log, an error report or a response. See
  "Privacy": TRMNL sends the plugin's polling headers to every polling URL, so this service will receive the user's
  Tredict token.
- Exact coordinates are logged. A lat/lon at full precision is a home address.
- A recommended window that is in the past, outside availability, or during rain above the threshold.

## Endpoint

`GET /api/window`

### Query parameters

| Name | Required | Type | Default | Notes |
|------|----------|------|---------|-------|
| `lat` | yes | number | | -90..90 |
| `lon` | yes | number | | -180..180 |
| `avail` | no | string | `06-22` | Comma-separated local-time ranges, `HH-HH` or `HH:MM-HH:MM`, e.g. `07-09,12-14,17-21`. Ranges may not cross midnight in v1. Applies to both days |
| `dark` | no | `ok` \| `avoid` | `avoid` | `avoid` excludes slots outside civil daylight (sunrise to sunset) |
| `rain` | no | integer 0–100 | `40` | Max precipitation probability (%) allowed in any slot of a window |
| `lang` | no | `en` \| `nl` | `en` | Only affects the human-readable `label` fields |

Invalid, out-of-range or repeated values return 400 with a message naming the parameter, matching eu-dayahead's
validation style. Empty values mean "use the default", as in eu-dayahead (TRMNL sends empty strings for blank fields).

The timezone comes from the location (Open-Meteo `timezone=auto`), not from a parameter.

### Response

```json
{
  "location": { "lat": 52.37, "lon": 4.89, "timezone": "Europe/Amsterdam" },
  "generatedAt": "2026-11-02T09:00:00.000Z",
  "params": { "avail": "07-09,12-14,17-21", "dark": "avoid", "rain": 40 },
  "days": [
    {
      "date": "2026-11-02",
      "sunrise": "2026-11-02T06:31:00.000Z",
      "sunset": "2026-11-02T16:07:00.000Z",
      "windows": {
        "30": { "...": "window object, see below" },
        "45": null
      },
      "fallback": { "...": "window object for the default duration, see below" }
    },
    { "date": "2026-11-03", "...": "same shape" }
  ],
  "attribution": "Weather data by Open-Meteo.com"
}
```

Durations (keys of `windows`): every 15 minutes from 15 to 180, as strings. A client with a planned session of N
minutes rounds N **up** to the next key. Over 180 uses `"180"` and should say the session doesn't fully fit.

A window object:

```json
{
  "start": "2026-11-02T11:15:00.000Z",
  "end": "2026-11-02T12:30:00.000Z",
  "score": 3.2,
  "qualifies": true,
  "precipProbMax": 15,
  "precipSum": 0.0,
  "windAvg": 18,
  "gustMax": 31,
  "windFrom": 225,
  "windFromCardinal": "SW",
  "apparentTempAvg": 7.5,
  "inDaylight": true,
  "label": "12:15–13:30 · dry · 18 km/h SW · 8°C"
}
```

- `windows[d]` is `null` when no qualifying window of that length exists that day.
- `fallback` is the least-bad window for 60 minutes (design call) with `qualifies: false`, present only when
  `windows["60"]` is `null`. It may break the rain threshold but never availability, the past, or (with
  `dark=avoid`) darkness. If even that is impossible, `fallback` is `null`.
- `windFrom` is the direction the wind comes from, in degrees, as Open-Meteo reports it. "Start into the wind" means
  heading towards `windFromCardinal`. 8-point cardinals.
- `label` is preformatted local time in the location's timezone, using `lang`. Clients may ignore it and build their
  own from the fields.
- `score`: lower is better. Exposed for debugging and tuning, not as a promise.

## Weather source

Open-Meteo forecast API, one call per cache key:

- `hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m`
- `daily=sunrise,sunset`
- `timezone=auto`, `forecast_days=2`, `wind_speed_unit=kmh`

**Verify** before building: Open-Meteo's free API terms (non-commercial use, request limits, required CC BY 4.0
attribution). A free public endpoint without ads should count as non-commercial; if the terms say otherwise, stop and
report. Also verify the exact field names above against the live API and capture fixtures from it.

Design call: hourly data in v1. Slots are 15 minutes and take the values of the hour they fall in. Open-Meteo's
15-minutely data for central Europe is a possible v2 improvement for precipitation.

## Window selection

Per local day, for each duration:

1. **Slots:** 15-minute slots across the local day.
2. **Exclude** a slot if any of:
   - it starts before now, rounded up to the next quarter hour (only affects today);
   - it lies outside every `avail` range (a slot must fit entirely inside a range);
   - `dark=avoid` and it isn't entirely between sunrise and sunset;
   - its hour's `precipitation_probability` > `rain`, or its hour's `precipitation` ≥ 0.2 mm (design call).
3. **Candidate windows:** runs of consecutive non-excluded slots covering the duration. A window may not span two
   `avail` ranges.
4. **Score** each slot (design calls, tunable, keep the constants in one place):
   - wind: `max(0, windSpeed - 12) * 1.0 + max(0, gust - 30) * 0.5`
   - temperature: distance of apparent temperature outside 6–16 °C, times 1.0
   - rain: `precipitation_probability / 20`
   A window's score is the mean of its slots' scores.
5. **Pick** the lowest score. Ties: the earliest window wins.
6. **Fallback** (60 minutes only): repeat with the rain exclusions dropped, scoring rain much higher
   (`precipitation_probability / 2` plus `precipitation * 20`), and set `qualifies: false`.

The scoring is a starting point; the maintainer will tune it on real runs. Keep it a pure function
`scoreSlot(hourValues) → number` and `pickWindow(slots, durationSlots) → window|null` with unit tests, so tuning
doesn't touch routing.

## Caching and limits

- Cache key: lat and lon rounded to 2 decimals (~1 km; Open-Meteo's grid is coarser anyway). Availability, `dark`,
  `rain` and `lang` are applied per request to cached weather, so they never cause upstream calls (same principle as
  markup in eu-dayahead).
- Entry lifetime: until the next full hour plus 5 minutes (Open-Meteo updates hourly), at most 60 minutes. Concurrent
  requests for one key share one upstream call.
- If Open-Meteo fails: serve a cached entry up to 3 hours old with `warnings: ["stale_data"]`; otherwise 503.
- Rate limit: copy eu-dayahead's per-IP limiter. Note that every TRMNL user arrives from TRMNL's few server IPs
  (published at `https://trmnl.com/api/ips`), so the limit must allow bursts from those or exempt them (design call).

## Privacy

- **Authorization header:** TRMNL has one polling-headers field per plugin and sends it with every polling URL, so the
  Running Board plugin will send the user's Tredict token here. Strip `Authorization` (and `Cookie`) from the request
  in the first middleware, before logging, and never echo it. Add a test that a request carrying
  `Authorization: Bearer secret` produces no log payload, error report or response containing `secret`. **Verify** in
  rollout with a request log that only the expected headers arrive.
- **Coordinates:** log lat/lon rounded to 1 decimal at most. eu-dayahead's logging middleware logs the full query
  object, so the copied middleware must redact `lat`/`lon` in `query` and in `url`/`message`.
- Document both on the landing page: what the service receives, what it keeps (rounded cache keys for at most
  3 hours), and that it never stores tokens.

## Other routes

- `/health` and `/health/cache` like eu-dayahead.
- `/openapi.yaml` and a minimal landing page with an example request and the Open-Meteo attribution. Design call: no
  interactive map or front-end in v1.

## Structure (suggestion, builder decides)

```
index.js
routes/window.js
lib/openMeteo.js        # upstream client + cache
lib/windows.js          # slots, exclusions, scoring, picking (pure)
lib/labels.js           # en/nl label formatting
middleware/             # logging (with redaction), rateLimit, securityHeaders, stripAuth
docs/openapi.yaml
tests/
```

## Verification

- Unit tests for `windows.js`: past slots excluded, availability edges (window ending exactly at range end), a window
  not spanning two ranges, darkness on/off, rain threshold edge (40 vs 41), ties, no qualifying window → `null` plus
  fallback, a DST day (23- and 25-hour days in Europe/Amsterdam), a location in another timezone.
- Route tests with fixtures: validation (each parameter invalid and repeated), empty values, `lang=nl`, response shape,
  cache sharing, stale fallback, 503.
- The authorization and coordinate redaction tests above.
- `npm test`, `npm run lint`, `npm run validate-api`.
- Manual sanity check by the maintainer: compare a week of answers with how the runs actually felt.

## Rollout

1. Deploy behind nginx on the dap.xadi.eu host as its own container and subdomain (`run.xadi.eu`, design call).
2. Check the request log for a TRMNL request: the `Authorization` header is stripped before logging and coordinates
   are rounded.
3. Only then publish the plugin that points at it.

## Left to the builder

- Exact label wording in en and nl (the maintainer checks nl).
- Cache implementation details.
- Landing page content and styling (Tailwind, like eu-dayahead).
