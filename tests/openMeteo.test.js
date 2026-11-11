const { fetchForecast } = require('../lib/openMeteo');
const fixture = require('./fixtures/open-meteo/amsterdam-forecast.json');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

const respond = (status, body) => jest.fn().mockResolvedValue(new Response(body, { status }));

test('sends forecast_days=4, timeformat=unixtime, timezone=auto and the rounded coordinates', async () => {
  global.fetch = respond(200, JSON.stringify(fixture));
  const forecast = await fetchForecast(52.371234, 4.894321);

  expect(forecast.timezone).toBe('Europe/Amsterdam');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = global.fetch.mock.calls[0];
  const parsed = new URL(url);
  expect(`${parsed.origin}${parsed.pathname}`).toBe('https://api.open-meteo.com/v1/forecast');
  expect(Object.fromEntries(parsed.searchParams)).toEqual({
    latitude: '52.37',
    longitude: '4.89',
    hourly: [
      'temperature_2m,apparent_temperature,precipitation_probability,precipitation',
      'wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code,cloud_cover'
    ].join(','),
    daily: 'sunrise,sunset',
    timezone: 'auto',
    forecast_days: '4',
    wind_speed_unit: 'kmh',
    timeformat: 'unixtime'
  });
  expect(options.redirect).toBe('error');
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

test.each([
  [500, 'x'],
  [200, 'not json'],
  [200, '{"error":true,"reason":"Latitude 52.37"}'],
  [200, '{}']
])('status %i body %s rejects, and the error has no coordinates or URL', async (status, body) => {
  global.fetch = respond(status, body);
  const error = await fetchForecast(52.37, 4.89).catch(e => e);

  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toMatch(/52\.37|4\.89|open-meteo\.com|https?:|latitude/i);
  expect(error.message).not.toContain(body === 'x' ? 'x' : body);
});

test('a network failure rejects without the URL', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }));
  const error = await fetchForecast(52.37, 4.89).catch(e => e);

  expect(error.message).toBe('Request failed: ECONNRESET');
});
