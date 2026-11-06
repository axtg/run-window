# Review guidelines

Two things live here: a small, stateless Express API (`besttimetorun.com`) and a private TRMNL plugin
(`integrations/trmnl-running-board/`). Specs and plans are in `docs/superpowers/`; a commit that implements a plan task
should match that task, not more.

## Flag

- **Privacy, highest priority.** The repo is public. No token, real coordinate, personal name or real Tredict data in
  code, fixtures, tests or docs. The API must never log raw coordinates or query strings; logged locations are rounded
  to 1 decimal. The Tredict token is sent to Tredict only, never to `besttimetorun.com`.
- **The web interface** (`public/`): anything that sends route data anywhere, writes it to `localStorage` or the URL,
  adds an inline script or style, or makes a third-party request; and a service worker that answers anything other
  than the share POST (`/share-target`).
- **The TRMNL transform script** (`integrations/trmnl-running-board/src/`, built into `transform.js`): `run` must never
  throw and every outbound call needs a timeout (TRMNL keeps the previous screen silently on a throw, and allows 5 s).
  Built-ins only, no `require` in the built file. Its output must not contain raw Tredict responses or an activity's
  `summary` (start coordinates).
- **Liquid templates:** every printed string goes through `| escape`.
- **Dates and times:** local-day logic must use the IANA timezone (`date-fns-tz` in the API, `Intl` with `timeZone` in
  the plugin), and hold across DST changes. All API times are UTC ISO strings.
- **Wording that contradicts the API:** the plugin must word conditions as `lib/labels.js` does.
- Real bugs, missing tests for the behaviour a commit adds, and tests that cannot fail.

## Don't flag

- Synthetic Tredict fixtures with invented values, and Amsterdam centre (52.37, 4.89) in fixtures and examples: both are
  deliberate.
- The gitignored `tests/fixtures/private/` folder, and tests that skip when it is absent: `npm test` must pass without
  it.
- Missing auth, accounts, databases, metrics or retries beyond what the spec asks: the API is anonymous and stateless
  by design, and the plugin is a private MVP.
- The plugin's own en/nl string tables instead of `Intl` locale formatting: TRMNL's runtime has English locale data
  only.
- Style already enforced by ESLint and Prettier (single quotes, semicolons, 120 columns, no trailing commas).
- Generated files: `public/tailwind.css` and `integrations/trmnl-running-board/transform.js` (review `src/` instead).
