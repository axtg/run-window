# run-window

[besttimetorun.com](https://besttimetorun.com): the best time to run today, from the weather, sized to the session you
planned.

- `besttimetorun.com/api/window`: free, anonymous JSON endpoint. Location and availability in, best window per session
  length out. Weather data by [Open-Meteo.com](https://open-meteo.com/).
- `besttimetorun.com`: a web page. Open a GPX or KML route (or use your location) and it shows the best window for
  that run on a day strip, with distance, climb and which way to head first. The route file is read in the browser and
  never sent anywhere; only the start point, rounded to 2 decimals, goes to the API. On Android it can be installed
  and shows up in the share sheet for route files.
- `integrations/trmnl-running-board`: TRMNL plugin combining this week's Tredict training, a form graph and today's
  run window on one screen.

Status: the site and API are live at `besttimetorun.com`. The TRMNL plugin is built; see its
[README](integrations/trmnl-running-board/README.md). Design notes are in `docs/superpowers/specs/`.

## License

Code: [MIT](LICENSE). Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
