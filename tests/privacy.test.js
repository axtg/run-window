const request = require('supertest');

const util = require('util');
const amsterdamFixture = require('./fixtures/open-meteo/amsterdam-forecast.json');

const LAT = '52.373187';
const LON = '4.892241';
const COORDS = `lat=${LAT}&lon=${LON}`;
// Responses legitimately hold the rounded location (52.37, 4.89). Logs may hold only lat/lon rounded to 1 decimal.
const RESPONSE_LEAK = /373187|892241|lat=|secret/;
const LOG_LEAK = /52\.37|4\.89|373187|892241|latitude|longitude|lat=|secret/;
const NOW = Date.UTC(2026, 10, 2, 9, 0, 0);
const LOG_ENDPOINT = 'https://logs.example.test';
const UPSTREAM = /^https:\/\/api\.open-meteo\.com\//;

const original = {
  fetch: global.fetch,
  token: process.env.LOGTAIL_TOKEN,
  endpoint: process.env.LOGTAIL_ENDPOINT
};

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

let modules;
let upstream;
let logged;

// A token-enabled copy of the whole app, so its real logger sends payloads to the mocked fetch.
function load() {
  process.env.LOGTAIL_TOKEN = 'test-token';
  process.env.LOGTAIL_ENDPOINT = LOG_ENDPOINT;
  jest.isolateModules(() => {
    modules = {
      ...require('../app'),
      ...require('../lib/weatherCache'),
      ...require('../lib/openMeteo'),
      logging: require('../middleware/logging'),
      stripAuth: require('../middleware/stripAuth')
    };
  });
}

beforeEach(() => {
  logged = [];
  upstream = jest.fn(async () => new Response(JSON.stringify(amsterdamFixture)));
  global.fetch = jest.fn(async (url, options) => {
    if (UPSTREAM.test(String(url))) return upstream(url, options);
    logged.push(JSON.parse(options.body));
    return { ok: true };
  });
  [console.log, console.warn, console.error, console.info].forEach(mock => mock.mockClear());
  load();
});

afterEach(() => {
  global.fetch = original.fetch;
  restore('LOGTAIL_TOKEN', original.token);
  restore('LOGTAIL_ENDPOINT', original.endpoint);
});

const realCache = overrides => {
  const { createWeatherCache, fetchForecast, logging } = modules;
  return createWeatherCache({
    fetchForecast,
    now: () => NOW,
    onFailure: reason => logging.logError(new Error(reason)),
    ...overrides
  });
};

const appWith = weather => modules.createApp({ weather, now: () => NOW });

// Console arguments are inspected, so objects (`console.log('query', req.query)`) are searched too.
const consoleOutput = () =>
  [console.log, console.warn, console.error, console.info]
    .flatMap(mock => mock.mock.calls)
    .map(args => args.map(arg => util.inspect(arg, { depth: null })).join(' '))
    .join('\n');
// Timestamp, client ID and timing come from the clock and a random hash, so they can match by chance (04.891Z).
const withoutRandomFields = payloads => payloads.map(({ dt, clientId, responseTime, ...rest }) => rest);
const logOutput = () => `${JSON.stringify(withoutRandomFields(logged))}\n${consoleOutput()}`;

function expectNoLeak(response) {
  expect(logOutput()).not.toMatch(LOG_LEAK);
  expect(JSON.stringify({ status: response.status, headers: response.headers, body: response.text })).not.toMatch(
    RESPONSE_LEAK
  );
}

// Authorization and the coordinates go on every request, as TRMNL would send them.
const send = (app, url, extra = {}) => {
  let req = request(app).get(url).set('Authorization', 'Bearer secret').set('Cookie', 'sid=secret');
  for (const [name, value] of Object.entries(extra)) req = req.set(name, value);
  return req;
};

describe('Authorization and Cookie', () => {
  const failing = message => ({
    getForecast: jest.fn().mockRejectedValue(new Error(message)),
    stats: () => ({})
  });

  test.each([
    ['a 200', () => realCache(), `/api/window?${COORDS}`, 200],
    ['a 400', () => realCache(), `/api/window?lat=91.373187&lon=${LON}`, 400],
    ['a 404', () => realCache(), `/nope?${COORDS}`, 404],
    ['a 500', () => failing('database unavailable'), `/api/window?${COORDS}`, 500],
    [
      'a 503 for capacity',
      () => realCache({ budget: { keysPerDay: 0, callsPerMinute: 10, callsPerDay: 10 } }),
      `/api/window?${COORDS}`,
      503
    ],
    ['a health check', () => realCache(), '/health/cache', 200]
  ])('%s leaks neither the credentials nor coordinates', async (_, weather, url, status) => {
    const response = await send(appWith(weather()), url);

    expect(response.status).toBe(status);
    expect(logged.length).toBeGreaterThan(0);
    expectNoLeak(response);
  });

  test('stripAuth runs before the logger, so nothing logs the headers', () => {
    const app = appWith(realCache());
    const handles = app._router.stack.map(layer => layer.handle);

    const stripIndex = handles.indexOf(modules.stripAuth);
    const logIndex = handles.indexOf(modules.logging.loggingMiddleware);
    expect(handles.slice(0, stripIndex).map(handle => handle.name)).toEqual(['query', 'expressInit']); // Express's own
    expect(logIndex).toBeGreaterThan(stripIndex);
  });
});

describe('coordinates', () => {
  test.each([
    ['an encoded query in the path', `/api/window%3Flat%3D${LAT}%26lon%3D${LON}`],
    ['matrix parameters', `/api/window;lat=${LAT};lon=${LON}`],
    ['coordinates as path segments', `/${LAT}/${LON}`],
    ['a coordinate path under /api', `/api/${LAT}/${LON}`]
  ])('a 404 for %s is logged as other', async (_, url) => {
    const response = await send(appWith(realCache()), url);

    expect(response.status).toBe(404);
    expect(logged.find(entry => 'statusCode' in entry)).toMatchObject({ path: 'other', message: 'GET other - 404' });
    expectNoLeak(response);
  });

  test('a 200 logs the path and the location rounded to one decimal, nothing finer', async () => {
    const response = await send(appWith(realCache()), `/api/window?${COORDS}`);

    expect(logged.find(entry => 'statusCode' in entry)).toMatchObject({ path: '/api/window', lat: 52.4, lon: 4.9 });
    expect(JSON.parse(response.text).location).toEqual({ lat: 52.37, lon: 4.89, timezone: 'Europe/Amsterdam' });
    expectNoLeak(response);
  });

  test('a referrer carrying coordinates is not logged', async () => {
    const response = await send(appWith(realCache()), `/api/window?${COORDS}`, {
      Referer: `https://example.com/map?${COORDS}`
    });

    expect(response.status).toBe(200);
    expectNoLeak(response);
    expect(logOutput()).not.toMatch(/example\.com/);
  });

  test('a validation error names the parameter, not its value', async () => {
    const response = await send(appWith(realCache()), `/api/window?lat=${LAT}&lon=${LON}&rain=${LAT}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/rain/);
    expectNoLeak(response);
  });

  test.each([
    [
      'a connection error that mentions the URL',
      () => {
        const error = new TypeError(`fetch failed for https://api.open-meteo.com/v1/forecast?${COORDS}`);
        error.cause = { code: 'ECONNREFUSED', message: `connect refused ${COORDS}` };
        throw error;
      }
    ],
    ['an error status whose body repeats the query', () => new Response(`bad ${COORDS}`, { status: 500 })],
    ['a body that is not JSON', () => new Response(`<html>${COORDS}</html>`)],
    ['a forecast that does not validate', () => new Response(JSON.stringify({ error: true, reason: COORDS }))]
  ])('a failed upstream call (%s) logs no coordinates', async (_, respond) => {
    upstream.mockImplementation(async () => respond());
    const response = await send(appWith(realCache()), `/api/window?${COORDS}`);

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
    expect(response.body.message).toBe('Weather data is temporarily unavailable.');
    expect(logged.map(entry => entry.error)).toContain('upstream_failed_no_usable_entry'); // the failure was reported
    expectNoLeak(response);
  });

  test('/health/cache after a fetch for those coordinates returns counts and ages only', async () => {
    const app = appWith(realCache());
    await send(app, `/api/window?${COORDS}`).expect(200);
    const response = await send(app, '/health/cache');

    expect(response.status).toBe(200);
    expect(response.body.cache).toMatchObject({ entries: 1, keysToday: 1, callsToday: 1 });
    Object.values(response.body.cache).forEach(value => expect(typeof value).toBe('number'));
    expect(response.text).not.toMatch(/52\.37|4\.89/);
    expectNoLeak(response);
  });
});

describe('error reporting', () => {
  const errorPayloads = () => logged.filter(entry => entry.level === 'error' && !('statusCode' in entry));

  test('a 500 is reported with its message and the allowlisted path', async () => {
    const weather = { getForecast: jest.fn().mockRejectedValue(new Error('database unavailable')), stats: () => ({}) };
    const response = await send(appWith(weather), `/api/window?${COORDS}`);

    expect(response.status).toBe(500);
    expect(errorPayloads()).toEqual([
      expect.objectContaining({ error: 'database unavailable', path: '/api/window', method: 'GET' })
    ]);
    expectNoLeak(response);
  });

  test('an exposed 503 for capacity is not reported as an application error', async () => {
    const weather = realCache({ budget: { keysPerDay: 0, callsPerMinute: 10, callsPerDay: 10 } });
    const response = await send(appWith(weather), `/api/window?${COORDS}`);

    expect(response.status).toBe(503);
    expect(errorPayloads()).toEqual([]);
  });

  test('the default cache reports an upstream failure with a fixed reason and no coordinates', async () => {
    upstream.mockRejectedValue(new TypeError(`fetch failed ${COORDS}`));
    const response = await send(modules.createApp({ now: () => NOW }), `/api/window?${COORDS}`);

    expect(response.status).toBe(503);
    expect(errorPayloads()).toEqual([expect.objectContaining({ error: 'upstream_failed_no_usable_entry' })]);
    expectNoLeak(response);
  });
});

describe('the log leak check', () => {
  const scan = payloads => JSON.stringify(withoutRandomFields(payloads));

  test.each(['2026-11-02T09:00:04.891Z', '2026-11-02T09:00:52.371Z'])('ignores a timestamp such as %s', dt => {
    expect(scan([{ dt, clientId: '4a89d0052b37e1c4', responseTime: 52, path: '/health' }])).not.toMatch(LOG_LEAK);
  });

  test.each([{ message: 'lat 4.89' }, { lat: 52.37 }, { error: 'x 373187' }, { path: '/p?latitude=1' }])(
    'still catches %j in any other field',
    fields => {
      expect(scan([{ dt: 'x', clientId: 'y', ...fields }])).toMatch(LOG_LEAK);
    }
  );
});
