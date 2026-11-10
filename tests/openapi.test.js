const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { execFileSync } = require('child_process');

const { createApp } = require('../app');
const { parseForecast } = require('../lib/forecast');
const { makeForecastJson } = require('./helpers/forecast');
const amsterdamFixture = require('./fixtures/open-meteo/amsterdam-forecast.json');

const SPEC_FILE = path.join(__dirname, '..', 'docs', 'openapi.yaml');
const NOW = Date.UTC(2026, 10, 2, 9, 0, 0);
const URL = '/api/window?lat=52.37&lon=4.89&avail=07-09,12-14,17-21';

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

const build = forecast =>
  createApp({
    weather: { getForecast: async () => ({ forecast, stale: false }), stats: () => ({}) },
    now: () => NOW
  });

// swagger-parser is ESM-only and Jest here runs CommonJS, so it runs in a child process and hands back JSON.
const runParser = method =>
  execFileSync(
    process.execPath,
    [
      '-e',
      `require('@apidevtools/swagger-parser')[${JSON.stringify(method)}](${JSON.stringify(SPEC_FILE)})` +
        '.then(spec => process.stdout.write(JSON.stringify(spec)))' +
        '.catch(error => { console.error(error.message); process.exit(1); })'
    ],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
  );

let spec;
let schemas;

beforeAll(() => {
  spec = JSON.parse(runParser('dereference'));
  schemas = spec.components.schemas;
});

const keysOf = schema => Object.keys(schema.properties).sort();

test('the spec validates', () => {
  expect(() => runParser('validate')).not.toThrow();
});

test('documents every parameter and the 200, 400, 429 and 503 responses', () => {
  const operation = spec.paths['/api/window'].get;

  expect(operation.parameters.map(parameter => parameter.name).sort()).toEqual(
    ['avail', 'dark', 'lang', 'lat', 'lon', 'prefer', 'rain', 'slots', 'wind'].sort()
  );
  expect(
    operation.parameters
      .filter(parameter => parameter.required)
      .map(parameter => parameter.name)
      .sort()
  ).toEqual(['lat', 'lon']);
  expect(Object.keys(operation.responses).sort()).toEqual(['200', '400', '429', '503']);

  ['400', '429', '503'].forEach(code => {
    const { schema } = operation.responses[code].content['application/json'];
    const parts = schema.allOf || [schema];
    const properties = Object.assign({}, ...parts.map(part => part.properties));
    const required = parts.flatMap(part => part.required || []);
    expect(properties.status.enum).toEqual(['error']);
    expect(required).toEqual(expect.arrayContaining(['status', 'message']));
  });
  expect(operation.responses['503'].description).toMatch(/300/);
  expect(operation.responses['503'].headers['Retry-After']).toBeDefined();
  expect(operation.responses['429'].headers['Retry-After']).toBeDefined();
});

test('documents the other routes', () => {
  expect(Object.keys(spec.paths).sort()).toEqual(
    ['/api/capacity', '/api/window', '/health', '/health/cache', '/openapi.yaml'].sort()
  );
});

test('the capacity response matches the Capacity schema', async () => {
  const capacity = { perDay: 300, remainingShare: 0.85, full: false, asOf: 'a', resetsAt: 'b' };
  const app = createApp({ weather: { getForecast: jest.fn(), stats: () => ({}), capacity: () => capacity } });
  const { body, headers } = await request(app).get('/api/capacity').expect(200);
  expect(body).toEqual(capacity);
  expect(headers['cache-control']).toBe('public, max-age=300');
  expect(Object.keys(body).sort()).toEqual(keysOf(schemas.Capacity));
  expect(schemas.Capacity.required.sort()).toEqual(keysOf(schemas.Capacity));
});

test('the development server is on the port the app defaults to', () => {
  expect(spec.servers[0].url).toBe('http://localhost:3003');
  expect(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')).toContain('process.env.PORT || 3003');
});

test('the 400 example is the message the app really sends', async () => {
  const { body } = await request(build(parseForecast(amsterdamFixture)))
    .get('/api/window')
    .expect(400);

  expect(spec.paths['/api/window'].get.responses['400'].content['application/json'].example).toEqual(body);
});

test('/health/cache says it is for the host only', () => {
  expect(spec.paths['/health/cache'].get.description).toMatch(/from the host only/);
});

test('the fallback promises never the past and never darkness with dark=avoid', () => {
  const { description } = schemas.WindowDay.properties.fallback;

  expect(description).toMatch(/past/);
  expect(description).toMatch(/`dark=avoid`/);
  expect(description).toMatch(/available hours/);
});

test('the privacy section says no more than the code does', () => {
  const description = spec.info.description.replace(/\s+/g, ' ');

  expect(description).toContain('for about 3 hours');
  expect(description).toContain('Data older than 3 hours is never served');
  expect(description).toContain('with the key kept only in memory and replaced daily, not written to disk or logs');
  expect(description).toContain('User-Agent');
  expect(description).toContain('Better Stack');
  expect(description).not.toMatch(/at most 3 hours/);
});

test('no line is over 120 columns', () => {
  const lines = fs.readFileSync(SPEC_FILE, 'utf8').split('\n');

  expect(lines.filter(line => line.length > 120)).toEqual([]);
});

test('windows are keyed by the 15..180 durations with nullable values', () => {
  const windows = schemas.WindowDay.properties.windows;

  expect(windows.description).toMatch(/15/);
  expect(windows.description).toMatch(/180/);
  expect(windows.additionalProperties.nullable).toBe(true);
  expect(schemas.WindowDay.properties.fallback.nullable).toBe(true);
  expect(schemas.WindowDay.required).not.toContain('fallback');
});

describe('a real response has exactly the documented keys', () => {
  test('top level, day and window keys', async () => {
    const { body } = await request(build(parseForecast(amsterdamFixture)))
      .get(URL)
      .expect(200);
    const response = schemas.WindowResponse;

    expect(Object.keys(body).sort()).toEqual(expect.arrayContaining(response.required));
    Object.keys(body).forEach(key => expect(keysOf(response)).toContain(key));
    expect(Object.keys(body.location).sort()).toEqual(keysOf(schemas.Location));
    expect(Object.keys(body.params).sort()).toEqual(keysOf(schemas.Params));

    body.days.forEach(day => {
      expect(Object.keys(day).sort()).toEqual(
        keysOf(schemas.WindowDay).filter(key => key !== 'fallback' && key !== 'slots')
      );
      const durations = Object.keys(day.windows);
      expect(durations).toEqual(Array.from({ length: 12 }, (_, i) => String((i + 1) * 15)));
    });

    const windows = body.days.flatMap(day => Object.values(day.windows)).filter(Boolean);
    expect(windows.length).toBeGreaterThan(0);
    windows.forEach(window => expect(Object.keys(window).sort()).toEqual(keysOf(schemas.Window)));
  });

  test('a slots=1 response matches the documented Slot schema', async () => {
    const { body } = await request(build(parseForecast(amsterdamFixture)))
      .get(`${URL}&slots=1`)
      .expect(200);

    body.days.forEach(day => {
      expect(Object.keys(day).sort()).toEqual(keysOf(schemas.WindowDay).filter(key => key !== 'fallback'));
      expect(day.slots.length).toBeGreaterThan(0);
      day.slots.forEach(slot => {
        expect(Object.keys(slot).sort()).toEqual(keysOf(schemas.Slot));
        expect(schemas.Slot.properties.status.enum).toContain(slot.status);
      });
    });
    expect(schemas.WindowDay.required).not.toContain('slots');
  });

  test('the slots parameter is documented', () => {
    const parameter = spec.paths['/api/window'].get.parameters.find(item => item.name === 'slots');

    expect(parameter.in).toBe('query');
    expect(parameter.required).toBe(false);
    expect(parameter.schema.enum).toEqual(['1']);
  });

  test('the fallback and warnings keys match when present', async () => {
    const { body } = await request(build(wetForecast)).get(`${URL}&rain=0`).expect(200);
    const [today] = body.days;

    expect(Object.keys(today).sort()).toEqual(keysOf(schemas.WindowDay).filter(key => key !== 'slots'));
    expect(Object.keys(today.fallback).sort()).toEqual(keysOf(schemas.Window));
    expect(today.fallback.qualifies).toBe(false);
  });

  test('stale data adds the documented warning', async () => {
    const app = createApp({
      weather: {
        getForecast: async () => ({ forecast: parseForecast(amsterdamFixture), stale: true }),
        stats: () => ({})
      },
      now: () => NOW
    });
    const { body } = await request(app).get(URL).expect(200);

    expect(keysOf(schemas.WindowResponse)).toContain('warnings');
    expect(schemas.WindowResponse.properties.warnings.items.enum).toEqual(['stale_data']);
    expect(body.warnings).toEqual(['stale_data']);
  });
});

test('/openapi.yaml returns 200 and is the file in docs', async () => {
  const response = await request(build(parseForecast(amsterdamFixture)))
    .get('/openapi.yaml')
    .expect(200);

  expect(response.text).toBe(fs.readFileSync(SPEC_FILE, 'utf8'));
});
