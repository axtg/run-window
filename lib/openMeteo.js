const { fetchText } = require('../utils/httpClient');
const { parseForecast } = require('./forecast');

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10000;
const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'weather_code',
  'cloud_cover'
];

const round2 = value => Math.round(value * 100) / 100 + 0;

// One call for the key's rounded coordinates. Errors may mention the HTTP status but never the response body,
// the URL or the coordinates.
async function fetchForecast(lat, lon) {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    latitude: round2(lat),
    longitude: round2(lon),
    hourly: HOURLY.join(','),
    daily: 'sunrise,sunset',
    timezone: 'auto',
    forecast_days: 4,
    wind_speed_unit: 'kmh',
    timeformat: 'unixtime'
  }).toString();

  const { status, body } = await fetchText(url.toString(), { timeoutMs: TIMEOUT_MS });
  if (status !== 200) throw new Error(`Open-Meteo responded with status ${status}`);

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('Open-Meteo returned invalid JSON');
  }
  return parseForecast(json);
}

module.exports = { fetchForecast };
