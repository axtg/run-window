# Run-window web interface: one-card redesign

Date: 2026-11-04
Status: draft, awaiting the maintainer's approval
Builds on: `2026-11-04-run-window-web-ui-design.md` (the page as built and live). Everything there still holds unless
this document changes it.

## Intent

The page works, but it looks too basic, and too much of it is the API and privacy text. The maintainer wants the page to
be the data, like dap.xadi.eu: one attractive card, with the parameters open and ready to change, the answer, and the
day's picture straight under it. The API docs and the privacy text move out of the way into overlays.

## Goals

- One card that reads top to bottom: settings, the answer, one timeline (strip and graph joined), the "why", the footer.
- Every setting visible and editable in place, with no chips to open first.
- Less vertical space for the settings, without hiding what a control does.
- Several ranges of hours when needed, one by default.

## Non-goals

- New data or API changes. The page uses `/api/window?…&slots=1` as now.
- New behaviour in the route, plan, strip or settings logic beyond what's listed under "Changes to the modules".
- Dark mode, languages other than English.

## Anti-goals

- Anything that weakens the privacy rules in the base design: the route file stays in the browser, one request with
  2-decimal coordinates, no third-party requests, settings only in `localStorage`.
- Inline script or style, or a CSP change.
- A control whose meaning you have to guess, such as dragging the chart to set hours (considered and rejected: saves space
  but is hard to discover).

## Decided by the maintainer

Chosen from mockups (`.superpowers/brainstorm/1106114-1793817690/content/compact-params.html`, left option; the
earlier screens `one-card.html` and `combined.html` show how it got there):

- **Order inside one card:** settings, then the answer, then the timeline, then the graph details, all in one card.
- **Settings as slim rows** (label, control, value on one line), on a light panel at the top of the card:
  - **Day:** a Today / Tomorrow segmented control, with the route name and distance and a ✕ on the same line.
  - **Pace:** − / + buttons and the value in `m:ss /km`, typeable.
  - **Hours:** a slider with two handles whose track shows the dark part of the chosen day hatched, so you see when
    your hours reach into the night. The value is shown at the end of the row (`10–16`).
  - **Dark OK:** a small toggle directly under the hours row, next to "dark 17:08–07:28". Off by default, as now.
  - **Rain ≤:** one slim slider row, value at the end (`40 %`). They liked A's rain slider; it must stay small.
- **Several ranges of hours:** one range by default, **10:00–16:00**; a "+ add hours" link adds another hours row (and
  each extra row can be removed). Ranges are remembered on the device with the other settings.
- **The answer:** "Best time · 65 min" small, the window in large type (`13:15–14:20`), then a row of key numbers:
  **Sky · Feels · Wind · Climb** (from mockup C), then the wind advice ("As drawn: into the E wind first").
- **One timeline:** the strip is the top band of the graph, sharing its x axis, and one outline runs through both for
  the window (from mockup C). Dark hours shaded in the graph. Legend: feels-like, wind, rain %, dark.
- **API and Privacy:** links in a header bar (logo, "Run window", API, Privacy), each opening an overlay, like
  dap.xadi.eu. The page itself is the card.

## The card, top to bottom

1. **Header bar** (outside the card): small logo, "Run window", and "API" and "Privacy" buttons on the right.
2. **Settings panel** (light grey background, top of the card):
   - Day row: segmented Today / Tomorrow. With a route: its name, `10.2 km`, ✕ to clear it. Without: "Open route" and
     "Use my location" buttons in that place.
   - Pace row with a route. Without a route this row is **Duration** with − / + in 15-minute steps (15–300 min), as the
     base design's duration chip did.
   - Hours row(s), "Dark OK" row with the day's dark times, "+ add hours".
   - Rain row.
3. **Answer** (white): "Best time · N min", the big time, the key numbers, the wind line. The no-window, fallback,
   over-180 and error texts from the base design take this place, in the same style.
4. **Timeline:** strip band, graph, gap separators between hour ranges, the window outline through both, ticks. Tapping
   or arrow keys select a slot, as now, and the tap line appears under the timeline.
5. **Why:** the legend and the "why" sentence, always shown (the fold goes away).
6. **Footer row** (inside the card): "Weather: Open-Meteo" (link, keeps the CC BY attribution) and "Copy API link ⧉".

Overlays: "API" holds the current example request, the parameter summary (now including `slots`), the capacity note and
the link to `openapi.yaml`; "Privacy" holds the privacy bullets as they are now. Both are `<dialog>` elements in the same
page, opened by the header buttons, closed with ✕, Escape or a tap outside.

## Key numbers

| Label | Value | Without a route |
|-------|-------|-----------------|
| Sky | `Dry` or `Rain 35 %` (same dry rule as now) | same |
| Feels | average feels-like, `7 °C` | same |
| Wind | average wind and cardinal, `14 E` (km/h implied; full in the tap line) | same |
| Climb | `+45 m`, or `–` when the file has no elevation | replaced by **Run** `60 min` |

For a fallback window the time gets the "Least bad" label and the outline is dashed, as now.

## Changes to the modules

- `public/settings.js`: `DEFAULTS.hours` becomes `'10-16'`. Stored values are kept (someone who saved `06-22` keeps
  it). The format stays the API's `avail` string, so several ranges are just more parts.
- `public/app.js`: rewritten around the new markup. Hour rows are built from the stored string; each row's slider has
  whole-hour steps (00–24); rows may not overlap (the row being moved stops at its neighbour). The night hatch on the
  track uses the chosen day's `sunrise`/`sunset` from the API (before the first response, no hatch).
- `public/plan.js`: helpers for the key numbers if the builder wants them testable (e.g. `keyNumbers(result, summary,
  minutes)`), with tests. `goLine` stays for the API link copy and errors, or is retired if unused.
- `public/strip.js`: one combined timeline model (strip band plus graph in one coordinate system), or the page lays the
  two existing models into one SVG. Builder's call; keep `shadeClasses`, `rangeIndices`, `ticks`, `slotLine`,
  `whySentence` behaviour.
- `public/route.js`: unchanged.

## Constraints (unchanged from the base design, restated because a rewrite risks them)

- Same-origin external scripts only, no inline script, no `<style>`, no `style=` attribute and no
  `setAttribute('style', …)`. Slider fills and handle positions are drawn with SVG attributes or with classes, or with
  native `<input type="range">` elements styled through Tailwind. CSP stays as it is.
- Tailwind classes as complete literals in `index.html`, `app.js`, `strip.js` (the files Tailwind scans); rebuild CSS.
- The privacy smoke test (`tests/web/app.smoke.test.js`) keeps passing: one request, only the six parameters, 2 decimals,
  nothing from the file in storage or history.
- Every control reachable by keyboard and labelled for screen readers. Native range inputs give that for free; a custom
  two-handle slider needs two focusable handles with `aria-valuenow`/`aria-valuetext`.
- Works at 320 px without horizontal scroll; on a desktop the card is centred at phone-to-tablet width (design call:
  `max-w-xl`), not stretched.
- Landing tests: the privacy text and the API example move into dialogs but stay in `index.html`, so the existing text
  assertions keep working; the "tool first" structure assertions change on purpose.

## Left to the builder

- Exact colours, spacing, shadows (follow the mockup and dap.xadi.eu's card style: white `rounded-2xl` card on a light
  grey page, soft shadow).
- Two-handle slider technique (two overlaid native range inputs, or a custom SVG control), within the constraints.
- Whether the timeline is one model in `strip.js` or two models laid into one SVG.
- Icon for the header logo (reuse `public/icon.svg`'s design).

## Testing

- Unit tests for any new pure helpers (key numbers, hour-row parsing and joining, overlap clamping).
- `tests/landing.test.js` updated on purpose: header with API and Privacy buttons, two `<dialog>`s holding the API
  example and the privacy bullets, the settings controls present with labels.
- The smoke test extended to the new controls: changing pace, adding an hour range and moving the rain slider saves only
  the five settings; one request per change.
- Manual check with Playwright at 320 px and 1024 px, and once on the maintainer's phone.
