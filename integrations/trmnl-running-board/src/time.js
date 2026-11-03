const FALLBACK_ZONE = 'UTC';
// The API's clock: two-digit hours, optional minutes (lib/params.js)
const CLOCK_TEXT = /^(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86400000;

// Intl in TRMNL has English data only: always en-US, parts, never a locale string
function zonedParts(ms, timeZone) {
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  };
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || FALLBACK_ZONE });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: FALLBACK_ZONE });
  }
  const parts = {};
  for (const part of formatter.formatToParts(new Date(ms))) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

const pad = value => String(value).padStart(2, '0');

function localDate(ms, timeZone) {
  const { year, month, day } = zonedParts(ms, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function localTime(ms, timeZone) {
  const { hour, minute } = zonedParts(ms, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

function dateToUtcMs(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(date, days) {
  return new Date(dateToUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

// Monday is 0
function dayOfWeek(date) {
  return (new Date(dateToUtcMs(date)).getUTCDay() + 6) % 7;
}

function weekDates(date) {
  const monday = addDays(date, -dayOfWeek(date));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

// The week number of the Thursday of this date's week, counted in that Thursday's year
function isoWeek(date) {
  const thursday = addDays(date, 3 - dayOfWeek(date));
  const firstOfYear = `${thursday.slice(0, 4)}-01-01`;
  const days = Math.round((dateToUtcMs(thursday) - dateToUtcMs(firstOfYear)) / DAY_MS);
  return Math.floor(days / 7) + 1;
}

// The instant at which the wall clock in the zone shows `date` and `hour` (24 is the next midnight). Two passes
// correct for a UTC offset that differs at the guess and at the result (DST change in between).
function zonedWall(date, hour, timeZone) {
  const wall = dateToUtcMs(date) + hour * 3600000;
  const offsetAt = ms => {
    const p = zonedParts(ms, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

function zonedMidnight(date, timeZone) {
  return zonedWall(date, 0, timeZone);
}

// 'HH' or 'HH:MM' as minutes since midnight, as the API reads it; 24:00 only as an end. null when invalid.
function clockMinutes(text, isEnd) {
  const match = CLOCK_TEXT.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && (!isEnd || minutes !== 0))) return null;
  return hours * 60 + minutes;
}

// Ranges in minutes, sorted, exactly as the API accepts them; null for anything it answers 400 to
function availabilityRanges(avail) {
  const ranges = [];
  const pieces = String(avail ?? '')
    .replace(/ /g, '')
    .split(',');
  for (const piece of pieces) {
    const bounds = piece.split('-');
    if (bounds.length !== 2) return null;
    const start = clockMinutes(bounds[0], false);
    const end = clockMinutes(bounds[1], true);
    if (start === null || end === null || end <= start) return null;
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) return null;
  }
  return ranges;
}

// End of the latest range that local day; 24:00 is the next midnight. Hours the API rejects: the end of the day.
function availabilityEnd(avail, date, timeZone) {
  const ranges = availabilityRanges(avail);
  const latest = ranges ? Math.max(...ranges.map(range => range.end)) : 24 * 60;
  return zonedWall(date, latest / 60, timeZone);
}

module.exports = {
  localDate,
  localTime,
  addDays,
  weekDates,
  isoWeek,
  dayOfWeek,
  zonedMidnight,
  availabilityEnd
};
