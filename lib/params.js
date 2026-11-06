const DEFAULT_AVAIL = '06-22';
const DEFAULT_DARK = 'avoid';
const DEFAULT_RAIN = 40;
const DEFAULT_LANG = 'en';
const DEFAULT_PREFER = 'balanced';
const PREFERENCES = ['balanced', 'wind', 'rain', 'temp'];

const COORDINATE = /^-?\d{1,3}(\.\d+)?$/;
const CLOCK = /^(\d{2})(?::(\d{2}))?$/;
const RAIN = /^\d{1,3}$/;

// Messages name the parameter only. They must never contain the value: it may be a coordinate.
function invalid(name, expectation) {
  const err = new Error(`Invalid ${name}: ${expectation}`);
  err.statusCode = 400;
  return err;
}

// Express query values are strings, arrays (repeated) or objects (`lat[x]=1`). Only strings are accepted.
// Returns undefined when the parameter is absent or empty.
function readString(query, name) {
  const value = Object.hasOwn(query, name) ? query[name] : undefined;
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw invalid(name, 'must be given once as a plain value');
  return value;
}

// The one definition of a valid coordinate string: plain number format and within +-limit.
function isCoordinate(raw, limit) {
  return typeof raw === 'string' && COORDINATE.test(raw) && Math.abs(Number(raw)) <= limit;
}

function parseCoordinate(query, name, limit) {
  const raw = readString(query, name);
  if (raw === undefined) throw invalid(name, `required, a number from -${limit} to ${limit}`);
  if (!isCoordinate(raw, limit)) throw invalid(name, `must be a number from -${limit} to ${limit}`);
  return Math.round(Number(raw) * 100) / 100 || 0; // `|| 0` turns -0 into 0
}

// 'HH' or 'HH:MM' → minutes since midnight. 24:00 is only valid as an end.
function parseClock(text, isEnd) {
  const match = CLOCK.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (minutes > 59) return null;
  if (hours > 24 || (hours === 24 && (!isEnd || minutes !== 0))) return null;
  return hours * 60 + minutes;
}

function parseAvail(query) {
  const raw = readString(query, 'avail');
  const text = raw === undefined ? DEFAULT_AVAIL : raw;
  const fail = () => invalid('avail', 'must be comma-separated ranges like 07-09,12-14 or 07:30-09:15');
  const avail = text.split(',').map(part => {
    const bounds = part.split('-');
    if (bounds.length !== 2) throw fail();
    const startMin = parseClock(bounds[0], false);
    const endMin = parseClock(bounds[1], true);
    if (startMin === null || endMin === null || endMin <= startMin) throw fail();
    return { startMin, endMin };
  });
  avail.sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < avail.length; i++) {
    if (avail[i].startMin < avail[i - 1].endMin) throw fail(); // touching ranges are fine, overlapping are not
  }
  return { avail, availText: text };
}

function parseChoice(query, name, allowed, fallback) {
  const raw = readString(query, name);
  if (raw === undefined) return fallback;
  if (!allowed.includes(raw)) throw invalid(name, `must be one of ${allowed.join(', ')}`);
  return raw;
}

function parseRain(query) {
  const raw = readString(query, 'rain');
  if (raw === undefined) return DEFAULT_RAIN;
  const value = RAIN.test(raw) ? Number(raw) : NaN;
  if (!(value >= 0 && value <= 100)) throw invalid('rain', 'must be an integer from 0 to 100');
  return value;
}

function parseSlots(query) {
  const raw = readString(query, 'slots');
  if (raw === undefined) return false;
  if (raw !== '1') throw invalid('slots', 'must be 1 or empty');
  return true;
}

function parseWindowQuery(query) {
  const source = query || {};
  const lat = parseCoordinate(source, 'lat', 90);
  const lon = parseCoordinate(source, 'lon', 180);
  const { avail, availText } = parseAvail(source);
  const dark = parseChoice(source, 'dark', ['ok', 'avoid'], DEFAULT_DARK);
  const rain = parseRain(source);
  // `wind` is the older form of `prefer` (2026-11-06, one day live): `matters` means `prefer=wind`. `prefer` wins.
  const legacyWind = parseChoice(source, 'wind', ['normal', 'matters'], 'normal');
  const prefer = parseChoice(source, 'prefer', PREFERENCES, legacyWind === 'matters' ? 'wind' : DEFAULT_PREFER);
  const lang = parseChoice(source, 'lang', ['en', 'nl'], DEFAULT_LANG);
  const slots = parseSlots(source);
  return { lat, lon, avail, availText, dark, rain, prefer, lang, slots };
}

module.exports = { parseWindowQuery, isCoordinate };
