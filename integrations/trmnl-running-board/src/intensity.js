const { STRINGS, fill } = require('./strings');

const INTENSITY_PER_RUN = 3;
const DETAIL_MIN_MS = 1000;
const MAX_ID_LENGTH = 64;
const BAR_WIDTH = 360;
const MIN_SEGMENT_WIDTH = 4;
const KINDS = ['low', 'moderate', 'high'];
const LABEL_KEYS = { low: 'intensityLow', moderate: 'intensityModerate', high: 'intensityHigh' };

const isSeconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function readIntensityCache(value) {
  const map = new Map();
  if (!Array.isArray(value)) return map;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 4) continue;
    const [id, low, moderate, high] = entry;
    if (typeof id !== 'string' || id === '' || id.length > MAX_ID_LENGTH) continue;
    if (![low, moderate, high].every(isSeconds)) continue;
    map.set(id, [low, moderate, high]);
  }
  return map;
}

function cacheList(map, ids) {
  return ids.filter(id => map.has(id)).map(id => [id, ...map.get(id)]);
}

function intensityOf(data) {
  const heartrate =
    data && data.summary && data.summary.intensityDistribution ? data.summary.intensityDistribution.heartrate : null;
  if (!heartrate) return [0, 0, 0];
  return ['0', '1', '2'].map(key => (isSeconds(heartrate[key]) ? heartrate[key] : 0));
}

function formatTotal(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

// Whole percentages summing to 100: floor each, give the leftover to the largest remainders (ties: low first).
function percentages(seconds, total) {
  const exact = seconds.map(value => (value / total) * 100);
  const result = exact.map(Math.floor);
  const order = exact
    .map((value, index) => index)
    .sort((a, b) => exact[b] - result[b] - (exact[a] - result[a]) || a - b);
  let left = 100 - result.reduce((sum, value) => sum + value, 0);
  for (const index of order) {
    if (left <= 0) break;
    result[index] += 1;
    left -= 1;
  }
  return result;
}

function widths(seconds, total) {
  const result = seconds.map(value =>
    value > 0 ? Math.max(MIN_SEGMENT_WIDTH, Math.round((value / total) * BAR_WIDTH)) : 0
  );
  const largest = seconds.indexOf(Math.max(...seconds));
  result[largest] += BAR_WIDTH - result.reduce((sum, value) => sum + value, 0);
  return result;
}

function intensityView(entries, lang) {
  const seconds = [0, 1, 2].map(level => entries.reduce((sum, entry) => sum + entry[level], 0));
  const total = seconds.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const text = STRINGS[lang] || STRINGS.en;
  const barWidths = widths(seconds, total);
  const segments = [];
  let x = 0;
  KINDS.forEach((kind, index) => {
    if (seconds[index] <= 0) return;
    segments.push({ kind, x, width: barWidths[index] });
    x += barWidths[index];
  });
  const shares = percentages(seconds, total);
  return {
    heading: fill(text.intensityHeading, { time: formatTotal(total) }),
    segments,
    labels: KINDS.map((kind, index) => `${text[LABEL_KEYS[kind]]} ${shares[index]}%`)
  };
}

module.exports = { INTENSITY_PER_RUN, DETAIL_MIN_MS, readIntensityCache, cacheList, intensityOf, intensityView };
