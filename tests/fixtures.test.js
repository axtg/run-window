const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'fixtures', 'open-meteo');
const load = name => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

const VARIABLES = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m'
];

// Past-date precipitation_probability may be null, so values are not asserted for it.
const cases = [
  { file: 'amsterdam-forecast.json', rows: 96, lat: 52.37 },
  { file: 'amsterdam-dst-end.json', rows: 72, lat: 52.37 },
  { file: 'kathmandu-forecast.json', rows: 96, lat: 27.72 }
];

describe.each(cases)('$file', ({ file, rows, lat }) => {
  const data = load(file);

  test(`has ${rows} hourly rows for every requested variable`, () => {
    expect(data.hourly.time).toHaveLength(rows);
    for (const variable of VARIABLES) {
      expect(data.hourly[variable]).toHaveLength(rows);
    }
  });

  test('latitude is near the requested location', () => {
    expect(Math.abs(data.latitude - lat)).toBeLessThan(0.2);
  });
});

describe('amsterdam-dst-end.json', () => {
  const data = load('amsterdam-dst-end.json');

  test('has a utc offset of 3600 seconds', () => {
    expect(data.utc_offset_seconds).toBe(3600);
  });

  test('24 October sunrise is at 06:21Z', () => {
    const first = new Date(data.daily.sunrise[0] * 1000).toISOString();
    expect(first.slice(0, 16)).toBe('2026-10-24T06:21');
  });
});

describe('kathmandu-forecast.json', () => {
  test('first row has minute 15 in UTC', () => {
    const data = load('kathmandu-forecast.json');
    expect(new Date(data.hourly.time[0] * 1000).getUTCMinutes()).toBe(15);
  });
});
