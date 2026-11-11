const HOUR_MS = 3600000;

// Hourly variables read from the row at the start of the slot's hour (instant values).
const INSTANT = {
  temp: 'temperature_2m',
  apparentTemp: 'apparent_temperature',
  windSpeed: 'wind_speed_10m',
  windFrom: 'wind_direction_10m'
};
// Hourly variables read from the following row (valid for the preceding hour).
const PRECEDING = { gust: 'wind_gusts_10m', precipProb: 'precipitation_probability', precip: 'precipitation' };

const VARIABLES = ['temperature_2m', ...Object.values(INSTANT), ...Object.values(PRECEDING)].filter(
  (name, i, all) => all.indexOf(name) === i
);

function invalid(reason) {
  return new Error(`Invalid forecast: ${reason}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateTimezone(timezone) {
  if (typeof timezone !== 'string' || timezone === '') throw invalid('missing timezone');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw invalid('unknown timezone');
  }
}

function unixSeconds(value, what) {
  if (!Number.isFinite(value)) throw invalid(`${what} is not a unix timestamp`);
  return value * 1000;
}

// Rows, sunrise and sunset are UTC instants (timeformat=unixtime). Nothing here depends on array position
// beyond pairing each timestamp with its own values.
function parseForecast(json) {
  if (!isObject(json) || json.error) throw invalid('unexpected response');
  validateTimezone(json.timezone);

  const { hourly, daily } = json;
  if (!isObject(hourly) || !Array.isArray(hourly.time) || hourly.time.length === 0) throw invalid('no hourly rows');
  for (const name of VARIABLES) {
    if (!Array.isArray(hourly[name]) || hourly[name].length !== hourly.time.length) {
      throw invalid(`hourly ${name} does not match the time axis`);
    }
  }

  const rows = new Map();
  hourly.time.forEach((seconds, i) => {
    const row = {};
    for (const name of VARIABLES) row[name] = hourly[name][i];
    rows.set(unixSeconds(seconds, 'hourly time'), row);
  });
  if (rows.size !== hourly.time.length) throw invalid('duplicate hourly times');

  if (!isObject(daily) || !Array.isArray(daily.sunrise) || !Array.isArray(daily.sunset))
    throw invalid('no daily sun times');
  if (daily.sunrise.length !== daily.sunset.length) throw invalid('daily sun times do not match');
  const sun = daily.sunrise.map((sunrise, i) => ({
    sunriseMs: unixSeconds(sunrise, 'sunrise'),
    sunsetMs: unixSeconds(daily.sunset[i], 'sunset')
  }));

  return { timezone: json.timezone, anchorMs: hourly.time[0] * 1000, rows, sun };
}

// Hour boundaries follow the first row, so grids at +5:45 or +5:30 work. Returns null when a needed row or value
// is missing.
function valuesForSlot(forecast, slotStartMs) {
  const offset = (((slotStartMs - forecast.anchorMs) % HOUR_MS) + HOUR_MS) % HOUR_MS;
  const hourMs = slotStartMs - offset;
  const current = forecast.rows.get(hourMs);
  const next = forecast.rows.get(hourMs + HOUR_MS);
  if (!current || !next) return null;

  const values = {};
  for (const [key, name] of Object.entries(INSTANT)) values[key] = current[name];
  for (const [key, name] of Object.entries(PRECEDING)) values[key] = next[name];
  return Object.values(values).some(value => value === null || value === undefined) ? null : values;
}

module.exports = { parseForecast, valuesForSlot };
