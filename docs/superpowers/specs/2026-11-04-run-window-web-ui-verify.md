# Run window web interface: phone check

Task 11 of `docs/superpowers/plans/2026-11-04-run-window-web-ui.md`, run by the maintainer on 2026-11-05 on an Android
phone and a Windows desktop against the live site (`main` at `5d3ed02` to `77e65c5`). This file holds yes/no answers
and what changed because of them: no coordinates, no place names, no route contents.

## Answers

| # | Check | Answer | Evidence |
|---|---|---|---|
| P1 | Install from Vivaldi (Android) | No install entry. Vivaldi offers "Add to Home screen", which makes a shortcut, not an installed app, so the page can't be a share target from there. | Maintainer |
| P2 | Install from Chrome (Android) | Yes, as an app. | Maintainer |
| P3 | Share sheet | "Run window" is listed when sharing a route from Trail Router. | Maintainer |
| P4 | Shared route answered | Yes: the route's name, distance and climb, the run minutes from the pace, the wind line "as drawn", the timeline. | Phone screenshot |
| P5 | Location ("Near you") | Answers with the duration, hours, rain and dark settings. | Phone and desktop screenshots |
| P6 | Phone vs desktop for "Near you" | Different answers with the same settings. Cause: different locations. The dark times differed by 3 minutes; the desktop's position was its ISP's guess, about 70 km off. Not a bug in the page. | Two screenshots, the maintainer's own check |
| P7 | Map link and rough note | "Looks good" after the change below. | Maintainer |
| P8 | Desktop answer layout | Time on one line, key numbers beside it, smaller units, context words under Feels and Wind. | Desktop screenshots |
| P9 | Open a file with the picker | Not reported in this check. The share path reads the same way, and the smoke test opens a route. | |
| P10 | Location denied once | Not reported in this check. The smoke test covers the message and that no request is made. | |
| P11 | Private tab (no storage) | Not reported in this check. Storage is read and written in try/catch, and the smoke test runs with a store that starts empty. | |

## Changed because of the check

- Key-number units (`km/h`, `°C`, `min`, `m`, `%`) set smaller, each value on one line, so `16 km/h E` no longer
  wrapped its `E` (`5d3ed02`).
- Without a route, the Run row is the duration only; pace shows with a route. The route name sits on one line, cut
  short with `…`, without the distance. On touch-only screens the timeline hint leaves out the arrow keys (`ba7f039`).
- "Near you" links to OpenStreetMap at the rounded location, and says `· rough, ±N km` when the browser reports worse
  than 5 km accuracy (`77e65c5`). Picking a place by search was left out (it needs a proxied geocoding endpoint).

## Known limits

- The share sheet needs Chrome's install on Android (P1).
- A desktop without GPS gets the browser's guess; the rough note and the map link make it visible, the maintainer fixes
  it with the operating system's default location or by opening a route.
