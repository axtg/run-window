const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const { createApp } = require('../app');
const { parseForecast } = require('../lib/forecast');
const { createWeatherCache } = require('../lib/weatherCache');
const { makeForecastJson } = require('./helpers/forecast');
const amsterdamFixture = require('./fixtures/open-meteo/amsterdam-forecast.json');

const NOW = Date.UTC(2026, 10, 2, 9, 0, 0); // 09:00Z on the fixture's first day
const URL = '/api/window?lat=52.3731&lon=4.8922&avail=07-09,12-14,17-21';
const LABEL = /^\d\d:\d\d–\d\d:\d\d · /;

const forecast = parseForecast(amsterdamFixture);
const wetForecast = parseForecast(
  makeForecastJson({
    startMs: Date.UTC(2026, 10, 1, 23),
    hours: 96,
    sun: [
      { sunriseMs: Date.UTC(2026, 10, 2, 6, 38), sunsetMs: Date.UTC(2026, 10, 2, 16, 9) },
      { sunriseMs: Date.UTC(2026, 10, 3, 6, 40), sunsetMs: Date.UTC(2026, 10, 3, 16, 7) }
    ],
    values: () => ({ precipitation_probability: 100 })
  })
);

const fakeWeather = (result = { forecast, stale: false }) => ({
  getForecast: jest.fn().mockResolvedValue(result),
  stats: jest
    .fn()
    .mockReturnValue({ entries: 1, oldestAgeSeconds: 12, keysToday: 1, callsToday: 1, callsThisMinute: 1 })
});

const build = (weather = fakeWeather(), options = {}) => createApp({ weather, now: () => NOW, ...options });

describe('GET /api/window', () => {
  test('response shape', async () => {
    const { body } = await request(build()).get(URL).expect(200);

    expect(Object.keys(body)).toEqual(['location', 'generatedAt', 'params', 'days', 'attribution']);
    expect(body.location).toEqual({ lat: 52.37, lon: 4.89, timezone: 'Europe/Amsterdam' });
    expect(body.generatedAt).toBe('2026-11-02T09:00:00.000Z');
    expect(body.params).toEqual({ avail: '07-09,12-14,17-21', dark: 'avoid', rain: 40, prefer: 'balanced' });
    expect(body.days).toHaveLength(2);
    expect(body.days.map(day => day.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(Object.keys(body.days[0].windows)).toHaveLength(12);
    expect(Object.keys(body.days[0])).toEqual(expect.arrayContaining(['date', 'sunrise', 'sunset', 'windows']));
    expect(body.attribution).toBe('Weather data by Open-Meteo.com');
    expect(body.warnings).toBeUndefined();
  });

  test('the location uses the request coordinates rounded, not the upstream ones', async () => {
    const weather = fakeWeather();
    await request(build(weather)).get('/api/window?lat=52.3731&lon=4.8922').expect(200);

    expect(weather.getForecast).toHaveBeenCalledWith(52.37, 4.89);
  });

  test('every non-null window has a label', async () => {
    const { body } = await request(build()).get(URL).expect(200);
    const windows = body.days.flatMap(day => Object.values(day.windows)).filter(Boolean);

    expect(windows.length).toBeGreaterThan(0);
    windows.forEach(window => expect(window.label).toMatch(LABEL));
    expect(windows[0].label).toContain(' · dry · ');
  });

  test('the fallback has a label too, and lang=nl changes the words', async () => {
    const weather = fakeWeather({ forecast: wetForecast, stale: false });
    const en = await request(build(weather)).get(`${URL}&rain=0`).expect(200);
    const nl = await request(build(weather)).get(`${URL}&rain=0&lang=nl`).expect(200);

    const [today] = en.body.days;
    expect(today.windows['60']).toBeNull();
    expect(today.fallback.qualifies).toBe(false);
    expect(today.fallback.label).toMatch(LABEL);
    expect(today.fallback.label).toContain(' · rain 100% · ');
    expect(today.fallback.label).toContain('km/h');
    expect(nl.body.days[0].fallback.label).toContain(' · regen 100% · ');
    expect(nl.body.days[0].fallback.label).toContain('km/u');
  });

  test('stale data adds warnings: ["stale_data"]', async () => {
    const { body } = await request(build(fakeWeather({ forecast, stale: true })))
      .get(URL)
      .expect(200);

    expect(body.warnings).toEqual(['stale_data']);
    expect(Object.keys(body)).toEqual(['location', 'generatedAt', 'params', 'days', 'attribution', 'warnings']);
  });

  test.each([
    ['lat', 'lat=abc&lon=4.89', /lat/],
    ['lat out of range', 'lat=91&lon=4.89', /lat/],
    ['lat missing', 'lon=4.89', /lat/],
    ['lon', 'lat=52.37&lon=181', /lon/],
    ['lon missing', 'lat=52.37', /lon/],
    ['avail', 'lat=52.37&lon=4.89&avail=25-26', /avail/],
    ['dark', 'lat=52.37&lon=4.89&dark=maybe', /dark/],
    ['rain', 'lat=52.37&lon=4.89&rain=101', /rain/],
    ['lang', 'lat=52.37&lon=4.89&lang=de', /lang/],
    ['lat repeated', 'lat=52.37&lat=53.37&lon=4.89', /lat/],
    ['lon repeated', 'lat=52.37&lon=4.89&lon=5.89', /lon/],
    ['avail repeated', 'lat=52.37&lon=4.89&avail=07-09&avail=12-14', /avail/],
    ['dark repeated', 'lat=52.37&lon=4.89&dark=ok&dark=avoid', /dark/],
    ['rain repeated', 'lat=52.37&lon=4.89&rain=10&rain=20', /rain/],
    ['wind', 'lat=52.37&lon=4.89&wind=strong', /wind/],
    ['prefer', 'lat=52.37&lon=4.89&prefer=cold', /prefer/],
    ['lang repeated', 'lat=52.37&lon=4.89&lang=en&lang=nl', /lang/]
  ])('%s is a 400 naming the parameter, before the weather cache is touched', async (_, query, name) => {
    const weather = fakeWeather();
    const { status, body } = await request(build(weather)).get(`/api/window?${query}`);

    expect(status).toBe(400);
    expect(body.status).toBe('error');
    expect(body.message).toMatch(name);
    expect(weather.getForecast).not.toHaveBeenCalled();
  });

  test('empty values use defaults', async () => {
    const { body } = await request(build())
      .get('/api/window?lat=52.37&lon=4.89&avail=&dark=&rain=&prefer=&wind=&lang=')
      .expect(200);

    expect(body.params).toEqual({ avail: '06-22', dark: 'avoid', rain: 40, prefer: 'balanced' });
    expect(body.days[0].windows['30'].label).toContain(' · dry · ');
  });

  test('empty coordinates are still required', async () => {
    await request(build()).get('/api/window?lat=&lon=').expect(400);
  });

  test('weather failure is a 503 with its message', async () => {
    const weather = createWeatherCache({
      fetchForecast: jest.fn().mockRejectedValue(new Error('boom')),
      now: () => NOW
    });
    const { status, body, headers } = await request(build(weather)).get(URL);

    expect(status).toBe(503);
    expect(body).toEqual({ status: 'error', message: 'Weather data is temporarily unavailable.' });
    expect(headers['retry-after']).toBeUndefined();
  });

  test('capacity is a 503 with Retry-After', async () => {
    const weather = createWeatherCache({
      fetchForecast: jest.fn(),
      now: () => NOW,
      budget: { keysPerDay: 0, callsPerMinute: 10, callsPerDay: 10 }
    });
    const { status, body, headers } = await request(build(weather)).get(URL);

    expect(status).toBe(503);
    expect(body.message).toMatch(/at capacity/);
    expect(headers['retry-after']).toBe(String(15 * 3600)); // NOW is 09:00Z, so 15 hours to midnight UTC
  });

  test('an unexpected error is a 500 saying only "Internal server error"', async () => {
    const weather = fakeWeather();
    weather.getForecast.mockRejectedValue(new Error('database password is hunter2'));
    const { status, body } = await request(build(weather)).get(URL);

    expect(status).toBe(500);
    expect(body).toEqual({ status: 'error', message: 'Internal server error' });
  });
});

describe('other routes', () => {
  test('/health is healthy', async () => {
    const { body } = await request(build()).get('/health').expect(200);

    expect(body.status).toBe('healthy');
    expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
  });

  test('/health/cache returns counts and ages only', async () => {
    const weather = fakeWeather();
    await request(build(weather)).get(URL).expect(200);
    const { body } = await request(build(weather)).get('/health/cache').expect(200);

    expect(body.status).toBe('success');
    expect(Object.keys(body.cache).sort()).toEqual(
      ['callsThisMinute', 'callsToday', 'entries', 'keysToday', 'oldestAgeSeconds'].sort()
    );
    Object.values(body.cache).forEach(value => expect(typeof value).toBe('number'));
  });

  describe('/health/cache is for the host only, also if nginx drifts', () => {
    test('a direct loopback connection is allowed', async () => {
      await request(build()).get('/health/cache').expect(200);
    });

    test.each([['127.0.0.1'], ['::1'], ['::ffff:127.0.0.1']])('forwarded for %s is allowed', async ip => {
      await request(build()).get('/health/cache').set('X-Forwarded-For', ip).expect(200);
    });

    test.each([
      ['a public client', '203.0.113.7'],
      ['a client that claims loopback in front of its real address', '127.0.0.1, 203.0.113.7'],
      ['a public IPv6 client', '2001:db8::1']
    ])('%s gets the fixed 404 and no counters', async (_, forwardedFor) => {
      const weather = fakeWeather();
      const { body } = await request(build(weather))
        .get('/health/cache')
        .set('X-Forwarded-For', forwardedFor)
        .expect(404);

      expect(body).toEqual({ status: 'error', message: 'Endpoint not found.' });
      expect(weather.stats).not.toHaveBeenCalled();
    });

    test('/health stays public', async () => {
      await request(build()).get('/health').set('X-Forwarded-For', '203.0.113.7').expect(200);
    });
  });

  test('the landing page is served', async () => {
    const { text } = await request(build()).get('/').expect(200).expect('Content-Type', /html/);

    expect(text).toContain('Open-Meteo');
  });

  test.each(['/nope', '/api/nope', '/api'])('unknown route %s is a 404 JSON', async url => {
    const { status, body } = await request(build()).get(url);

    expect(status).toBe(404);
    expect(body).toEqual({ status: 'error', message: 'Endpoint not found.' });
  });
});

describe('fallback', () => {
  test('is absent when a 60 minute window exists', async () => {
    const { body } = await request(build()).get(URL).expect(200);
    const day = body.days.find(candidate => candidate.windows['60']);

    expect(day).toBeDefined();
    expect(day).not.toHaveProperty('fallback');
  });

  test('passes through as null, without a label error', async () => {
    // Daylight is 07:38-17:09 local, so an availability range at night leaves no slot to fall back to.
    const weather = fakeWeather({ forecast: wetForecast, stale: false });
    const { status, body } = await request(build(weather)).get('/api/window?lat=52.37&lon=4.89&avail=22-23&rain=0');

    expect(status).toBe(200);
    body.days.forEach(day => {
      expect(day.windows['60']).toBeNull();
      expect(day.fallback).toBeNull();
    });
  });
});

describe('/openapi.yaml errors', () => {
  const missing = Object.assign(new Error("ENOENT: no such file or directory, stat '/srv/secret/docs/openapi.yaml'"), {
    code: 'ENOENT',
    syscall: 'stat',
    path: '/srv/secret/docs/openapi.yaml',
    status: 404,
    statusCode: 404
  });

  afterEach(() => jest.restoreAllMocks());

  test('a missing file is the fixed 404 with no path', async () => {
    jest.spyOn(express.response, 'sendFile').mockImplementation((file, callback) => callback(missing));
    const { status, body } = await request(build()).get('/openapi.yaml');

    expect(status).toBe(404);
    expect(body).toEqual({ status: 'error', message: 'Endpoint not found.' });
  });

  test('any other failure is a generic 500', async () => {
    const error = Object.assign(new Error('EACCES: permission denied, open /srv/secret/x'), { code: 'EACCES' });
    jest.spyOn(express.response, 'sendFile').mockImplementation((file, callback) => callback(error));
    const { status, body } = await request(build()).get('/openapi.yaml');

    expect(status).toBe(500);
    expect(body).toEqual({ status: 'error', message: 'Internal server error' });
  });

  test('a client abort after the response started is ignored', async () => {
    jest.spyOn(express.response, 'sendFile').mockImplementation(function (file, callback) {
      this.status(200).end('partial');
      callback(Object.assign(new Error('Request aborted'), { code: 'ECONNABORTED', status: 400 }));
    });

    await request(build()).get('/openapi.yaml').expect(200);
  });

  test('Express own 4xx errors, such as a malformed URL, carry no file path', async () => {
    const { status, body } = await request(build()).get('/%E0%A4%A');

    expect(status).toBe(404);
    expect(JSON.stringify(body)).not.toMatch(/\/home|\/srv|ENOENT|%E0/);
  });
});

describe('rate limiting', () => {
  test('/api routes are limited per client', async () => {
    const app = build(fakeWeather(), { rateLimit: 2 });

    await request(app).get(URL).expect(200);
    await request(app).get(URL).expect(200);
    const { status, body, headers } = await request(app).get(URL);

    expect(status).toBe(429);
    expect(body.message).toMatch(/Rate limit/);
    expect(headers['retry-after']).toBe('1');
  });

  test('unknown /api routes count too', async () => {
    const app = build(fakeWeather(), { rateLimit: 1 });

    await request(app).get('/api/nope').expect(404);
    await request(app).get('/api/nope').expect(429);
  });

  test('/health is not limited', async () => {
    const app = build(fakeWeather(), { rateLimit: 1 });

    for (let i = 0; i < 5; i++) await request(app).get('/health').expect(200);
    for (let i = 0; i < 3; i++) await request(app).get('/health/cache').expect(200);
  });
});

describe('GET /api/window golden responses', () => {
  const GOLDEN_URL = '/api/window?lat=52.37&lon=4.89&avail=07-09,12-14,17-21';
  const golden = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

  test.each([
    ['dry Amsterdam forecast', forecast, 'window-response-amsterdam.json'],
    ['wet forecast with a fallback', wetForecast, 'window-response-amsterdam-wet.json']
  ])('without slots the response is byte-for-byte the golden one (%s)', async (_label, source, file) => {
    const weather = fakeWeather({ forecast: source, stale: false });
    const response = await request(build(weather)).get(GOLDEN_URL).expect(200);

    expect(response.text).toBe(golden(file));
  });

  test.each([
    ['dry Amsterdam forecast', forecast, 'window-response-amsterdam.json'],
    ['wet forecast with a fallback', wetForecast, 'window-response-amsterdam-wet.json']
  ])('an empty slots= is byte-for-byte the golden one too (%s)', async (_label, source, file) => {
    const weather = fakeWeather({ forecast: source, stale: false });
    const response = await request(build(weather)).get(`${GOLDEN_URL}&slots=`).expect(200);

    expect(response.text).toBe(golden(file));
  });

  test.each([
    ['dry Amsterdam forecast', forecast, 'window-response-amsterdam.json'],
    ['wet forecast with a fallback', wetForecast, 'window-response-amsterdam-wet.json']
  ])('slots=1 adds slots to both days and nothing else (%s)', async (_label, source, file) => {
    const weather = fakeWeather({ forecast: source, stale: false });
    const { body } = await request(build(weather)).get(`${GOLDEN_URL}&slots=1`).expect(200);

    expect(body.params).toEqual({ avail: '07-09,12-14,17-21', dark: 'avoid', rain: 40, prefer: 'balanced' });
    body.days.forEach(day => {
      expect(Object.keys(day).at(-1)).toBe('slots');
      expect(day.slots.length).toBeGreaterThan(0);
    });
    const stripped = {
      ...body,
      days: body.days.map(day => Object.fromEntries(Object.entries(day).filter(([key]) => key !== 'slots')))
    };
    expect(JSON.stringify(stripped)).toBe(golden(file));
  });

  test('slots=1 on the default avail lists 64 slots tomorrow', async () => {
    const { body } = await request(build()).get('/api/window?lat=52.37&lon=4.89&slots=1').expect(200);

    expect(body.days[1].slots).toHaveLength(64);
  });

  test('slots=1 with a bad value is 400', async () => {
    const { body } = await request(build()).get('/api/window?lat=52.37&lon=4.89&slots=yes').expect(400);

    expect(body.message).toBe('Invalid slots: must be 1 or empty');
    expect(JSON.stringify(body)).not.toContain('yes');
  });
});
