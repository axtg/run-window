const { createWeatherCache, BUDGET } = require('../lib/weatherCache');

const MIN = 60000;
const CAPACITY = 'The service is at capacity for new locations today. Try again after midnight UTC.';
const UNAVAILABLE = 'Weather data is temporarily unavailable.';
const at = (time, day = '2026-11-02') => Date.parse(`${day}T${time}Z`);
const T0 = at('10:00:00');

const budget = { keysPerDay: 2, callsPerMinute: 3, callsPerDay: 5 };
const roomy = { keysPerDay: 100, callsPerMinute: 100, callsPerDay: 100 };

// Location n is its own cache key.
const loc = n => [50 + n / 100, 4];

function setup(limits = budget, extra = {}) {
  const clock = { t: T0 };
  const fetchForecast = jest.fn().mockResolvedValue({ marker: 1 });
  const onFailure = jest.fn();
  const cache = createWeatherCache({ fetchForecast, now: () => clock.t, onFailure, budget: limits, ...extra });
  const get = n => cache.getForecast(...loc(n));
  return { clock, fetchForecast, onFailure, cache, get };
}

const failure = async promise =>
  promise.then(
    () => null,
    e => e
  );

test('a new key over the cap gets a 503 with retryAfter, admitted keys keep working', async () => {
  const { get, fetchForecast, onFailure, cache } = setup();
  await get(1);
  await get(2);
  const error = await failure(get(3));

  expect(error).toMatchObject({ statusCode: 503, expose: true, message: CAPACITY, retryAfter: 14 * 3600 });
  expect(fetchForecast).toHaveBeenCalledTimes(2);
  expect(onFailure).not.toHaveBeenCalled();
  expect(cache.stats()).toMatchObject({ keysToday: 2, callsToday: 2 });

  expect(await get(1)).toEqual({ forecast: { marker: 1 }, stale: false });
  expect(await get(2)).toEqual({ forecast: { marker: 1 }, stale: false });
  expect(fetchForecast).toHaveBeenCalledTimes(2);
});

test('retryAfter counts whole seconds up to UTC midnight', async () => {
  const { get, clock } = setup({ ...roomy, keysPerDay: 1 });
  await get(1);
  clock.t = at('23:59:59.500');
  expect((await failure(get(2))).retryAfter).toBe(1);
});

test('an admitted key can still refresh after the cap is reached', async () => {
  const { get, fetchForecast, clock } = setup();
  await get(1);
  await get(2);
  expect((await failure(get(3))).statusCode).toBe(503);

  clock.t = at('11:05:00');
  fetchForecast.mockResolvedValue({ marker: 2 });
  expect(await get(1)).toEqual({ forecast: { marker: 2 }, stale: false });
  expect(fetchForecast).toHaveBeenCalledTimes(3);
});

test('the cap is checked before the cache, and resets at UTC midnight', async () => {
  const { get, fetchForecast, clock, onFailure } = setup({ ...roomy, keysPerDay: 2 });
  clock.t = at('23:58:00');
  await get(3); // cached until 00:05
  clock.t = at('00:01:00', '2026-11-03');
  await get(1);
  await get(2);

  clock.t = at('00:02:00', '2026-11-03');
  const error = await failure(get(3));
  expect(error).toMatchObject({ statusCode: 503, expose: true, message: CAPACITY, retryAfter: 24 * 3600 - 2 * 60 });
  expect(fetchForecast).toHaveBeenCalledTimes(3);
  expect(onFailure).not.toHaveBeenCalled();

  // Rejected for capacity is not a failure, so there is no 5 minute wait after midnight.
  clock.t = at('00:00:30', '2026-11-04');
  expect(await get(3)).toEqual({ forecast: { marker: 1 }, stale: false });
  expect(fetchForecast).toHaveBeenCalledTimes(4);
});

test('retries count towards the call limits', async () => {
  const { get, fetchForecast, clock, onFailure } = setup();
  fetchForecast.mockRejectedValue(new Error('boom'));
  for (let i = 0; i < 5; i++) {
    clock.t = T0 + i * 5 * MIN;
    expect(await failure(get(1))).toMatchObject({ statusCode: 503, message: UNAVAILABLE });
  }
  expect(fetchForecast).toHaveBeenCalledTimes(5);
  expect(onFailure).toHaveBeenCalledTimes(5);

  clock.t = T0 + 25 * MIN;
  fetchForecast.mockResolvedValue({ marker: 9 });
  expect(await failure(get(1))).toMatchObject({ statusCode: 503, message: UNAVAILABLE });
  expect(fetchForecast).toHaveBeenCalledTimes(5);
  expect(onFailure).toHaveBeenCalledTimes(5);
});

test('a call counts when it is attempted, before it completes', async () => {
  const { get, fetchForecast, cache } = setup();
  let resolve;
  fetchForecast.mockReturnValue(new Promise(r => (resolve = r)));
  const pending = get(1);
  expect(cache.stats()).toMatchObject({ callsToday: 1, callsThisMinute: 1 });
  resolve({ marker: 1 });
  await pending;
  expect(cache.stats()).toMatchObject({ callsToday: 1, callsThisMinute: 1 });
});

test('over the minute limit: stale if there is an entry, otherwise 503', async () => {
  const { get, fetchForecast, clock, onFailure } = setup({ ...roomy, callsPerMinute: 3 });
  await get(1); // expires 10:05
  clock.t = at('10:05:10');
  await get(2);
  await get(3);
  await get(4);
  expect(fetchForecast).toHaveBeenCalledTimes(4);

  expect(await get(1)).toEqual({ forecast: { marker: 1 }, stale: true });
  expect(await failure(get(5))).toMatchObject({ statusCode: 503, expose: true, message: UNAVAILABLE });
  expect(fetchForecast).toHaveBeenCalledTimes(4);
  expect(onFailure).not.toHaveBeenCalled();

  // Hitting the budget sets no wait: the next minute refetches.
  clock.t = at('10:06:10');
  fetchForecast.mockResolvedValue({ marker: 2 });
  expect(await get(1)).toEqual({ forecast: { marker: 2 }, stale: false });
  expect(fetchForecast).toHaveBeenCalledTimes(5);
});

test('over the day limit: stale if there is an entry, otherwise 503', async () => {
  const { get, fetchForecast, clock, onFailure } = setup({ ...roomy, callsPerDay: 3 });
  await get(1);
  await get(2);
  await get(3);

  clock.t = at('11:05:00');
  expect(await get(1)).toEqual({ forecast: { marker: 1 }, stale: true });
  expect(await failure(get(4))).toMatchObject({ statusCode: 503, expose: true, message: UNAVAILABLE });
  expect(fetchForecast).toHaveBeenCalledTimes(3);
  expect(onFailure).not.toHaveBeenCalled();
});

test('call counters reset at the next minute and UTC day', async () => {
  const { get, fetchForecast, clock, cache } = setup({ keysPerDay: 100, callsPerMinute: 2, callsPerDay: 3 });
  await get(1);
  await get(2);
  expect(await failure(get(3))).toMatchObject({ statusCode: 503, message: UNAVAILABLE });
  expect(cache.stats()).toMatchObject({ callsToday: 2, callsThisMinute: 2 });

  clock.t = at('10:01:00');
  await get(3);
  expect(cache.stats()).toMatchObject({ callsToday: 3, callsThisMinute: 1 });

  clock.t = at('10:02:00');
  expect(await failure(get(4))).toMatchObject({ statusCode: 503, message: UNAVAILABLE });
  expect(fetchForecast).toHaveBeenCalledTimes(3);

  clock.t = at('00:00:10', '2026-11-03');
  await get(4);
  expect(fetchForecast).toHaveBeenCalledTimes(4);
  expect(cache.stats()).toMatchObject({ keysToday: 1, callsToday: 1, callsThisMinute: 1 });
});

test('a stale entry stays usable across the UTC day reset', async () => {
  const { get, fetchForecast, clock, cache } = setup();
  clock.t = at('23:50:00');
  await get(1);
  clock.t = at('00:10:00', '2026-11-03');
  fetchForecast.mockRejectedValue(new Error('boom'));

  expect(await get(1)).toEqual({ forecast: { marker: 1 }, stale: true });
  expect(cache.stats()).toMatchObject({ entries: 1, keysToday: 1, callsToday: 1 });
});

test('stats contains counts and ages, and no coordinates', async () => {
  const { cache, clock } = setup();
  expect(cache.stats()).toEqual({ entries: 0, oldestAgeSeconds: 0, keysToday: 0, callsToday: 0, callsThisMinute: 0 });

  await cache.getForecast(52.37, 4.89);
  clock.t = T0 + 90 * 1000;
  expect(cache.stats()).toEqual({ entries: 1, oldestAgeSeconds: 90, keysToday: 1, callsToday: 1, callsThisMinute: 0 });
  expect(JSON.stringify(cache.stats())).not.toMatch(/52\.37|4\.89/);
});

test('keys are stored only as salted hashes, with a new salt each UTC day', async () => {
  const seen = [];
  const hashKey = jest.fn((salt, key) => {
    seen.push({ salt: Buffer.from(salt).toString('hex'), key });
    return 'same-for-every-key';
  });
  const { get, clock, cache } = setup({ ...roomy, keysPerDay: 1 }, { hashKey });

  // If the set held the keys themselves, the second location would be over the cap of 1.
  await get(1);
  await get(2);
  expect(cache.stats().keysToday).toBe(1);
  expect(seen).toHaveLength(2);
  expect(seen[0].key).not.toBe(seen[1].key);
  expect(seen[0].salt).toMatch(/^[0-9a-f]{64}$/);
  expect(seen[1].salt).toBe(seen[0].salt);

  clock.t = at('00:00:01', '2026-11-03');
  await get(1);
  expect(seen).toHaveLength(3);
  expect(seen[2].salt).toMatch(/^[0-9a-f]{64}$/);
  expect(seen[2].salt).not.toBe(seen[0].salt);
});

test('the default hash separates locations', async () => {
  const { get } = setup({ ...roomy, keysPerDay: 1 });
  await get(1);
  expect(await failure(get(2))).toMatchObject({ message: CAPACITY });
});

test('real limits stay under Open-Meteo terms', () => {
  expect(BUDGET.callsPerDay).toBeLessThan(10000);
  expect(BUDGET.callsPerMinute).toBeLessThan(600);
  expect(BUDGET.callsPerDay * 31).toBeLessThan(300000);
});
