// Render cases shared by render.test.js and preview.js: each builds the transform output the template prints
const { board, MINUTE, NOW } = require('./boardCases');

const EMPTY_LIST = key => ({ _embedded: { [key]: [] } });
const GARMIN_NOTICE =
  'Garmin and the Garmin logo are trademarks of Garmin Ltd. or its subsidiaries; via Garmin Connect';

// Overrides and options for the Tredict failure states
const STATE_CASES = {
  auth: { plan: 401 },
  payment: { efforts: 402 },
  unavailable: { efforts: 503 }
};

const EMPTY_ACCOUNT_OVERRIDES = {
  plan: EMPTY_LIST('plannedWorkoutList'),
  activities: EMPTY_LIST('activityList'),
  efforts: { trainingEfforts: { x: [] } }
};

const ERROR_OUTPUT = {
  v: 1,
  fetchedAt: '2026-11-04T11:00:00.000Z',
  fetchedAtText: '',
  tredict: { state: 'unavailable', message: 'Tredict unavailable' },
  tredictAt: null,
  tredictAtText: '',
  week: null,
  form: null,
  run: { kind: 'error', heading: 'Weather unavailable', lines: [] },
  weatherRetryAt: null,
  attribution: ''
};

async function longAttributionOutput() {
  const { output } = await board();
  const garmin = [`${GARMIN_NOTICE} for device A`, `${GARMIN_NOTICE} for device B`];
  const attribution = [...garmin, 'Weather data by Open-Meteo.com'].join(' · ');
  return { ...output, week: { ...output.week, garmin }, attribution };
}

// Every case as { name, output }
async function renderCases() {
  const first = (await board({}, {}, NOW - 2 * 60 * MINUTE)).output;
  const outputs = {
    normal: (await board()).output,
    nl: (await board({ user: { time_zone_iana: 'Europe/Amsterdam', locale: 'nl-NL' } })).output,
    stale: (await board({ previous: first }, { efforts: 503 })).output,
    empty: (await board({ previous: null }, EMPTY_ACCOUNT_OVERRIDES)).output,
    'long-attribution': await longAttributionOutput(),
    error: ERROR_OUTPUT
  };
  for (const [name, overrides] of Object.entries(STATE_CASES)) {
    outputs[name] = (await board({ previous: null }, overrides)).output;
  }
  return Object.entries(outputs).map(([name, output]) => ({ name, output }));
}

module.exports = {
  EMPTY_LIST,
  EMPTY_ACCOUNT_OVERRIDES,
  ERROR_OUTPUT,
  GARMIN_NOTICE,
  STATE_CASES,
  longAttributionOutput,
  renderCases
};
