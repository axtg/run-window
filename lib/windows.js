const { formatInTimeZone, fromZonedTime } = require('date-fns-tz');
const { valuesForSlot } = require('./forecast');

const SLOT_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PRECIP_LIMIT = 0.2; // mm per hour; a slot at or above this is wet regardless of probability
const EPSILON = 1e-9;

// Scoring constants (design calls, tunable). Lower scores are better.
const SCORING = {
  wind: { comfortableSpeed: 12, speedWeight: 1.0, comfortableGust: 30, gustWeight: 0.5 },
  temperature: { min: 6, max: 16, weight: 1.0 },
  rain: { probDivisor: 20 },
  fallbackRain: { probDivisor: 2, precipWeight: 20 }
};

const DURATIONS = Array.from({ length: 12 }, (_, i) => String((i + 1) * 15));
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function windAndTempScore({ windSpeed, gust, apparentTemp }) {
  const { wind, temperature } = SCORING;
  const windScore =
    Math.max(0, windSpeed - wind.comfortableSpeed) * wind.speedWeight +
    Math.max(0, gust - wind.comfortableGust) * wind.gustWeight;
  const tempDistance = Math.max(0, temperature.min - apparentTemp, apparentTemp - temperature.max);
  return windScore + tempDistance * temperature.weight;
}

function scoreSlot(values) {
  return windAndTempScore(values) + values.precipProb / SCORING.rain.probDivisor;
}

function fallbackScoreSlot(values) {
  const { probDivisor, precipWeight } = SCORING.fallbackRain;
  return windAndTempScore(values) + values.precipProb / probDivisor + values.precip * precipWeight;
}

function cardinal(degrees) {
  const normalised = ((degrees % 360) + 360) % 360;
  return CARDINALS[Math.floor((normalised + 22.5) / 45) % 8];
}

const round = (value, decimals = 0) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const mean = numbers => numbers.reduce((sum, n) => sum + n, 0) / numbers.length;

// Vector mean of directions, so 350 and 10 average to 0 rather than 180.
function meanDirection(degrees) {
  const radians = degrees.map(d => (d * Math.PI) / 180);
  const x = mean(radians.map(Math.cos));
  const y = mean(radians.map(Math.sin));
  const result = round((Math.atan2(y, x) * 180) / Math.PI);
  return ((result % 360) + 360) % 360;
}

function summarise(run, score, qualifies) {
  const values = run.map(slot => slot.values);
  const windFrom = meanDirection(values.map(x => x.windFrom));
  return {
    start: new Date(run[0].startMs).toISOString(),
    end: new Date(run[run.length - 1].startMs + SLOT_MS).toISOString(),
    score: round(score, 1),
    qualifies,
    precipProbMax: round(Math.max(...values.map(x => x.precipProb))),
    precipSum: round(
      values.reduce((sum, x) => sum + x.precip / 4, 0),
      1
    ),
    windAvg: round(mean(values.map(x => x.windSpeed))),
    gustMax: round(Math.max(...values.map(x => x.gust))),
    windFrom,
    windFromCardinal: cardinal(windFrom),
    apparentTempAvg: round(mean(values.map(x => x.apparentTemp)), 1),
    inDaylight: run.every(slot => slot.inDaylight)
  };
}

// Slots must be sorted by start. A run is consecutive 15-minute starts within one availability range.
function pickWindow(slots, durationSlots, { scoreFn = scoreSlot, qualifies = true } = {}) {
  const scores = slots.map(slot => scoreFn(slot.values));
  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i + durationSlots <= slots.length; i++) {
    let contiguous = true;
    for (let j = 1; j < durationSlots; j++) {
      const prev = slots[i + j - 1];
      const slot = slots[i + j];
      if (slot.startMs - prev.startMs !== SLOT_MS || slot.rangeIndex !== prev.rangeIndex) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) continue;

    const score = mean(scores.slice(i, i + durationSlots));
    if (score < bestScore - EPSILON) {
      best = i;
      bestScore = score;
    }
  }

  if (best === null) return null;
  return summarise(slots.slice(best, best + durationSlots), bestScore, qualifies);
}

const addDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Today and tomorrow in the location's timezone, as yyyy-MM-dd.
function localDates(nowMs, timezone) {
  const today = formatInTimeZone(nowMs, timezone, 'yyyy-MM-dd');
  return [today, addDate(today, 1)];
}

// The day's sun times as instants, or null when no daily entry has its sunrise on this local date.
function sunForDate(forecast, date) {
  return forecast.sun.find(s => formatInTimeZone(s.sunriseMs, forecast.timezone, 'yyyy-MM-dd') === date) || null;
}

const isDry = (values, rain) => values.precipProb <= rain && values.precip < PRECIP_LIMIT;

// Every 15-minute slot of the local date that fits inside an availability range, each with a status: the first of
// past, dark (only with dark=avoid), missing (no forecast values), rain, else ok.
// Walks UTC quarters around the local day, so 23-hour, 25-hour and midnight-less days need no special case.
function tagDaySlots({ date, forecast, avail, dark, rain, nowMs }) {
  const { timezone } = forecast;
  const from = fromZonedTime(`${date}T00:00:00`, timezone).getTime() - HOUR_MS;
  const to = fromZonedTime(`${addDate(date, 1)}T00:00:00`, timezone).getTime() + HOUR_MS;
  const earliest = Math.ceil(nowMs / SLOT_MS) * SLOT_MS;
  const sun = sunForDate(forecast, date);
  const slots = [];

  for (let startMs = Math.floor(from / SLOT_MS) * SLOT_MS; startMs < to; startMs += SLOT_MS) {
    const [slotDate, hours, minutes] = formatInTimeZone(startMs, timezone, 'yyyy-MM-dd H m').split(/[ ]/);
    if (slotDate !== date) continue;

    const minuteOfDay = Number(hours) * 60 + Number(minutes);
    const rangeIndex = avail.findIndex(r => r.startMin <= minuteOfDay && minuteOfDay + 15 <= r.endMin);
    if (rangeIndex === -1) continue;

    const inDaylight = sun !== null && startMs >= sun.sunriseMs && startMs + SLOT_MS <= sun.sunsetMs;
    const values = valuesForSlot(forecast, startMs);

    let status = 'ok';
    if (startMs < earliest) status = 'past';
    else if (dark === 'avoid' && !inDaylight) status = 'dark';
    else if (values === null) status = 'missing';
    else if (!isDry(values, rain)) status = 'rain';

    slots.push({ startMs, rangeIndex, values, inDaylight, status });
  }
  return slots;
}

// Slots that can be run in, wet ones included: not past, dark or missing.
const usableSlots = tagged =>
  tagged
    .filter(slot => slot.status === 'ok' || slot.status === 'rain')
    .map(({ startMs, rangeIndex, values, inDaylight }) => ({ startMs, rangeIndex, values, inDaylight }));

// Usable slots of the day, minus every exclusion except rain.
function buildDaySlots({ date, forecast, avail, dark, nowMs }) {
  return usableSlots(tagDaySlots({ date, forecast, avail, dark, rain: 0, nowMs }));
}

function serializeSlot({ startMs, status, values, inDaylight }) {
  return {
    start: new Date(startMs).toISOString(),
    status,
    score: values ? round(scoreSlot(values), 1) : null,
    apparentTemp: values ? round(values.apparentTemp, 1) : null,
    windSpeed: values ? round(values.windSpeed) : null,
    gust: values ? round(values.gust) : null,
    windFrom: values ? round(values.windFrom) : null,
    precipProb: values ? round(values.precipProb) : null,
    precip: values ? round(values.precip, 1) : null,
    inDaylight
  };
}

function computeDay({ date, forecast, params, nowMs, includeSlots = false }) {
  const { avail, dark, rain } = params;
  const tagged = tagDaySlots({ date, forecast, avail, dark, rain, nowMs });
  const slots = usableSlots(tagged);
  const dry = slots.filter(slot => isDry(slot.values, rain));
  const sun = sunForDate(forecast, date);

  const windows = {};
  for (const duration of DURATIONS) windows[duration] = pickWindow(dry, Number(duration) / 15);

  const result = {
    date,
    sunrise: sun ? new Date(sun.sunriseMs).toISOString() : null,
    sunset: sun ? new Date(sun.sunsetMs).toISOString() : null,
    windows
  };
  if (windows['60'] === null) {
    result.fallback = pickWindow(slots, 4, { scoreFn: fallbackScoreSlot, qualifies: false });
  }
  if (includeSlots) result.slots = tagged.map(serializeSlot);
  return result;
}

module.exports = {
  SCORING,
  DURATIONS,
  scoreSlot,
  fallbackScoreSlot,
  pickWindow,
  cardinal,
  localDates,
  tagDaySlots,
  serializeSlot,
  buildDaySlots,
  computeDay
};
