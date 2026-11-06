const DEFAULT_AVAILABILITY = '07-09,12-14,17-21';
const DEFAULT_DARK = 'avoid';
const DEFAULT_RAIN = '40';
const DEFAULT_SPORT = 'running';
const DEFAULT_LANGUAGE = 'device';
const WINDOW_URL = 'https://besttimetorun.com/api/window';
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

function textOr(value, fallback) {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

// A coordinate in the lat_lon text, rounded to 2 decimals like the polling URL does; null when not a number
function roundCoordinate(text, limit) {
  const trimmed = text.trim();
  if (!NUMBER_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  if (Math.abs(value) > limit) return null;
  return Math.round(value * 100) / 100 || 0; // `|| 0` turns -0 into 0
}

function readLocation(value) {
  const parts = typeof value === 'string' ? value.split(',') : [];
  const lat = parts.length === 2 ? roundCoordinate(parts[0], 90) : null;
  const lon = parts.length === 2 ? roundCoordinate(parts[1], 180) : null;
  return lat === null || lon === null ? { lat: null, lon: null } : { lat, lon };
}

// Never throws: a missing trmnl, null custom_fields_values or non-string values give the defaults
function readSettings(input) {
  const trmnl = input && typeof input === 'object' ? input.trmnl : null;
  const plugin = trmnl && typeof trmnl === 'object' ? trmnl.plugin_settings : null;
  const fields = plugin && typeof plugin === 'object' ? plugin.custom_fields_values : null;
  const values = fields && typeof fields === 'object' ? fields : {};
  const { lat, lon } = readLocation(values.lat_lon);
  return {
    token: textOr(values.tredict_token, ''),
    lat,
    lon,
    availability: textOr(values.availability, DEFAULT_AVAILABILITY).replace(/ /g, ''),
    dark: textOr(values.dark, DEFAULT_DARK),
    rain: textOr(values.rain, DEFAULT_RAIN),
    sport: textOr(values.sport, DEFAULT_SPORT),
    language: textOr(values.language, DEFAULT_LANGUAGE),
    // Only 'dark' darkens the board; anything else is the light default
    theme: values.theme === 'dark' ? 'dark' : 'light',
    hasLocation: lat !== null && lon !== null
  };
}

// The same URL settings.yml renders for polling; Liquid's url_encode turns spaces into +
function windowUrl(settings) {
  if (!settings || !settings.hasLocation) return null;
  const avail = encodeURIComponent(settings.availability).replace(/%20/g, '+');
  const { lat, lon, dark, rain } = settings;
  return `${WINDOW_URL}?lat=${lat}&lon=${lon}&avail=${avail}&dark=${dark}&rain=${rain}`;
}

module.exports = { readSettings, windowUrl };
