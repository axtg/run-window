const { STRINGS, fill } = require('./strings');
const { addDays } = require('./time');

// Tredict's model: exponentially decaying sums, performance = 1.66 · fitness − 2 · fatigue
const FORM_CONSTANTS = { fitnessDays: 14, fatigueDays: 9, fitnessWeight: 1.66, fatigueWeight: 2 };
const DEFAULT_BACK_DAYS = 42;
const DEFAULT_AHEAD_DAYS = 7;
// The endpoint covers a year; older keys add nothing visible but loop time
const MAX_WARMUP_DAYS = 730;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const CHART_WIDTH = 360;
const CHART_HEIGHT = 150;
const CHART_PADDING = 6;
const EFFORT_KEY = /^(\d{4})(\d{2})(\d{2})$/;
const SVG_PATH = /^[ML0-9. -]*$/;
const MINUS = '−';

const effortKey = date => date.replace(/-/g, '');

// Confirmed efforts for past days; all entries for today and later (a done plan's unconfirmed entry is already gone)
function dayLoad(entries, countUnconfirmed) {
  if (!Array.isArray(entries)) return 0;
  let load = 0;
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    const value = Number(entry[0]);
    const unconfirmed = Boolean(entry[1] && typeof entry[1] === 'object' && entry[1].unconfirmed);
    if (entry[0] === null || !Number.isFinite(value) || (unconfirmed && !countUnconfirmed)) continue;
    load += value;
  }
  return load;
}

// Fitness and fatigue from 0 on the first day with data; the value is Tredict's performance after that day's load
function formSeries({
  efforts,
  today,
  back = DEFAULT_BACK_DAYS,
  ahead = DEFAULT_AHEAD_DAYS,
  constants = FORM_CONSTANTS
}) {
  const source = efforts && typeof efforts === 'object' ? efforts : {};
  const keys = Object.keys(source)
    .filter(key => EFFORT_KEY.test(key))
    .sort();
  if (keys.length === 0 || !DATE_TEXT.test(String(today))) return { points: [], today: null };

  const start = addDays(today, -back);
  const earliest = keys[0].replace(EFFORT_KEY, '$1-$2-$3');
  const oldest = addDays(start, -MAX_WARMUP_DAYS);
  const first = earliest < oldest ? oldest : earliest;
  const end = addDays(today, ahead);
  const fitnessDecay = Math.exp(-1 / constants.fitnessDays);
  const fatigueDecay = Math.exp(-1 / constants.fatigueDays);
  const forms = new Map();
  let fitness = 0;
  let fatigue = 0;
  for (let date = first; date <= end; date = addDays(date, 1)) {
    const load = dayLoad(source[effortKey(date)], date >= today);
    fitness = fitness * fitnessDecay + load;
    fatigue = fatigue * fatigueDecay + load;
    if (date >= start) forms.set(date, constants.fitnessWeight * fitness - constants.fatigueWeight * fatigue);
  }

  const points = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    points.push({ date, form: forms.get(date) ?? 0, planned: date > today });
  }
  const todayPoint = points.find(point => point.date === today);
  return { points, today: todayPoint ? todayPoint.form : null };
}

const coordinate = value => {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
};

const safePath = path => (SVG_PATH.test(path) ? path : '');
const safeNumber = value => (Number.isFinite(value) ? value : 0);

function roundedForm(value) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value) || 0;
  return rounded < 0 ? `${MINUS}${-rounded}` : String(rounded);
}

function chartPath(coordinates) {
  if (coordinates.length === 0) return '';
  return coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${coordinate(x)} ${coordinate(y)}`).join(' ');
}

function formLabels(back, ahead, text) {
  return {
    back: fill(back % 7 === 0 ? text.formWeeksBack : text.formDaysBack, { n: back % 7 === 0 ? back / 7 : back }),
    today: text.formToday,
    ahead: fill(text.formDaysAhead, { n: ahead })
  };
}

function formChart(series, lang) {
  const text = STRINGS[STRINGS[lang] ? lang : 'en'];
  const points = series && Array.isArray(series.points) ? series.points : [];
  if (points.length === 0) {
    return {
      heading: text.formLabel,
      today: '',
      pastPath: '',
      futurePath: '',
      zeroY: CHART_HEIGHT / 2,
      todayX: 0,
      labels: formLabels(DEFAULT_BACK_DAYS, DEFAULT_AHEAD_DAYS, text),
      empty: text.noTrainingData
    };
  }

  const values = points.map(point => (Number.isFinite(point.form) ? point.form : 0));
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const span = high - low || 1;
  const step = points.length > 1 ? CHART_WIDTH / (points.length - 1) : 0;
  const yOf = value => CHART_PADDING + ((high - value) / span) * (CHART_HEIGHT - 2 * CHART_PADDING);
  const coordinates = values.map((value, index) => [index * step, yOf(value)]);

  // Today is the last point that is not planned
  const firstPlanned = points.findIndex(point => point.planned);
  const todayIndex = firstPlanned === -1 ? points.length - 1 : Math.max(firstPlanned - 1, 0);
  const past = coordinates.slice(0, todayIndex + 1);
  const future = coordinates.slice(todayIndex);

  return {
    heading: text.formLabel,
    today: roundedForm(series.today),
    pastPath: safePath(chartPath(past)),
    futurePath: future.length > 1 ? safePath(chartPath(future)) : '',
    zeroY: safeNumber(Number(coordinate(yOf(0)))),
    todayX: safeNumber(Number(coordinate(coordinates[todayIndex][0]))),
    labels: formLabels(todayIndex, points.length - 1 - todayIndex, text),
    empty: ''
  };
}

module.exports = { FORM_CONSTANTS, formSeries, formChart };
