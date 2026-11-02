const { createWeatherCache, nextExpiry, BUDGET } = require('../lib/weatherCache');
const { parseForecast } = require('../lib/forecast');
const { localDates, buildDaySlots } = require('../lib/windows');
const { fromZonedTime } = require('date-fns-tz');
const amsterdam = require('./fixtures/open-meteo/amsterdam-forecast.json');

const MIN = 60000;
const HOUR = 3600000;
const T0 = Date.parse('2026-11-02T10:00:00Z');
const at = time => Date.parse(`2026-11-02T${time}:00Z`);

function setup() {
  const clock = { t: T0 };
  const fetchForecast = jest.fn().mockResolvedValue({ marker: 1 });
  const onFailure = jest.fn();
  const cache = createWeatherCache({ fetchForecast, now: () => clock.t, onFailure });
  return { clock, fetchForecast, onFailure, cache };
}

const failure = async promise =>
  promise.then(
    () => null,
    e => e
  );

test('BUDGET holds the spec values', () => {
  expect(BUDGET).toEqual({ keysPerDay: 300, callsPerMinute: 300, callsPerDay: 8000 });
});

test.each([
  ['10:02', '10:05'],
  ['10:05', '11:05'],
  ['10:06', '11:05'],
  ['10:59', '11:05']
])('fetched at %s expires at %s', (fetched, expires) => {
  expect(nextExpiry(at(fetched))).toBe(at(expires));
});

test('a fresh entry makes no second call', async () => {
  const { cache, fetchForecast, clock } = setup();
  clock.t = at('10:10');
  const first = await cache.getForecast(52.37, 4.89);
  clock.t = at('11:04');
  const second = await cache.getForecast(52.37, 4.89);

  expect(fetchForecast).toHaveBeenCalledTimes(1);
  expect(first).toEqual({ forecast: { marker: 1 }, stale: false });
  expect(second).toEqual({ forecast: { marker: 1 }, stale: false });
});

test('other coordinates in the same key share an entry', async () => {
  const { cache, fetchForecast } = setup();
  await cache.getForecast(52.371, 4.894);
  await cache.getForecast(52.3749, 4.8851);
  await cache.getForecast(52.37, 4.89);

  expect(fetchForecast).toHaveBeenCalledTimes(1);
  expect(fetchForecast).toHaveBeenCalledWith(52.37, 4.89);

  await cache.getForecast(52.38, 4.89);
  expect(fetchForecast).toHaveBeenCalledTimes(2);
  expect(fetchForecast).toHaveBeenLastCalledWith(52.38, 4.89);
});

test('concurrent requests share one call', async () => {
  const { cache, fetchForecast } = setup();
  let resolve;
  fetchForecast.mockReturnValue(new Promise(r => (resolve = r)));
  const calls = [cache.getForecast(52.37, 4.89), cache.getForecast(52.37, 4.89), cache.getForecast(52.37, 4.89)];
  resolve({ marker: 2 });
  const results = await Promise.all(calls);

  expect(fetchForecast).toHaveBeenCalledTimes(1);
  results.forEach(r => expect(r).toEqual({ forecast: { marker: 2 }, stale: false }));
});

test('an expired entry is refetched', async () => {
  const { cache, fetchForecast, clock } = setup();
  clock.t = at('10:10');
  await cache.getForecast(52.37, 4.89);
  clock.t = at('11:05');
  fetchForecast.mockResolvedValue({ marker: 3 });
  const result = await cache.getForecast(52.37, 4.89);

  expect(fetchForecast).toHaveBeenCalledTimes(2);
  expect(result).toEqual({ forecast: { marker: 3 }, stale: false });
});

test('upstream failure with an entry under 3 hours old returns it as stale', async () => {
  const { cache, fetchForecast, clock, onFailure } = setup();
  await cache.getForecast(52.37, 4.89);
  clock.t = T0 + 3 * HOUR;
  fetchForecast.mockRejectedValue(new Error('boom'));
  const result = await cache.getForecast(52.37, 4.89);

  expect(result).toEqual({ forecast: { marker: 1 }, stale: true });
  expect(onFailure).toHaveBeenCalledTimes(1);
  expect(onFailure.mock.calls[0][0]).toEqual(expect.any(String));
});

test('stale age is measured from when the entry was fetched', async () => {
  const { cache, fetchForecast, clock } = setup();
  await cache.getForecast(52.37, 4.89);
  fetchForecast.mockRejectedValue(new Error('boom'));
  // A failed refresh at 11:30 must not make the entry look younger.
  clock.t = T0 + 90 * MIN;
  expect((await cache.getForecast(52.37, 4.89)).stale).toBe(true);
  clock.t = T0 + 3 * HOUR + MIN;
  expect(await failure(cache.getForecast(52.37, 4.89))).toMatchObject({ statusCode: 503 });
});

test('upstream failure with an entry over 3 hours old is a 503', async () => {
  const { cache, fetchForecast, clock } = setup();
  await cache.getForecast(52.37, 4.89);
  clock.t = T0 + 3 * HOUR + MIN;
  fetchForecast.mockRejectedValue(new Error('boom'));
  const error = await failure(cache.getForecast(52.37, 4.89));

  expect(error).toMatchObject({ statusCode: 503, expose: true, message: 'Weather data is temporarily unavailable.' });
});

test('upstream failure with no entry is a 503', async () => {
  const { cache, fetchForecast, onFailure } = setup();
  fetchForecast.mockRejectedValue(new Error('boom'));
  const error = await failure(cache.getForecast(52.37, 4.89));

  expect(error).toMatchObject({ statusCode: 503, expose: true, message: 'Weather data is temporarily unavailable.' });
  expect(onFailure).toHaveBeenCalledTimes(1);
});

test('the reason given to onFailure has no URL or coordinates, even if the error has', async () => {
  const { cache, fetchForecast, onFailure } = setup();
  fetchForecast.mockRejectedValue(new Error('GET https://api.open-meteo.com/v1/forecast?latitude=52.37 failed'));
  await failure(cache.getForecast(52.37, 4.89));

  expect(onFailure.mock.calls[0][0]).not.toMatch(/52\.37|open-meteo|https?:/);
});

test('after a failure the key waits 5 minutes', async () => {
  const { cache, fetchForecast, clock } = setup();
  fetchForecast.mockRejectedValue(new Error('boom'));
  await failure(cache.getForecast(52.37, 4.89));
  expect(fetchForecast).toHaveBeenCalledTimes(1);

  clock.t = T0 + 5 * MIN - 1;
  expect(await failure(cache.getForecast(52.37, 4.89))).toMatchObject({ statusCode: 503 });
  expect(fetchForecast).toHaveBeenCalledTimes(1);

  clock.t = T0 + 5 * MIN;
  fetchForecast.mockResolvedValue({ marker: 4 });
  expect(await cache.getForecast(52.37, 4.89)).toEqual({ forecast: { marker: 4 }, stale: false });
  expect(fetchForecast).toHaveBeenCalledTimes(2);
});

test('the wait after a failure is per key and still serves a stale entry', async () => {
  const { cache, fetchForecast, clock } = setup();
  await cache.getForecast(52.37, 4.89);
  clock.t = at('11:10');
  fetchForecast.mockRejectedValue(new Error('boom'));
  await cache.getForecast(52.37, 4.89);

  clock.t = at('11:12');
  expect((await cache.getForecast(52.37, 4.89)).stale).toBe(true);
  expect(fetchForecast).toHaveBeenCalledTimes(2);

  fetchForecast.mockResolvedValue({ marker: 5 });
  await cache.getForecast(52.4, 4.9);
  expect(fetchForecast).toHaveBeenCalledTimes(3);
});

test('junk from upstream never replaces a good entry', async () => {
  const { cache, fetchForecast, clock } = setup();
  await cache.getForecast(52.37, 4.89);
  clock.t = at('11:10');
  fetchForecast.mockRejectedValue(new Error('Invalid forecast: unexpected response'));
  const result = await cache.getForecast(52.37, 4.89);

  expect(result).toEqual({ forecast: { marker: 1 }, stale: true });
});

test('entries older than 3 hours are removed', async () => {
  const { cache, clock } = setup();
  await cache.getForecast(52.37, 4.89);
  await cache.getForecast(52.4, 4.9);
  expect(cache.stats().entries).toBe(2);

  clock.t = T0 + 3 * HOUR;
  await cache.getForecast(52.5, 4.9);
  expect(cache.stats().entries).toBe(3);

  clock.t = T0 + 3 * HOUR + MIN;
  await cache.getForecast(52.5, 4.9);
  expect(cache.stats().entries).toBe(1);
});

test('stale entry from before midnight still has a complete today and tomorrow', async () => {
  const forecast = parseForecast(amsterdam);
  const tz = forecast.timezone;
  const fetchedAt = fromZonedTime('2026-11-02T23:50:00', tz).getTime();
  const failAt = fromZonedTime('2026-11-03T00:10:00', tz).getTime();
  const clock = { t: fetchedAt };
  const fetchForecast = jest.fn().mockResolvedValue(forecast);
  const cache = createWeatherCache({ fetchForecast, now: () => clock.t });
  await cache.getForecast(52.37, 4.89);

  clock.t = failAt;
  fetchForecast.mockRejectedValue(new Error('boom'));
  const result = await cache.getForecast(52.37, 4.89);
  expect(result.stale).toBe(true);

  const dates = localDates(failAt, tz);
  expect(dates).toEqual(['2026-11-03', '2026-11-04']);
  const avail = [{ startMin: 0, endMin: 1440 }];
  for (const date of dates) {
    const slots = buildDaySlots({ date, forecast: result.forecast, avail, dark: 'ok', nowMs: 0 });
    expect(slots).toHaveLength(96);
    expect(slots.every(s => typeof s.values.precip === 'number' && typeof s.values.precipProb === 'number')).toBe(true);
    const last = slots[slots.length - 1].startMs;
    expect(last).toBe(fromZonedTime(`${date}T23:45:00`, tz).getTime());
  }
});
