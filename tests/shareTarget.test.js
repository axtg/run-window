const request = require('supertest');

// A share POST that gets past nginx and the worker must still find nothing in Node: no route, no body parser, and a
// log entry with the fixed path only.
const MARKER = 'MARKER-x7q';
const GPX = `<?xml version="1.0"?><gpx><trk><name>${MARKER}</name><trkseg><trkpt lat="52.3731" lon="4.8922"/>`;

describe('POST /share-target reaching the app', () => {
  const original = { fetch: global.fetch, token: process.env.LOGTAIL_TOKEN, endpoint: process.env.LOGTAIL_ENDPOINT };
  let app;

  function restore(name, value) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    process.env.LOGTAIL_TOKEN = 'test-token';
    process.env.LOGTAIL_ENDPOINT = 'https://logs.example.test';
    jest.isolateModules(() => {
      const { createApp } = require('../app');
      app = createApp({ weather: { getForecast: jest.fn(), stats: jest.fn() } });
    });
  });

  afterEach(() => {
    global.fetch = original.fetch;
    restore('LOGTAIL_TOKEN', original.token);
    restore('LOGTAIL_ENDPOINT', original.endpoint);
  });

  test.each(['/share-target', '/SHARE-TARGET/'])('%s answers the fixed 404 and logs no body content', async url => {
    const response = await request(app).post(url).attach('route', Buffer.from(GPX), 'morning.gpx').expect(404);

    expect(response.body).toEqual({ status: 'error', message: 'Endpoint not found.' });
    expect(response.text).not.toContain(MARKER);
    const payloads = global.fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ method: 'POST', path: '/share-target', statusCode: 404 });
    expect(JSON.stringify(payloads)).not.toMatch(new RegExp(`${MARKER}|morning|3731|8922`));
  });
});
