# Run-window API

Date: 2026-11-02
Status: approved 2026-11-02
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
- Exact coordinates are logged or exposed: in app logs, error reports, nginx logs or health output. A lat/lon at full
  precision is a home address.
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

Open-Meteo forecast API, one call per cache key, always sent the rounded coordinates of the key:

- `hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m`
- `daily=sunrise,sunset`
- `timezone=auto`, `forecast_days=4`, `wind_speed_unit=kmh`, `timeformat=unixtime`

Checked on 2026-11-02: the field names work against the live API, and Open-Meteo's terms list private or non-profit
websites without subscriptions or advertising as non-commercial (under 600 calls/minute, 5,000/hour, 10,000/day and
300,000/month, with CC BY 4.0 attribution). Capture fixtures from the live API, for a public landmark.

Only today and tomorrow are returned to clients. The extra days exist because the last hour of a day takes its rain
value from the next day's 00:00 row, and an entry fetched before midnight must still cover that after midnight: then
"tomorrow" is the third day of the response, and its last hour needs the fourth.

### Time handling

Open-Meteo applies the UTC offset at request time to the whole response, including its day boundaries. On and around DST
changes, its ISO strings are an hour off from civil local time (a request made on 2 November returned 24 October's
sunrise as `07:21`; the real local time was 08:21). So:

- Use `timezone=auto` only to learn the IANA timezone name.
- Treat every row, sunrise and sunset as a UTC instant, from `timeformat=unixtime`.
- Build local days and slots with `date-fns-tz`, and look rows up by UTC timestamp. Never use array position, row count
  or Open-Meteo's date strings to decide what belongs to a day.
- A slot whose required row is missing or null is excluded. Never guess a value.

### Which row a slot reads

Hourly variables cover different periods. For a slot in the hour starting at `H` (a 12:15 slot has `H` = 12:00):

| Variables | Valid time, per Open-Meteo's docs | Row used |
|-----------|-----------------------------------|----------|
| `precipitation`, `precipitation_probability` | Preceding hour | `H + 1h` (13:00) |
| `wind_gusts_10m` | Preceding hour's maximum | `H + 1h` (13:00) |
| `temperature_2m`, `apparent_temperature`, `wind_speed_10m`, `wind_direction_10m` | Instant | `H` (12:00) |

Design call: hourly data in v1, with 15-minute slots and no interpolation. Open-Meteo's 15-minutely data for central
Europe is a possible v2 improvement for precipitation.

## Window selection

Per local day, for each duration:

1. **Slots:** 15-minute slots across the local day.
2. **Exclude** a slot if any of:
   - it starts before now, rounded up to the next quarter hour (only affects today);
   - it lies outside every `avail` range (a slot must fit entirely inside a range);
   - `dark=avoid` and it isn't entirely between sunrise and sunset;
   - its `precipitation_probability` > `rain`, or its `precipitation` ≥ 0.2 mm (design call), both read from the row
     given in "Which row a slot reads";
   - a row it needs is missing or null.
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
- If Open-Meteo fails: serve a cached entry up to 3 hours old with `warnings: ["stale_data"]`; otherwise 503. After a
  failed call, a key waits 5 minutes before retrying upstream.
- Rate limit: copy eu-dayahead's per-IP limiter. Note that every TRMNL user arrives from TRMNL's few server IPs
  (published at `https://trmnl.com/api/ips`), so the limit must allow bursts from those or exempt them (design call).

### Upstream budget

Unlike eu-dayahead, cache keys here are unbounded, and the per-IP limit doesn't protect Open-Meteo's quota: 10 requests
per second with new coordinates would reach 600 calls per minute and use the daily 10,000 in about 17 minutes, for
everyone. Keep these constants in one place (design calls):

- **Distinct keys:** at most 300 per UTC day. This is the capacity of the service in v1. A key that has been admitted
  keeps working all day; a new key over the cap gets a 503 with `Retry-After` and a message saying the service is at
  capacity. At about 25 calls per key per day, 300 keys stay under 7,500 calls per day and 225,000 per month.
- **Upstream calls:** at most 300 per minute and 8,000 per UTC day, as a hard stop that also covers retries. Over either
  limit, serve the stale entry if there is one; otherwise 503.
- **Cache size:** entries are removed once older than 3 hours, so memory is bounded by the key cap.
- Counters live in memory and reset on restart, like the rate limiter.

Accepted trade-off: someone can fill the day's new-key slots and lock out new locations until UTC midnight. Locations
already admitted that day keep working, and the quota stays safe. No per-IP limit on new keys in v1, because all TRMNL
users share a few IPs.

## Privacy

- **Authorization header:** TRMNL has one polling-headers field per plugin and sends it with every polling URL, so the
  Running Board plugin will send the user's Tredict token here. Remove it twice:
  - nginx, so it never reaches Node: `proxy_set_header Authorization "";` and `proxy_set_header Cookie "";`.
  - The first middleware, as a backup: delete both from `req.headers` and `req.rawHeaders`, before logging. Never echo
    them.

  Add a test that a request carrying `Authorization: Bearer secret` produces no log payload, error report or response
  containing `secret`. **Verify** in rollout that the app no longer receives the header.
- **Coordinates in app logs:** eu-dayahead's logging middleware logs `originalUrl` in `url` and `message`, plus the full
  `query` and `Referrer`, and `logError` logs `originalUrl` too. The copied versions, on every route and status,
  including 404s, log known paths (`/`, `/api/window`, `/health`, `/health/cache`, `/openapi.yaml`, `/tailwind.css`,
  `/favicon.ico`) and log any other path as `other`, never a query string or a referrer: a path can carry coordinates too
  (`/api/window%3Flat%3D...`, `;lat=...`, `/52.37/4.89`). The only location logged is lat/lon rounded
  to 1 decimal, as separate fields, on `/api/window`.
- **Coordinates in nginx logs:** the default log format records the full query string. This site's `access_log` uses a
  format with `$uri` instead of `$request`, so no query string is logged. Check that `error_log` output doesn't contain
  them in normal operation either.
- **Coordinates elsewhere:**
  - Validation messages name the parameter, never its value.
  - Errors from Open-Meteo calls are logged without the upstream URL or the coordinates in it.
  - Responses return the rounded coordinates, not the ones sent in.
  - `/health/cache` returns counts and ages only, never cache keys.
- **What is kept:** cache entries hold 2-decimal coordinates for at most 3 hours. The distinct-key counter stores salted
  hashes, with the salt held in memory and replaced each UTC day, so it can't be read back as locations.
- Document all of this on the landing page: what the service receives, what it keeps, and that it never stores tokens.

## Other routes

- `/health` like eu-dayahead. `/health/cache` with counts and ages only (see "Privacy").
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
  fallback, a DST day (23- and 25-hour days in Europe/Amsterdam, built from a fixed-offset upstream response), a
  location in another timezone, missing and null rows.
- Rain alignment: rain only in the 13:00 row (the hour 12:00–13:00) excludes a 12:15 slot and leaves a 13:15 slot
  alone. The same for gusts in scoring, while temperature and wind speed read the 12:00 row.
- Day coverage: an entry fetched at 23:50 still returns a complete today and tomorrow at 00:10, and tomorrow's last hour
  has its rain value.
- Route tests with fixtures: validation (each parameter invalid and repeated), empty values, `lang=nl`, response shape,
  cache sharing, stale fallback, 503.
- Upstream budget: key 301 gets a 503 while an admitted key keeps working, the call limits stop upstream calls and serve
  stale data where it exists, a failed key waits before retrying, and the counters reset at UTC midnight.
- The authorization and coordinate redaction tests above, including `req.rawHeaders`, a 404 with coordinates in the
  query string, a request with coordinates in its referrer, a validation error, a failed upstream call and
  `/health/cache`.
- `npm test`, `npm run lint`, `npm run validate-api`.
- Manual sanity check by the maintainer: compare a week of answers with how the runs actually felt.

## Rollout

1. Deploy behind nginx on the dap.xadi.eu host as its own container and subdomain (`run.xadi.eu`, design call).
2. Check a real TRMNL request end to end:
   - the app doesn't receive `Authorization`;
   - Better Stack shows the path and rounded coordinates only;
   - the nginx access log has no query string;
   - `/health/cache` shows no coordinates.
3. Only then publish the plugin that points at it.

## Left to the builder

- Exact label wording in en and nl (the maintainer checks nl).
- Cache implementation details.
- Landing page content and styling (Tailwind, like eu-dayahead).
