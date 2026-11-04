# run-window

Best time to run today, from the weather, sized to the session you planned.

- `run.xadi.eu`: free, anonymous JSON endpoint. Location and availability in, best window per session
  length out. Weather data by [Open-Meteo.com](https://open-meteo.com/).
- `run.xadi.eu` at `/`: a web page. Open a GPX or KML route (or use your location) and it shows the best window for
  that run on a day strip, with distance, climb and which way to head first. The route file is read in the browser and
  never sent anywhere; only the start point, rounded to 2 decimals, goes to the API. On Android it can be installed;
  it will be usable from the share sheet once the share target ships.
- `integrations/trmnl-running-board`: TRMNL plugin combining this week's Tredict training, a form graph and today's
  run window on one screen.

Status: the API is live at `run.xadi.eu`. The TRMNL plugin is built; see its
[README](integrations/trmnl-running-board/README.md). Design notes are in `docs/superpowers/specs/`.

## License

Code: [MIT](LICENSE). Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
