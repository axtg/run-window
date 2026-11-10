# run-window

[besttimetorun.com](https://besttimetorun.com): the best time to run today, from the weather, sized to the session you
planned.

- `besttimetorun.com/api/window`: free, anonymous JSON endpoint. Location and availability in, best window per session
  length out. Weather data by [Open-Meteo.com](https://open-meteo.com/).
- `besttimetorun.com`: a web page. Open a GPX or KML route (or use your location) and it shows the best window for
  that run on a day strip, with distance, climb and which way to head first. The route file is read in the browser and
  never sent anywhere; only the start point, rounded to 2 decimals, goes to the API. On Android it can be installed
  and shows up in the share sheet for route files.
- `besttimetorun.com/mcp`: an [MCP](https://modelcontextprotocol.io) server for AI assistants, stateless and without
  sign-in. In Claude, add it as a custom connector with "No sign in", then ask something like "when is the best time
  today for a 45-minute run near Utrecht? I can run 7–9 or 17–21". Tools: `find_best_run_time` (the best stretch of a
  given length today or tomorrow, its conditions and which way to start) and `get_run_conditions` (the day's
  15-minute slots). They answer exactly as `/api/window` does. In assistants that show MCP Apps, such as Claude,
  the best time comes with the page's timeline.
- `integrations/trmnl-running-board`: TRMNL plugin combining this week's Tredict training, a form graph and today's
  run window on one screen.

Status: the site and API are live at `besttimetorun.com`. The TRMNL plugin is built; see its
[README](integrations/trmnl-running-board/README.md). Design notes are in `docs/superpowers/specs/`.

## License

Code: [MIT](LICENSE). Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
