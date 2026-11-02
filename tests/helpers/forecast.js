const HOUR = 3600000;

const DEFAULT_ROW = {
  temperature_2m: 10,
  apparent_temperature: 10,
  precipitation_probability: 0,
  precipitation: 0,
  wind_speed_10m: 0,
  wind_gusts_10m: 0,
  wind_direction_10m: 0
};

// Builds Open-Meteo JSON in the timeformat=unixtime shape. `sun` is [{ sunriseMs, sunsetMs }].
// `values(i)` returns a partial row (Open-Meteo variable names) that overrides the dry, calm, 10 degree defaults.
function makeForecastJson({ startMs, hours = 24, timezone = 'Europe/Amsterdam', sun = [], values = () => ({}) }) {
  const hourly = { time: [] };
  for (const key of Object.keys(DEFAULT_ROW)) hourly[key] = [];
  for (let i = 0; i < hours; i++) {
    const row = { ...DEFAULT_ROW, ...values(i) };
    hourly.time.push((startMs + i * HOUR) / 1000);
    for (const key of Object.keys(DEFAULT_ROW)) hourly[key].push(row[key]);
  }
  return {
    timezone,
    hourly,
    daily: {
      time: sun.map((_, i) => (startMs + i * 24 * HOUR) / 1000),
      sunrise: sun.map(s => s.sunriseMs / 1000),
      sunset: sun.map(s => s.sunsetMs / 1000)
    }
  };
}

module.exports = { makeForecastJson };
