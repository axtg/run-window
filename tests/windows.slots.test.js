const { fromZonedTime } = require('date-fns-tz');
const { parseForecast } = require('../lib/forecast');
const { tagDaySlots, serializeSlot, buildDaySlots, computeDay, scoreSlot } = require('../lib/windows');
const { makeForecastJson } = require('./helpers/forecast');
const amsterdamFixture = require('./fixtures/open-meteo/amsterdam-forecast.json');
const dstEndFixture = require('./fixtures/open-meteo/amsterdam-dst-end.json');

const TZ = 'Europe/Amsterdam';
const DATE = '2026-11-02';
const MIDNIGHT = Date.parse('2026-11-01T23:00:00.000Z'); // local midnight of DATE, CET
const EARLY = Date.parse('2026-11-01T12:00:00.000Z');
const NOW = Date.UTC(2026, 10, 2, 9);
const local = (time, date = DATE) => fromZonedTime(`${date}T${time}:00`, TZ).getTime();
const range = (from, to) => ({ startMin: from * 60, endMin: to * 60 });
const ALL_DAY = [range(0, 24)];
const SUN = [{ sunriseMs: local('07:38'), sunsetMs: local('17:09') }];

// Row i is local hour i of DATE. A slot in hour h reads precipitation from row h + 1.
const wetHours = hours => i => (hours.includes(i - 1) ? { precipitation_probability: 100 } : {});
const makeForecast = ({ values, sun = SUN, startMs = MIDNIGHT, hours = 30 } = {}) =>
  parseForecast(makeForecastJson({ startMs, hours, sun, values }));
const tag = (forecast, overrides = {}) =>
  tagDaySlots({ date: DATE, forecast, avail: ALL_DAY, dark: 'avoid', rain: 40, nowMs: EARLY, ...overrides });
const statusAt = (slots, time) => slots.find(slot => slot.startMs === local(time)).status;

test('lists only slots that fit inside avail', () => {
  const slots = tag(makeForecast(), { avail: [range(7, 9)], dark: 'ok' });
  const first = slots.slice(0, 1)[0];

  expect(slots).toHaveLength(8);
  expect(first.startMs).toBe(local('07:00'));
  expect(slots[7].startMs).toBe(local('08:45'));
  expect(slots.some(slot => slot.startMs === local('09:00'))).toBe(false);
  expect(slots.map(slot => slot.startMs)).toEqual([...slots.map(slot => slot.startMs)].sort((a, b) => a - b));
});

test('status order is past, dark, missing, rain', () => {
  const wet = wetHours([6, 7, 9, 12]);
  const values = i => ({
    ...wet(i),
    ...(i === 9 ? { apparent_temperature: null } : {}) // hour 9 has no usable row
  });
  const slots = tag(makeForecast({ values }), { nowMs: local('06:30') });

  expect(statusAt(slots, '06:00')).toBe('past'); // past and wet and dark
  expect(statusAt(slots, '06:45')).toBe('dark'); // dark and wet, not past
  expect(statusAt(slots, '07:15')).toBe('dark'); // sunrise is 07:38
  expect(statusAt(slots, '09:00')).toBe('missing'); // wet and missing
  expect(statusAt(slots, '12:00')).toBe('rain');
  expect(statusAt(slots, '10:00')).toBe('ok');
});

test('dark is a status only with dark=avoid', () => {
  const slots = tag(makeForecast(), { dark: 'ok' });

  expect(slots.some(slot => slot.status === 'dark')).toBe(false);
  const night = slots.find(slot => slot.startMs === local('03:00'));
  expect(night.status).toBe('ok');
  expect(night.inDaylight).toBe(false);
  expect(slots.find(slot => slot.startMs === local('12:00')).inDaylight).toBe(true);
  expect(tag(makeForecast()).find(slot => slot.startMs === local('03:00')).status).toBe('dark');
});

test('past only appears today', () => {
  const tomorrow = '2026-11-03';
  const forecast = makeForecast({ hours: 60 });
  const slots = tagDaySlots({ date: tomorrow, forecast, avail: ALL_DAY, dark: 'ok', rain: 40, nowMs: local('15:00') });

  expect(slots.length).toBeGreaterThan(0);
  expect(slots.some(slot => slot.status === 'past')).toBe(false);
});

test('late evening leaves only past slots', () => {
  const forecast = makeForecast();
  const nowMs = local('21:50');
  const params = { avail: [range(6, 22)], dark: 'ok', rain: 40 };
  const slots = tag(forecast, { ...params, nowMs });

  expect(slots.length).toBeGreaterThan(0);
  expect(slots.every(slot => slot.status === 'past')).toBe(true);
  expect(slots.at(-1).startMs).toBe(local('21:45'));
  expect(computeDay({ date: DATE, forecast, params, nowMs }).windows['30']).toBeNull();
});

test('missing slots have null values and score', () => {
  const slots = tag(makeForecast({ values: i => (i === 12 ? { wind_speed_10m: null } : {}) }), { dark: 'ok' });
  const missing = slots.find(slot => slot.startMs === local('12:15'));

  expect(missing.status).toBe('missing');
  expect(missing.values).toBeNull();
  expect(serializeSlot(missing)).toEqual({
    start: new Date(local('12:15')).toISOString(),
    status: 'missing',
    score: null,
    apparentTemp: null,
    windSpeed: null,
    gust: null,
    windFrom: null,
    precipProb: null,
    precip: null,
    inDaylight: true
  });
});

test('serializeSlot rounds the weather fields', () => {
  const values = i => ({
    apparent_temperature: 11.26,
    wind_speed_10m: i === 12 ? 17.6 : 0,
    wind_gusts_10m: 33.4,
    wind_direction_10m: 201.6,
    precipitation_probability: 12.4,
    precipitation: 0.14
  });
  const slots = tag(makeForecast({ values }), { dark: 'ok' });
  const slot = slots.find(s => s.startMs === local('12:00'));
  const serialized = serializeSlot(slot);

  expect(Object.keys(serialized)).toEqual([
    'start',
    'status',
    'score',
    'apparentTemp',
    'windSpeed',
    'gust',
    'windFrom',
    'precipProb',
    'precip',
    'inDaylight'
  ]);
  expect(serialized).toMatchObject({
    status: 'ok',
    apparentTemp: 11.3,
    windSpeed: 18,
    gust: 33,
    windFrom: 202,
    precipProb: 12,
    precip: 0.1
  });
  expect(serialized.score).toBe(Math.round(scoreSlot(slot.values) * 10) / 10);
});

test('DST days have 100 and 92 slots', () => {
  const autumn = tagDaySlots({
    date: '2026-10-25',
    forecast: parseForecast(dstEndFixture),
    avail: ALL_DAY,
    dark: 'ok',
    rain: 100,
    nowMs: 0
  });
  expect(autumn).toHaveLength(100);

  const spring = makeForecast({ startMs: Date.parse('2027-03-27T23:00:00Z'), sun: [], hours: 40 });
  const springSlots = tagDaySlots({
    date: '2027-03-28',
    forecast: spring,
    avail: ALL_DAY,
    dark: 'ok',
    rain: 100,
    nowMs: EARLY
  });
  expect(springSlots).toHaveLength(92);
});

test('buildDaySlots equals the ok and rain slots of tagDaySlots', () => {
  const forecast = parseForecast(amsterdamFixture);
  const avail = [range(7, 9), range(12, 14), range(17, 21)];
  const tagged = tagDaySlots({ date: DATE, forecast, avail, dark: 'avoid', rain: 40, nowMs: NOW });
  const expected = tagged
    .filter(slot => slot.status === 'ok' || slot.status === 'rain')
    .map(({ startMs, rangeIndex, values, inDaylight }) => ({ startMs, rangeIndex, values, inDaylight }));

  expect(expected.length).toBeGreaterThan(0);
  expect(buildDaySlots({ date: DATE, forecast, avail, dark: 'avoid', nowMs: NOW })).toEqual(expected);
});

test('computeDay adds slots only when asked', () => {
  const forecast = parseForecast(amsterdamFixture);
  const params = { avail: [range(7, 9), range(12, 14), range(17, 21)], dark: 'avoid', rain: 40 };
  const plain = computeDay({ date: DATE, forecast, params, nowMs: NOW });
  const withSlots = computeDay({ date: DATE, forecast, params, nowMs: NOW, includeSlots: true });

  expect(Object.keys(plain)).not.toContain('slots');
  expect(Object.keys(withSlots).at(-1)).toBe('slots');
  const { slots, ...rest } = withSlots;
  expect(rest).toEqual(plain);

  const tagged = tagDaySlots({ date: DATE, forecast, ...params, nowMs: NOW });
  expect(slots).toHaveLength(tagged.length);
  const ok = tagged.filter(slot => slot.status === 'ok');
  expect(ok.length).toBeGreaterThan(0);
  for (const slot of ok) {
    const found = slots.find(s => s.start === new Date(slot.startMs).toISOString());
    expect(found.score).toBe(Math.round(scoreSlot(slot.values) * 10) / 10);
  }
});

test('slot scores follow wind=matters', () => {
  const forecast = parseForecast(amsterdamFixture);
  const params = { avail: ALL_DAY, dark: 'ok', rain: 100, wind: 'matters' };
  const { slots } = computeDay({ date: DATE, forecast, params, nowMs: EARLY, includeSlots: true });
  const tagged = tagDaySlots({ date: DATE, forecast, ...params, nowMs: EARLY });
  const withValues = tagged.filter(slot => slot.values);
  expect(withValues.length).toBeGreaterThan(0);
  for (const slot of withValues) {
    const found = slots.find(s => s.start === new Date(slot.startMs).toISOString());
    expect(found.score).toBe(Math.round(scoreSlot(slot.values, 'matters') * 10) / 10);
  }
});
