const { STRINGS, resolveLanguage, fill } = require('./strings');
const { localDate, localTime, dayOfWeek } = require('./time');
const { readSettings, windowUrl } = require('./settings');
const { tredictRange, tredictUrls, fetchJson } = require('./tredict');
const { isZone, buildWeek, weekView } = require('./week');
const { formSeries, formChart } = require('./form');
const { pickSession, windowPanel } = require('./runWindow');

const BOARD_VERSION = 1;
const REQUEST_TIMEOUT_MS = 3000;
const RETRY_PAUSE_MS = 30 * 60000;
const ATTRIBUTION_SEPARATOR = ' · ';
const WINDOW_KINDS = ['window', 'shorter', 'fallback'];
const ITEM_KINDS = ['done', 'planned', 'missed', 'unplanned'];
const REUSED_PATH = /^[ML0-9. -]*$/;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const textOf = value => (typeof value === 'string' ? value : '');
const finiteOf = value => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

// The fixed output for anything unexpected: no input-derived text, never an error's text
function errorBoard(now) {
  const at = Number.isFinite(now) ? now : Date.now();
  let fetchedAtText;
  try {
    fetchedAtText = dayAndTime(at, 'UTC', STRINGS.en);
  } catch {
    fetchedAtText = '';
  }
  return {
    v: BOARD_VERSION,
    lang: 'en',
    fetchedAt: new Date(at).toISOString(),
    fetchedAtText,
    tredict: { state: 'unavailable', message: STRINGS.en.tredictUnavailable },
    tredictAt: null,
    tredictAtText: '',
    week: null,
    form: null,
    run: { kind: 'error', heading: STRINGS.en.weatherUnavailable, lines: [] },
    weatherRetryAt: null,
    attribution: ''
  };
}

function dayAndTime(ms, tz, text) {
  return `${text.days[dayOfWeek(localDate(ms, tz))]} ${localTime(ms, tz)}`;
}

// Tokenless, like the polling request. Never rejects; races its own timer like fetchJson.
async function fetchWindow(fetchFn, url, timeoutMs) {
  let timer;
  try {
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const request = (async () => {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      const status = response && Number.isInteger(response.status) ? response.status : null;
      if (!(status >= 200 && status < 300)) return { status, body: null };
      try {
        return { status, body: JSON.parse(await response.text()) };
      } catch {
        return { status, body: null };
      }
    })();
    request.catch(() => {});
    return (await Promise.race([request, timeout])) || { status: null, body: null };
  } catch {
    return { status: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

// The previous retry's time, when it is under 30 minutes old: anchored to the retry, so skipping doesn't renew it
function recentWeatherRetry(previous, now) {
  if (!isObject(previous) || typeof previous.weatherRetryAt !== 'string') return null;
  const at = Date.parse(previous.weatherRetryAt);
  const age = now - at;
  return age >= 0 && age < RETRY_PAUSE_MS ? new Date(at).toISOString() : null;
}

const zoneOf = value =>
  isObject(value) && isObject(value.location) && isZone(value.location.timezone) ? value.location.timezone : null;

// A 2xx object without its list is an empty list (a new account); anything else is unreadable
function embeddedList(result, key) {
  if (!result.ok) return { ok: false, kind: result.kind };
  if (!isObject(result.data)) return { ok: false, kind: 'unavailable' };
  const embedded = isObject(result.data._embedded) ? result.data._embedded : {};
  return { ok: true, list: Array.isArray(embedded[key]) ? embedded[key] : [] };
}

// The endpoint always covers a year: an empty one may be a paused token
function effortsOf(result) {
  if (!result.ok) return { ok: false, kind: result.kind };
  const efforts = isObject(result.data) ? result.data.trainingEfforts : null;
  if (!isObject(efforts) || Object.keys(efforts).length === 0) return { ok: false, kind: 'unavailable' };
  return { ok: true, efforts };
}

// Field by field from the contract, so nothing else in a previous output survives
function reuseWeek(week) {
  if (!isObject(week) || !Array.isArray(week.days)) return null;
  return {
    title: textOf(week.title),
    days: week.days.filter(isObject).map(day => ({
      label: textOf(day.label),
      today: day.today === true,
      items: (Array.isArray(day.items) ? day.items : []).filter(isObject).map(item => ({
        kind: ITEM_KINDS.includes(item.kind) ? item.kind : 'planned',
        text: textOf(item.text)
      })),
      more: textOf(day.more)
    })),
    footer: textOf(week.footer),
    garmin: (Array.isArray(week.garmin) ? week.garmin : []).filter(name => typeof name === 'string')
  };
}

function reuseForm(form) {
  if (!isObject(form)) return null;
  const labels = isObject(form.labels) ? form.labels : {};
  const path = value => (typeof value === 'string' && REUSED_PATH.test(value) ? value : '');
  return {
    heading: textOf(form.heading),
    today: textOf(form.today),
    pastPath: path(form.pastPath),
    futurePath: path(form.futurePath),
    zeroY: finiteOf(form.zeroY),
    todayX: finiteOf(form.todayX),
    labels: { back: textOf(labels.back), today: textOf(labels.today), ahead: textOf(labels.ahead) },
    empty: textOf(form.empty)
  };
}

// Last good data: only from a v1 output with both panels whose Tredict fetch was today (local)
function staleTredict(previous, now, tz) {
  if (!isObject(previous) || previous.v !== BOARD_VERSION) return null;
  const at = typeof previous.tredictAt === 'string' ? Date.parse(previous.tredictAt) : NaN;
  if (!Number.isFinite(at) || localDate(at, tz) !== localDate(now, tz)) return null;
  const week = reuseWeek(previous.week);
  const form = reuseForm(previous.form);
  if (!week || !form) return null;
  return { week, form, tredictAt: previous.tredictAt, tredictAtText: textOf(previous.tredictAtText) };
}

function tredictPanels({ plan, activities, efforts, previous, now, tz, settings, lang, fetchedAt, fetchedAtText }) {
  const text = STRINGS[lang];
  const parts = [plan, activities, efforts];
  const failed = kind => parts.some(part => !part.ok && part.kind === kind);
  const empty = { week: null, form: null, tredictAt: null, tredictAtText: '' };

  if (failed('auth')) return { state: 'auth', message: text.tokenInvalid, ...empty };
  if (failed('payment')) return { state: 'payment', message: text.tredictPayment, ...empty };
  if (parts.some(part => !part.ok)) {
    const stale = staleTredict(previous, now, tz);
    if (!stale) return { state: 'unavailable', message: text.tredictUnavailable, ...empty };
    return { state: 'stale', message: fill(text.tredictDataFrom, { time: stale.tredictAtText }), ...stale };
  }

  const week = buildWeek({ plans: plan.list, activities: activities.list, now, tz, sport: settings.sport });
  const series = formSeries({ efforts: efforts.efforts, today: localDate(now, tz) });
  return {
    state: 'ok',
    message: '',
    week: weekView(week, lang),
    form: formChart(series, lang),
    tredictAt: fetchedAt,
    tredictAtText: fetchedAtText
  };
}

async function assembleBoard(input, { fetch: fetchFn, now, timeoutMs }) {
  const body = isObject(input) ? input : {};
  const trmnl = isObject(body.trmnl) ? body.trmnl : {};
  const user = isObject(trmnl.user) ? trmnl.user : {};
  const previous = isObject(trmnl.previous_merge_variables) ? trmnl.previous_merge_variables : null;
  const settings = readSettings(body);
  const lang = resolveLanguage(settings.language, user.locale);
  const text = STRINGS[lang];
  const userZone = isZone(user.time_zone_iana) ? user.time_zone_iana : null;
  const polled = typeof body.generatedAt === 'string';
  // The range has a day of margin on each side, so a retry body's zone (not known yet) can't move it out of the week
  const rangeZone = userZone || zoneOf(body) || 'UTC';

  const urls = tredictUrls(tredictRange(now, rangeZone));
  const tredictCall = url => fetchJson(fetchFn, url, settings.token, timeoutMs);
  const pausedRetryAt = recentWeatherRetry(previous, now);
  const retry = !polled && settings.hasLocation && !pausedRetryAt;
  const [planResult, activityResult, effortResult, weather] = await Promise.all([
    tredictCall(urls.plan),
    tredictCall(urls.activities),
    tredictCall(urls.efforts),
    retry ? fetchWindow(fetchFn, windowUrl(settings), timeoutMs) : null
  ]);

  const windowBody = polled ? body : weather && weather.body;
  // Calendar and form: the user's zone, else the zone of the window body used; the run window: the API's zone
  const tz = userZone || zoneOf(windowBody) || 'UTC';
  const apiZone = zoneOf(windowBody) || tz;
  let weatherRetryAt = null;
  if (retry) weatherRetryAt = new Date(now).toISOString();
  else if (!polled && settings.hasLocation) weatherRetryAt = pausedRetryAt;

  const fetchedAt = new Date(now).toISOString();
  const fetchedAtText = dayAndTime(now, tz, text);
  const plan = embeddedList(planResult, 'plannedWorkoutList');
  const tredict = tredictPanels({
    plan,
    activities: embeddedList(activityResult, 'activityList'),
    efforts: effortsOf(effortResult),
    previous,
    now,
    tz,
    settings,
    lang,
    fetchedAt,
    fetchedAtText
  });

  const session = pickSession({
    plans: plan.ok ? plan.list : null,
    now,
    tz: apiZone,
    avail: settings.availability,
    sport: settings.sport
  });
  const run = windowPanel({
    body: windowBody,
    status: weather ? weather.status : null,
    session,
    lang,
    hasLocation: settings.hasLocation
  });

  const attribution = tredict.week ? tredict.week.garmin.slice() : [];
  if (WINDOW_KINDS.includes(run.kind) && isObject(windowBody) && typeof windowBody.attribution === 'string') {
    attribution.push(windowBody.attribution);
  }

  const { state, message, tredictAt, tredictAtText, week, form } = tredict;
  return {
    v: BOARD_VERSION,
    lang,
    fetchedAt,
    fetchedAtText,
    tredict: { state, message },
    tredictAt,
    tredictAtText,
    week,
    form,
    run,
    weatherRetryAt,
    attribution: attribution.filter(Boolean).join(ATTRIBUTION_SEPARATOR)
  };
}

// Never rejects: anything unexpected gives the fixed error output
async function buildBoard(input, { fetch: fetchFn, now, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  try {
    return await assembleBoard(input, { fetch: fetchFn, now, timeoutMs });
  } catch {
    return errorBoard(now);
  }
}

module.exports = { buildBoard };
