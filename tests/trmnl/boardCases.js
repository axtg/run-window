// Shared by board.test.js and render.test.js: fixtures routed by URL and a fixed clock
const { buildBoard } = require('../../integrations/trmnl-running-board/src/board');

const windowOk = require('../fixtures/trmnl/window-ok.json');
const plannedWeek = require('../fixtures/tredict/planned-week.json');
const activitiesWeek = require('../fixtures/tredict/activities-week.json');
const effortsWeek = require('../fixtures/tredict/efforts-week.json');

const NOW = Date.parse('2026-11-04T11:00:00Z');
const TOKEN = 'synthetic-token-value-123';
const MINUTE = 60000;

// Routes by URL to fixtures; `overrides` maps a route name to a status, a body, or a function returning a response
function fakeFetch(overrides = {}) {
  const calls = [];
  const bodies = {
    plan: plannedWeek,
    activities: activitiesWeek,
    efforts: effortsWeek,
    window: windowOk
  };
  const route = url => {
    if (url.includes('plannedTrainingList')) return 'plan';
    if (url.includes('activityList')) return 'activities';
    if (url.includes('/efforts')) return 'efforts';
    if (url.startsWith('https://run.xadi.eu/api/window')) return 'window';
    return 'unknown';
  };
  const fetch = async (url, options = {}) => {
    const name = route(url);
    calls.push({ name, url, options });
    const override = overrides[name];
    if (typeof override === 'function') return override(url, options);
    if (typeof override === 'number') return { status: override, text: async () => '{"error":"x"}' };
    const body = override !== undefined ? override : bodies[name];
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

function makeInput({ body = windowOk, fields = {}, previous, user } = {}) {
  return {
    ...body,
    trmnl: {
      user: user || { time_zone_iana: 'Europe/Amsterdam', locale: 'en' },
      plugin_settings: {
        custom_fields_values: { tredict_token: TOKEN, lat_lon: '52.37,4.89', ...fields }
      },
      previous_merge_variables: previous === undefined ? {} : previous
    }
  };
}

const roundTrip = value => JSON.parse(JSON.stringify(value));

async function board(options = {}, fetchOverrides = {}, now = NOW) {
  const fake = fakeFetch(fetchOverrides);
  const output = await buildBoard(makeInput(options), { fetch: fake.fetch, now });
  return { output: roundTrip(output), calls: fake.calls };
}

module.exports = { windowOk, NOW, TOKEN, MINUTE, fakeFetch, makeInput, roundTrip, board };
