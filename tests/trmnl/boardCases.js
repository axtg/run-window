// Shared by board.test.js and render.test.js: fixtures routed by URL and a fixed clock
const { buildBoard } = require('../../integrations/trmnl-running-board/src/board');

const windowOk = require('../fixtures/trmnl/window-ok.json');
const plannedWeek = require('../fixtures/tredict/planned-week.json');
const activitiesWeek = require('../fixtures/tredict/activities-week.json');
const effortsWeek = require('../fixtures/tredict/efforts-week.json');
const detailHr = require('../fixtures/tredict/activity-detail-hr.json');
const detailNoHr = require('../fixtures/tredict/activity-detail-nohr.json');

const NOW = Date.parse('2026-11-04T11:00:00Z');
const TOKEN = 'synthetic-token-value-123';
const MINUTE = 60000;

// Response headers, looked up case-insensitively like fetch's Headers
const headersOf = (values = {}) => {
  const lower = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: name => (Object.hasOwn(lower, name.toLowerCase()) ? lower[name.toLowerCase()] : null) };
};

// Routes by URL to fixtures; `overrides` maps a route name to a status, a body, or a function returning a response.
// `overrides.details` does the same per activity id for detail calls, before `overrides.detail`.
// Each call record gets `start` and `end` from one shared counter, with a yield in between, so overlap shows.
function fakeFetch(overrides = {}) {
  const calls = [];
  let counter = 0;
  const bodies = {
    plan: plannedWeek,
    activities: activitiesWeek,
    efforts: effortsWeek,
    detail: detailHr,
    window: windowOk
  };
  const route = url => {
    if (url.includes('plannedTrainingList')) return 'plan';
    if (url.includes('activityList')) return 'activities';
    if (url.includes('/api/oauth/v2/activity/')) return 'detail';
    if (url.includes('/efforts')) return 'efforts';
    if (url.startsWith('https://besttimetorun.com/api/window')) return 'window';
    return 'unknown';
  };
  const detailId = url => decodeURIComponent(url.split('/activity/')[1].split('?')[0]);
  const respond = (name, url, options) => {
    const details = overrides.details || {};
    const perId = name === 'detail' && Object.hasOwn(details, detailId(url));
    const override = perId ? details[detailId(url)] : overrides[name];
    if (typeof override === 'function') return override(url, options);
    if (typeof override === 'number') {
      return { status: override, headers: headersOf(), text: async () => '{"error":"x"}' };
    }
    const body = override !== undefined ? override : bodies[name];
    return { status: 200, headers: headersOf(), text: async () => JSON.stringify(body) };
  };
  const fetch = async (url, options = {}) => {
    const name = route(url);
    const call = { name, url, options, start: counter++, end: null };
    calls.push(call);
    try {
      await null;
      return await respond(name, url, options);
    } finally {
      call.end = counter++;
    }
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

// `clock` (not part of the input) feeds the Tredict sequence's deadline
async function board({ clock, ...options } = {}, fetchOverrides = {}, now = NOW) {
  const fake = fakeFetch(fetchOverrides);
  const output = await buildBoard(makeInput(options), { fetch: fake.fetch, now, clock });
  return { output: roundTrip(output), calls: fake.calls };
}

module.exports = {
  windowOk,
  detailHr,
  detailNoHr,
  NOW,
  TOKEN,
  MINUTE,
  headersOf,
  fakeFetch,
  makeInput,
  roundTrip,
  board
};
