const { fromZonedTime, formatInTimeZone } = require('date-fns-tz');
const { parseForecast, valuesForSlot } = require('../lib/forecast');
const { localDates, buildDaySlots, computeDay, DURATIONS } = require('../lib/windows');
const { makeForecastJson } = require('./helpers/forecast');
const amsterdamFixture = require('./fixtures/open-meteo/amsterdam-forecast.json');
const dstEndFixture = require('./fixtures/open-meteo/amsterdam-dst-end.json');

const HOUR = 3600000;
const SLOT = 900000;
const TZ = 'Europe/Amsterdam';
const DATE = '2026-11-02';
const MIDNIGHT = Date.parse('2026-11-01T23:00:00.000Z'); // local midnight of DATE, CET
const EARLY = Date.parse('2026-11-01T12:00:00.000Z'); // before DATE starts
const local = (time, date = DATE) => fromZonedTime(`${date}T${time}:00`, TZ).getTime();
const iso = ms => new Date(ms).toISOString();
const range = (from, to) => ({ startMin: from * 60, endMin: to * 60 });
const ALL_DAY = [range(0, 24)];
const noSun = [];

function forecast({ hours = 30, startMs = MIDNIGHT, timezone = TZ, sun = noSun, values } = {}) {
  return parseForecast(makeForecastJson({ startMs, hours, timezone, sun, values }));
}

const sunFor = (sunrise, sunset, date = DATE) => [{ sunriseMs: local(sunrise, date), sunsetMs: local(sunset, date) }];
const day = (fc, params, nowMs = EARLY, date = DATE) =>
  computeDay({ date, forecast: fc, params: { avail: ALL_DAY, dark: 'ok', rain: 100, ...params }, nowMs });

test('localDates gives today, tomorrow and the day after in the location timezone', () => {
  expect(localDates(Date.parse('2026-11-02T23:30:00Z'), TZ)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
  expect(localDates(Date.parse('2026-11-02T23:30:00Z'), 'America/New_York')).toEqual([
    '2026-11-02',
    '2026-11-03',
    '2026-11-04'
  ]);
  expect(localDates(Date.parse('2026-12-31T12:00:00Z'), TZ)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
});

test('23-hour day has 92 slots, 25-hour day 100', () => {
  const spring = forecast({ startMs: Date.parse('2027-03-27T23:00:00Z') });
  const slots = buildDaySlots({ date: '2027-03-28', forecast: spring, avail: ALL_DAY, dark: 'ok', nowMs: EARLY });
  expect(slots).toHaveLength(92);

  const autumn = parseForecast(dstEndFixture);
  expect(buildDaySlots({ date: '2026-10-25', forecast: autumn, avail: ALL_DAY, dark: 'ok', nowMs: 0 })).toHaveLength(
    100
  );
});

test('dst-end fixture: first slot is 2026-10-24T22:00Z, last starts 2026-10-25T22:45Z', () => {
  const slots = buildDaySlots({
    date: '2026-10-25',
    forecast: parseForecast(dstEndFixture),
    avail: ALL_DAY,
    dark: 'ok',
    nowMs: 0
  });
  expect(iso(slots[0].startMs)).toBe('2026-10-24T22:00:00.000Z');
  expect(iso(slots[slots.length - 1].startMs)).toBe('2026-10-25T22:45:00.000Z');
});

test('Havana has no midnight on 2027-03-14: 92 slots, all on that local date', () => {
  const fc = forecast({ timezone: 'America/Havana', startMs: Date.parse('2027-03-14T03:00:00Z'), hours: 30 });
  const slots = buildDaySlots({ date: '2027-03-14', forecast: fc, avail: ALL_DAY, dark: 'ok', nowMs: EARLY });
  expect(slots).toHaveLength(92);
  for (const s of slots) {
    expect(formatInTimeZone(s.startMs, 'America/Havana', 'yyyy-MM-dd')).toBe('2027-03-14');
  }
  expect(iso(slots[0].startMs)).toBe('2027-03-14T05:00:00.000Z');
});

test('past slots are excluded, using now rounded up to the quarter', () => {
  const fc = forecast();
  const first = nowMs => buildDaySlots({ date: DATE, forecast: fc, avail: ALL_DAY, dark: 'ok', nowMs })[0].startMs;
  expect(first(local('12:01'))).toBe(local('12:15'));
  expect(first(local('12:15'))).toBe(local('12:15'));
  expect(first(local('12:14') + 59999)).toBe(local('12:15'));
});

test('now does not affect tomorrow', () => {
  const fc = forecast({ hours: 54, startMs: MIDNIGHT });
  const slots = buildDaySlots({
    date: '2026-11-03',
    forecast: fc,
    avail: ALL_DAY,
    dark: 'ok',
    nowMs: local('23:00')
  });
  expect(slots).toHaveLength(96);
});

test('availability edges', () => {
  const fc = forecast();
  const exact = day(fc, { avail: [{ startMin: 720, endMin: 780 }] });
  expect(exact.windows['60']).toMatchObject({ start: iso(local('12:00')), end: iso(local('13:00')) });
  expect(exact.windows['75']).toBeNull();

  const offGrid = day(fc, { avail: [{ startMin: 730, endMin: 780 }] });
  expect(offGrid.windows['15'].start).toBe(iso(local('12:15')));
  expect(offGrid.windows['45'].end).toBe(iso(local('13:00')));
  expect(offGrid.windows['60']).toBeNull();
});

test('windows do not span touching ranges', () => {
  const result = day(forecast(), { avail: [range(7, 9), range(9, 11)] });
  expect(result.windows['180']).toBeNull();
  expect(result.windows['120']).not.toBeNull();
});

test('darkness', () => {
  const fc = forecast({ sun: sunFor('07:37', '17:09') });
  const slotsFor = dark => buildDaySlots({ date: DATE, forecast: fc, avail: ALL_DAY, dark, nowMs: EARLY });

  const avoid = slotsFor('avoid');
  expect(avoid[0].startMs).toBe(local('07:45'));
  expect(avoid[avoid.length - 1].startMs + SLOT).toBe(local('17:00'));
  expect(avoid.every(s => s.inDaylight)).toBe(true);

  const ok = slotsFor('ok');
  expect(ok).toHaveLength(96);
  expect(ok.find(s => s.startMs === local('07:30')).inDaylight).toBe(false);
  expect(ok.find(s => s.startMs === local('07:45')).inDaylight).toBe(true);
  expect(ok.find(s => s.startMs === local('17:00')).inDaylight).toBe(false);
  expect(day(fc, { dark: 'ok', avail: [range(5, 6)] }).windows['60'].inDaylight).toBe(false);
});

test('sunrise and sunset are UTC ISO strings, null when the day has none', () => {
  const withSun = day(forecast({ sun: sunFor('07:37', '17:09') }), {});
  expect(withSun.sunrise).toBe(iso(local('07:37')));
  expect(withSun.sunset).toBe(iso(local('17:09')));
  const without = day(forecast(), {});
  expect(without.sunrise).toBeNull();
  expect(without.sunset).toBeNull();
  expect(day(forecast(), { dark: 'avoid' }).windows['15']).toBeNull();
});

test('rain threshold edge', () => {
  const avail = [range(12, 13)];
  const at = (row, rain) => day(forecast({ values: i => (i === 13 ? row : {}) }), { avail, rain });
  expect(at({ precipitation_probability: 40 }, 40).windows['60']).not.toBeNull();
  expect(at({ precipitation_probability: 41 }, 40).windows['60']).toBeNull();
  expect(at({ precipitation: 0.19 }, 40).windows['60']).not.toBeNull();
  expect(at({ precipitation: 0.2 }, 40).windows['60']).toBeNull();
});

test('rain in the following row blocks the slot', () => {
  const fc = forecast({ values: i => (i === 13 ? { precipitation_probability: 80 } : {}) });
  const result = day(fc, { avail: [range(12, 14)], rain: 40 });
  // 12:00-12:45 read the 13:00 row and are blocked; 13:00-13:45 read the 14:00 row.
  expect(result.windows['15'].start).toBe(iso(local('13:00')));
  expect(result.windows['60'].start).toBe(iso(local('13:00')));
});

// 08-09 and 14-15 are the only hours. The rows 7-10 and 13-16 set the weather each hour reads.
const twoHours = (early, late) =>
  forecast({ values: i => (i >= 7 && i <= 10 ? early : i >= 13 && i <= 16 ? late : {}) });
const avail2 = [range(8, 9), range(14, 15)];
const startOf = (fc, params) => day(fc, { avail: avail2, ...params }).windows['60'].start;

test('prefer=wind takes a calm cold hour over a mild breezy one; balanced and temp do not', () => {
  const fc = twoHours({ apparent_temperature: 2 }, { wind_speed_10m: 14 }); // cold 4 vs wind 2
  expect(startOf(fc, {})).toBe(iso(local('14:00')));
  expect(startOf(fc, { prefer: 'balanced' })).toBe(iso(local('14:00')));
  expect(startOf(fc, { prefer: 'temp' })).toBe(iso(local('14:00')));
  expect(startOf(fc, { prefer: 'wind' })).toBe(iso(local('08:00')));
});

test('prefer=rain takes a breezy dry hour over a calm hour that may rain', () => {
  const fc = twoHours({ precipitation_probability: 30 }, { wind_speed_10m: 14 }); // rain 1.5 vs wind 2
  expect(startOf(fc, {})).toBe(iso(local('08:00')));
  expect(startOf(fc, { prefer: 'rain' })).toBe(iso(local('14:00')));
});

test('prefer=temp takes a cold-free hour over a calm cold one', () => {
  const fc = twoHours({ apparent_temperature: 4.5 }, { wind_speed_10m: 15 }); // cold 1.5 vs wind 3
  expect(startOf(fc, {})).toBe(iso(local('08:00')));
  expect(startOf(fc, { prefer: 'temp' })).toBe(iso(local('14:00')));
});

test('prefer also steers the fallback', () => {
  const wet = forecast({
    values: i => ({
      precipitation_probability: 80,
      precipitation: 1,
      ...(i >= 7 && i <= 10 ? { apparent_temperature: 2 } : i >= 13 && i <= 16 ? { wind_speed_10m: 14 } : {})
    })
  });
  expect(day(wet, { avail: avail2, rain: 40 }).fallback.start).toBe(iso(local('14:00')));
  expect(day(wet, { avail: avail2, rain: 40, prefer: 'wind' }).fallback.start).toBe(iso(local('08:00')));
});

test('fallback only when windows["60"] is null', () => {
  const dryDay = day(forecast(), {});
  expect('fallback' in dryDay).toBe(false);

  const wet = forecast({ values: () => ({ precipitation_probability: 80, precipitation: 1 }) });
  const wetDay = day(wet, { rain: 40 });
  expect(wetDay.windows['60']).toBeNull();
  expect(wetDay.fallback).toMatchObject({ qualifies: false });
  expect(wetDay.date).toBe(DATE);
});

test('fallback never breaks past, availability or darkness', () => {
  const fc = forecast({
    sun: sunFor('07:37', '17:09'),
    values: () => ({ precipitation_probability: 80, precipitation: 1 })
  });
  const result = day(fc, { avail: [range(7, 10)], dark: 'avoid', rain: 40 }, local('08:01'));
  expect(result.fallback).toMatchObject({ qualifies: false });
  expect(Date.parse(result.fallback.start)).toBeGreaterThanOrEqual(local('08:15'));
  expect(Date.parse(result.fallback.end)).toBeLessThanOrEqual(local('10:00'));

  const dark = day(fc, { avail: [range(5, 8)], dark: 'avoid', rain: 40 });
  expect(dark.fallback).toBeNull();
});

test('fallback is null when nothing fits at all', () => {
  const result = day(forecast(), { avail: [range(12, 12.5)] });
  expect(result.windows['60']).toBeNull();
  expect(result.fallback).toBeNull();
});

test('polar night with dark=avoid: all windows null, fallback null, no throw', () => {
  const fc = forecast({ sun: [{ sunriseMs: local('12:00'), sunsetMs: local('12:00') }] });
  const result = day(fc, { dark: 'avoid' });
  expect(DURATIONS.every(d => result.windows[d] === null)).toBe(true);
  expect(result.fallback).toBeNull();
});

test('midnight sun with dark=avoid: full day available', () => {
  const fc = forecast({ sun: [{ sunriseMs: MIDNIGHT, sunsetMs: MIDNIGHT + 24 * HOUR }] });
  const slots = buildDaySlots({ date: DATE, forecast: fc, avail: ALL_DAY, dark: 'avoid', nowMs: EARLY });
  expect(slots).toHaveLength(96);
  expect(day(fc, { dark: 'avoid' }).windows['180']).not.toBeNull();
});

test('null row excludes the slot for both windows and fallback', () => {
  const fc = parseForecast(
    (() => {
      const json = makeForecastJson({ startMs: MIDNIGHT, hours: 30 });
      json.hourly.wind_gusts_10m[13] = null;
      return json;
    })()
  );
  const blocked = day(fc, { avail: [range(12, 13)] });
  expect(blocked.windows['15']).toBeNull();
  expect(blocked.fallback).toBeNull();
  expect(day(fc, { avail: [range(12, 14)] }).windows['60'].start).toBe(iso(local('13:00')));
});

test('all 12 duration keys are present', () => {
  const result = day(forecast(), { avail: [range(12, 13)] });
  expect(Object.keys(result.windows)).toEqual(DURATIONS);
  expect(DURATIONS).toHaveLength(12);
});

describe('anti-goals hold across combinations', () => {
  const fc = parseForecast(amsterdamFixture);
  const availSets = [[range(6, 22)], [range(7, 9), range(12, 14), range(17, 21)]];
  const dayStart = date => fromZonedTime(`${date}T00:00:00`, fc.timezone).getTime();

  test.each([0, 6, 12, 23])('now at %ih', hour => {
    const nowMs = local(`${String(hour).padStart(2, '0')}:00`);
    const nowCeil = Math.ceil(nowMs / SLOT) * SLOT;
    for (const avail of availSets) {
      for (const rain of [0, 40, 100]) {
        for (const dark of ['ok', 'avoid']) {
          for (const date of localDates(nowMs, fc.timezone)) {
            const result = computeDay({ date, forecast: fc, params: { avail, dark, rain }, nowMs });
            const windows = [...Object.values(result.windows), result.fallback].filter(Boolean);
            for (const w of windows) {
              const start = Date.parse(w.start);
              const end = Date.parse(w.end);
              expect(start).toBeGreaterThanOrEqual(nowCeil);
              expect(start).toBeGreaterThanOrEqual(dayStart(date));
              if (dark === 'avoid') {
                expect(start).toBeGreaterThanOrEqual(Date.parse(result.sunrise));
                expect(end).toBeLessThanOrEqual(Date.parse(result.sunset));
              }
              const ranges = new Set();
              for (let t = start; t < end; t += SLOT) {
                const m =
                  Number(formatInTimeZone(t, fc.timezone, 'H')) * 60 + Number(formatInTimeZone(t, fc.timezone, 'm'));
                ranges.add(avail.findIndex(r => r.startMin <= m && m + 15 <= r.endMin));
                if (w.qualifies) {
                  const v = valuesForSlot(fc, t);
                  expect(v.precipProb).toBeLessThanOrEqual(rain);
                  expect(v.precip).toBeLessThan(0.2);
                }
              }
              expect(ranges.size).toBe(1);
              expect(ranges.has(-1)).toBe(false);
            }
          }
        }
      }
    }
  });
});

test('localDates does not depend on the host timezone', () => {
  const { execFileSync } = require('child_process');
  const script = `const { localDates } = require('./lib/windows');
console.log(JSON.stringify(localDates(Date.parse('2026-11-02T09:00:00Z'), 'Europe/Amsterdam')));`;
  for (const tz of ['Pacific/Auckland', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
    const out = execFileSync(process.execPath, ['-e', script], {
      cwd: require('path').join(__dirname, '..'),
      env: { ...process.env, TZ: tz }
    });
    expect(JSON.parse(out)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  }
});

test('prefer breaks a tie between windows that all score 0, balanced keeps the earliest', () => {
  // Every hour scores 0 (wind under 12 km/h, feels-like inside 6-16, dry): 15:00 is the calmest, 11:00 sits in the
  // middle of the temperature band. Rain is 0 % all day, so Rain has nothing to break the tie with.
  const fc = forecast({
    values: i => {
      if (i === 15) return { wind_speed_10m: 3, apparent_temperature: 8 };
      if (i === 11) return { wind_speed_10m: 9, apparent_temperature: 11 };
      return { wind_speed_10m: 9, apparent_temperature: 8 };
    }
  });
  const avail = [range(9, 17)];
  const pick = prefer => day(fc, { avail, prefer }).windows['60'];
  expect(pick('balanced').start).toBe(iso(local('09:00')));
  expect(pick('wind').start).toBe(iso(local('15:00')));
  expect(pick('wind').score).toBe(0);
  expect(pick('temp').start).toBe(iso(local('11:00')));
  expect(pick('rain').start).toBe(iso(local('09:00')));
});
