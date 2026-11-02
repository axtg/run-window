const express = require('express');
const request = require('supertest');

const stripAuth = require('../middleware/stripAuth');

const LAT = '52.373187';
const LON = '4.892241';
const COORDINATE_LEAK = /373187|892241|lat=/;

// Loads a token-enabled copy of the logger with fetch mocked, so nothing leaves the process.
function loadLogger() {
  process.env.LOGTAIL_TOKEN = 'test-token';
  process.env.LOGTAIL_ENDPOINT = 'https://logs.example.test';
  let logger;
  jest.isolateModules(() => {
    logger = require('../middleware/logging');
  });
  return logger;
}

const sentPayloads = () => global.fetch.mock.calls.map(([, options]) => JSON.parse(options.body));

describe('Logging middleware', () => {
  const original = {
    fetch: global.fetch,
    token: process.env.LOGTAIL_TOKEN,
    endpoint: process.env.LOGTAIL_ENDPOINT
  };

  function restore(name, value) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = original.fetch;
    restore('LOGTAIL_TOKEN', original.token);
    restore('LOGTAIL_ENDPOINT', original.endpoint);
    jest.useRealTimers();
  });

  function buildApp(logger) {
    const app = express();
    app.use(stripAuth);
    app.use(logger.loggingMiddleware);
    app.get('/api/window', (req, res) => res.json({ ok: true }));
    app.get('/boom', (req, res, next) => next(new Error('failed upstream')));
    app.use((error, req, res, _next) => {
      logger.logError(error, req);
      res.status(500).json({ message: 'Internal server error' });
    });
    return app;
  }

  describe('privacy', () => {
    test.each([
      ['a 200 on the window route', `/api/window?lat=${LAT}&lon=${LON}`],
      ['a 404', `/nope?lat=${LAT}&lon=${LON}`],
      ['a 400', `/api/window?lat=91.373187&lon=${LON}`]
    ])('%s logs no query string or exact coordinates', async (_, url) => {
      await request(buildApp(loadLogger())).get(url);

      const [payload] = sentPayloads();
      expect(payload).toBeDefined();
      expect(JSON.stringify(payload)).not.toMatch(COORDINATE_LEAK);
      expect(payload.message).toMatch(/^GET \/(api\/window|nope) - \d{3}$/);
    });

    test('referrer with coordinates is not logged', async () => {
      await request(buildApp(loadLogger()))
        .get('/api/window')
        .set('Referer', `https://example.test/?lat=${LAT}&lon=${LON}`);

      const [payload] = sentPayloads();
      expect(JSON.stringify(payload)).not.toMatch(COORDINATE_LEAK);
      expect(payload).not.toHaveProperty('referrer');
    });

    test('authorization and cookie values are not logged', async () => {
      await request(buildApp(loadLogger()))
        .get('/api/window')
        .set('Authorization', 'Bearer secret')
        .set('Cookie', 'a=secret');

      expect(JSON.stringify(sentPayloads())).not.toContain('secret');
    });

    test('a request with an Authorization header leaves no secret in logs, error reports or the response', async () => {
      const response = await request(buildApp(loadLogger())).get('/boom').set('Authorization', 'Bearer secret');

      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body) + JSON.stringify(response.headers)).not.toContain('secret');
      expect(sentPayloads().length).toBe(2); // the error report and the request log
      expect(JSON.stringify(sentPayloads())).not.toContain('secret');
    });

    test('window route logs lat and lon rounded to 1 decimal as separate fields', async () => {
      await request(buildApp(loadLogger())).get(`/api/window?lat=${LAT}&lon=${LON}`);

      expect(sentPayloads()[0]).toMatchObject({ lat: 52.4, lon: 4.9 });
    });

    test('negative coordinates are rounded and never logged as -0', async () => {
      await request(buildApp(loadLogger())).get('/api/window?lat=-0.04&lon=-12.351');

      const [payload] = sentPayloads();
      expect(Object.is(payload.lat, 0)).toBe(true);
      expect(payload.lon).toBe(-12.4);
    });

    test.each([
      ['another path', `/other?lat=${LAT}&lon=${LON}`],
      ['a path that only starts with the window path', `/api/window/extra?lat=${LAT}&lon=${LON}`],
      ['out-of-range latitude', `/api/window?lat=91.373187&lon=${LON}`],
      ['out-of-range longitude', `/api/window?lat=${LAT}&lon=181.5`],
      ['non-numeric value', `/api/window?lat=abc&lon=${LON}`],
      ['exponent notation', `/api/window?lat=5e1&lon=${LON}`],
      ['missing longitude', `/api/window?lat=${LAT}`],
      ['repeated parameter', `/api/window?lat=${LAT}&lat=1&lon=${LON}`],
      ['object parameter', `/api/window?lat[x]=${LAT}&lon=${LON}`]
    ])('does not log lat or lon for %s', async (_, url) => {
      await request(buildApp(loadLogger())).get(url);

      const [payload] = sentPayloads();
      expect(payload).not.toHaveProperty('lat');
      expect(payload).not.toHaveProperty('lon');
    });

    test('logError logs the path only, with no coordinates in its fields', async () => {
      const logger = loadLogger();
      logger.logError(new Error('failed upstream'), {
        path: '/api/window',
        originalUrl: `/api/window?lat=${LAT}&lon=${LON}`,
        url: `/api/window?lat=${LAT}&lon=${LON}`,
        query: { lat: LAT, lon: LON },
        method: 'GET',
        ip: '203.0.113.7'
      });

      const [payload] = sentPayloads();
      expect(payload).toMatchObject({ path: '/api/window', method: 'GET', service: 'run-window-api' });
      expect(JSON.stringify(payload)).not.toMatch(COORDINATE_LEAK);
      expect(payload).not.toHaveProperty('lat');
      expect(payload).not.toHaveProperty('url');
    });

    test('payload has service run-window-api and no url, query or referrer keys', async () => {
      await request(buildApp(loadLogger()))
        .get(`/api/window?lat=${LAT}&lon=${LON}`)
        .set('Referer', 'https://example.test/');

      const [payload] = sentPayloads();
      expect(payload.service).toBe('run-window-api');
      for (const key of ['url', 'query', 'referrer', 'country']) expect(payload).not.toHaveProperty(key);
    });
  });

  describe('delivery', () => {
    test('sends to the endpoint from LOGTAIL_ENDPOINT', async () => {
      await request(buildApp(loadLogger())).get('/api/window');

      expect(global.fetch.mock.calls[0][0]).toBe('https://logs.example.test');
    });

    test('sends nothing when LOGTAIL_ENDPOINT is not set', async () => {
      process.env.LOGTAIL_TOKEN = 'test-token';
      delete process.env.LOGTAIL_ENDPOINT;
      let logger;
      jest.isolateModules(() => {
        logger = require('../middleware/logging');
      });

      await request(buildApp(logger)).get('/api/window');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('no part of the token is written to the console at startup', () => {
      process.env.LOGTAIL_ENDPOINT = 'https://logs.example.test';
      process.env.LOGTAIL_TOKEN = 'SECRETTOKENVALUE';
      console.log.mockClear();

      jest.isolateModules(() => require('../middleware/logging'));

      expect(console.log).toHaveBeenCalled();
      expect(JSON.stringify(console.log.mock.calls)).not.toContain('SECRETTO');
    });

    test('a failure while building the log entry does not break the response', async () => {
      const app = express();
      app.use(loadLogger().loggingMiddleware);
      app.get('/ok', (req, res) => {
        req.get = () => {
          throw new Error('log field failure');
        };
        res.json({ ok: true });
      });

      const response = await request(app).get('/ok');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('a request with an undecodable path is still logged', async () => {
      const logger = loadLogger();
      const app = express();
      app.use(logger.loggingMiddleware);
      app.get('/:name/today', (req, res) => res.json({ ok: true }));

      await request(app).get('/%FF/today');

      expect(sentPayloads()[0]).toMatchObject({ statusCode: 400, path: '/%FF/today' });
    });
  });

  describe('client ID', () => {
    const CLIENT_IP = '203.0.113.7';

    test('is stable for the same IP on the same day and differs between IPs', () => {
      const { getClientId } = loadLogger();
      expect(getClientId(CLIENT_IP)).toBe(getClientId(CLIENT_IP));
      expect(getClientId(CLIENT_IP)).not.toBe(getClientId('203.0.113.8'));
      expect(getClientId(CLIENT_IP)).toMatch(/^[0-9a-f]{16}$/);
    });

    test('changes when the UTC day changes', () => {
      const { getClientId } = loadLogger();
      jest.useFakeTimers({ now: new Date('2026-10-31T23:59:59Z') });
      const before = getClientId(CLIENT_IP);

      jest.setSystemTime(new Date('2026-11-01T00:00:00Z'));

      expect(getClientId(CLIENT_IP)).not.toBe(before);
    });

    test('is null when there is no IP', () => {
      expect(loadLogger().getClientId(undefined)).toBeNull();
    });

    test('request logs carry a client ID and never the IP', async () => {
      const app = buildApp(loadLogger());
      app.set('trust proxy', 'loopback');

      await request(app).get('/api/window').set('X-Forwarded-For', CLIENT_IP);

      const [payload] = sentPayloads();
      expect(payload.clientId).toMatch(/^[0-9a-f]{16}$/);
      expect(payload).not.toHaveProperty('ip');
      expect(JSON.stringify(payload)).not.toContain(CLIENT_IP);
    });

    test('error logs carry a client ID and never the IP', () => {
      loadLogger().logError(new Error('boom'), { ip: CLIENT_IP, path: '/x', method: 'GET' });

      const [payload] = sentPayloads();
      expect(payload.clientId).toMatch(/^[0-9a-f]{16}$/);
      expect(payload).not.toHaveProperty('ip');
      expect(JSON.stringify(payload)).not.toContain(CLIENT_IP);
    });

    test('logError without a request has no client ID and does not throw', () => {
      expect(() => loadLogger().logError(new Error('boom'))).not.toThrow();
    });
  });
});
