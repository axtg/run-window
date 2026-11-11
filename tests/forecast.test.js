const fs = require('fs');
const path = require('path');
const { parseForecast, valuesForSlot } = require('../lib/forecast');
const { makeForecastJson } = require('./helpers/forecast');

const MIN = 60000;
const HOUR = 60 * MIN;
const load = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'open-meteo', name), 'utf8'));
const kathmanduFixture = load('kathmandu-forecast.json');
const amsterdamFixture = load('amsterdam-forecast.json');
const dstFixture = load('amsterdam-dst-end.json');

const DAY_START = Date.UTC(2026, 10, 2, 0, 0);
const at = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return DAY_START + h * HOUR + m * MIN;
};

// Rows at 12:00Z and 13:00Z. Only 13:00 has rain and gusts; only 12:00 has temp 9 and wind 20.
const rainJson = (overrides = {}) =>
  makeForecastJson({
    startMs: at('11:00'),
    hours: 4,
    values: i =>
      i === 1
        ? { apparent_temperature: 9, wind_speed_10m: 20, wind_direction_10m: 270, ...overrides.noon }
        : i === 2
          ? { precipitation: 1, precipitation_probability: 80, wind_gusts_10m: 50, ...overrides.next }
          : {}
  });

describe('valuesForSlot', () => {
  const f = parseForecast(rainJson());

  test('rain and gusts read the next row, instant values the current row', () => {
    expect(valuesForSlot(f, at('12:15'))).toEqual({
      temp: 10,
      apparentTemp: 9,
      windSpeed: 20,
      windFrom: 270,
      gust: 50,
      precipProb: 80,
      precip: 1,
      code: null, // not in this forecast: optional
      cloud: null
    });
  });

  test('13:15 slot does not see the rain in the 13:00 row', () => {
    expect(valuesForSlot(f, at('13:15')).precip).toBe(0);
  });

  test('slot on the hour reads the same rows as the rest of that hour', () => {
    expect(valuesForSlot(f, at('12:00'))).toEqual(valuesForSlot(f, at('12:45')));
  });

  test('works with the Kathmandu grid at +5:45', () => {
    const k = parseForecast(kathmanduFixture);
    const start = kathmanduFixture.hourly.time[12] * 1000;
    expect(valuesForSlot(k, start + 15 * MIN)).not.toBeNull();
    expect(valuesForSlot(k, start + 15 * MIN).precip).toBe(kathmanduFixture.hourly.precipitation[13]);
  });

  test.each([
    ['precipitation', 'next'],
    ['precipitation_probability', 'next'],
    ['wind_gusts_10m', 'next'],
    ['wind_speed_10m', 'noon'],
    ['apparent_temperature', 'noon'],
    ['wind_direction_10m', 'noon']
  ])('null %s gives null', (variable, row) => {
    const g = parseForecast(rainJson({ [row]: { [variable]: null } }));
    expect(valuesForSlot(g, at('12:15'))).toBeNull();
  });

  test('no next row, as at the end of the forecast, gives null', () => {
    expect(valuesForSlot(f, at('14:30'))).toBeNull();
  });

  test('a slot before the first row gives null', () => {
    expect(valuesForSlot(f, at('10:45'))).toBeNull();
  });

  test('a slot in a gap between rows gives null', () => {
    const json = rainJson();
    json.hourly.time.splice(1, 1);
    for (const key of Object.keys(json.hourly)) if (key !== 'time') json.hourly[key].splice(1, 1);
    expect(valuesForSlot(parseForecast(json), at('12:15'))).toBeNull();
  });
});

describe('parseForecast', () => {
  test('exposes timezone, anchor, rows and sun as UTC instants', () => {
    const f = parseForecast(amsterdamFixture);
    expect(f.timezone).toBe('Europe/Amsterdam');
    expect(f.anchorMs).toBe(amsterdamFixture.hourly.time[0] * 1000);
    expect(f.rows.size).toBe(96);
    expect(f.sun).toHaveLength(4);
    expect(f.sun[0]).toEqual({
      sunriseMs: amsterdamFixture.daily.sunrise[0] * 1000,
      sunsetMs: amsterdamFixture.daily.sunset[0] * 1000
    });
  });

  test('parses the DST-end fixture', () => {
    expect(parseForecast(dstFixture).rows.size).toBe(72);
  });

  const validHourly = makeForecastJson({ startMs: at('00:00'), hours: 2 }).hourly;
  test.each([
    {},
    { error: true, reason: 'x' },
    { hourly: {} },
    { timezone: 'Not/AZone', hourly: validHourly },
    { timezone: 'Europe/Amsterdam', hourly: { ...validHourly, time: [] } },
    { timezone: 'Europe/Amsterdam', hourly: { ...validHourly, precipitation: [0] } },
    { timezone: 'Europe/Amsterdam', hourly: { ...validHourly, time: ['2026-11-02T00:00', '2026-11-02T01:00'] } },
    { timezone: 'Europe/Amsterdam', hourly: { ...validHourly, wind_speed_10m: undefined } }
  ])('rejects %j', json => {
    expect(() => parseForecast(json)).toThrow();
  });

  test('rejects null', () => {
    expect(() => parseForecast(null)).toThrow();
  });

  test('error messages carry no coordinates or URLs', () => {
    const json = { latitude: 52.3731, longitude: 4.8922, timezone: 'Not/AZone', hourly: validHourly };
    expect(() => parseForecast(json)).toThrow(/^(?!.*(52\.37|4\.89|https?:)).*$/s);
  });

  test('accepts Etc/GMT+2', () => {
    const json = makeForecastJson({ startMs: at('00:00'), hours: 3, timezone: 'Etc/GMT+2' });
    expect(parseForecast(json).timezone).toBe('Etc/GMT+2');
  });

  test('rejects missing daily sun times', () => {
    const json = makeForecastJson({ startMs: at('00:00'), hours: 3 });
    delete json.daily;
    expect(() => parseForecast(json)).toThrow();
  });
});

describe('the optional backdrop fields', () => {
  test('weather_code and cloud_cover come from the current row when the forecast has them', () => {
    const json = rainJson();
    json.hourly.weather_code = json.hourly.time.map(t => (t * 1000 === at('12:00') ? 61 : 3));
    json.hourly.cloud_cover = json.hourly.time.map(() => 88);
    const values = valuesForSlot(parseForecast(json), at('12:15'));
    expect(values).toMatchObject({ code: 61, cloud: 88 });
  });

  test('a mismatched optional array is left out, never failing the forecast', () => {
    const json = rainJson();
    json.hourly.weather_code = [1, 2];
    expect(valuesForSlot(parseForecast(json), at('12:15')).code).toBeNull();
  });
});
