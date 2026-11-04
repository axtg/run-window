const { STRINGS, resolveLanguage, fill } = require('./strings');
const { localDate, localTime, dayOfWeek } = require('./time');
const { readSettings, windowUrl } = require('./settings');
const { tredictRange, tredictUrls, tredictSequence } = require('./tredict');
const { isZone, buildWeek, weekView } = require('./week');
const { formSeries, formChart } = require('./form');
const { pickSession, windowPanel } = require('./runWindow');

const BOARD_VERSION = 1;
const REQUEST_TIMEOUT_MS = 3000;
const RETRY_PAUSE_MS = 30 * 60000;
// A Tredict 429 pauses calls for Retry-After seconds, clamped to this range
const TREDICT_PAUSE_MIN_S = 1800;
const TREDICT_PAUSE_MAX_S = 21600;
const SKIPPED = { ok: false, kind: 'skipped' };
const ATTRIBUTION_SEPARATOR = ' · ';
// Run panel kinds that used weather data, so they carry its attribution
const WEATHER_KINDS = ['window', 'shorter', 'fallback', 'none'];
const ITEM_KINDS = ['done', 'planned', 'missed', 'unplanned'];
const REUSED_PATH = /^[ML0-9. -]*$/;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const textOf = value => (typeof value === 'string' ? value : '');
const finiteOf = value => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

// The fixed output for anything unexpected: no input-derived text, never an error's text. Only a valid Tredict pause
// carries over from the previous output, so a throw can't drop it.
function errorBoard(now, previous) {
  const at = Number.isFinite(now) ? now : Date.now();
  let fetchedAtText;
  try {
    fetchedAtText = dayAndTime(at, 'UTC', STRINGS.en);
  } catch {
    fetchedAtText = '';
  }
  let tredictRetryAt;
  try {
    tredictRetryAt = recentTredictPause(previous, at);
  } catch {
    tredictRetryAt = null;
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
    tredictRetryAt,
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

// The previous retry's time, when it is under 30 minutes old and the weather was unavailable then: anchored to the
// retry, so skipping doesn't renew it. Any other previous result (badSettings, a window) retries again.
function recentWeatherRetry(previous, now) {
  if (!isObject(previous) || typeof previous.weatherRetryAt !== 'string') return null;
  if (!isObject(previous.run) || previous.run.kind !== 'error') return null;
  const at = Date.parse(previous.weatherRetryAt);
  const age = now - at;
  return age >= 0 && age < RETRY_PAUSE_MS ? new Date(at).toISOString() : null;
}

// The previous Tredict pause while it is in force: anchored to the 429, so skipping doesn't renew it. A pause more
// than the longest clamp ahead (hand-edited, clock skew) is ignored rather than pausing the board for good.
function recentTredictPause(previous, now) {
  if (!isObject(previous) || typeof previous.tredictRetryAt !== 'string') return null;
  const at = Date.parse(previous.tredictRetryAt);
  const ahead = at - now;
  return ahead > 0 && ahead <= TREDICT_PAUSE_MAX_S * 1000 ? new Date(at).toISOString() : null;
}

function tredictPauseUntil(now, retryAfterS) {
  const seconds = Number.isFinite(retryAfterS) ? retryAfterS : TREDICT_PAUSE_MIN_S;
  return new Date(now + Math.min(Math.max(seconds, TREDICT_PAUSE_MIN_S), TREDICT_PAUSE_MAX_S) * 1000).toISOString();
}

// Plan, activities, efforts one at a time; the first failure ends the sequence, since the panels fall back as a whole
async function fetchTredict(sequence, urls) {
  const plan = embeddedList(await sequence.call(urls.plan), 'plannedWorkoutList');
  if (!plan.ok) return { plan, activities: SKIPPED, efforts: SKIPPED };
  const activities = embeddedList(await sequence.call(urls.activities), 'activityList');
  if (!activities.ok) return { plan, activities, efforts: SKIPPED };
  return { plan, activities, efforts: effortsOf(await sequence.call(urls.efforts)) };
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

// No keys is an empty account. It only gives the empty form when the plan and activity calls also succeeded: any
// other failure already makes the Tredict state unavailable, stale, paused, auth or payment.
function effortsOf(result) {
  if (!result.ok) return { ok: false, kind: result.kind };
  const efforts = isObject(result.data) ? result.data.trainingEfforts : null;
  if (!isObject(efforts)) return { ok: false, kind: 'unavailable' };
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

  if (failed('paused')) return { state: 'paused', message: text.tokenPaused, ...empty };
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

// Read before assembly, so the fixed error output can still carry the previous pause
function previousOf(input) {
  try {
    const trmnl = isObject(input) && isObject(input.trmnl) ? input.trmnl : {};
    return isObject(trmnl.previous_merge_variables) ? trmnl.previous_merge_variables : null;
  } catch {
    return null;
  }
}

async function assembleBoard(input, { fetch: fetchFn, now, timeoutMs, clock, previous }) {
  const body = isObject(input) ? input : {};
  const trmnl = isObject(body.trmnl) ? body.trmnl : {};
  const user = isObject(trmnl.user) ? trmnl.user : {};
  const settings = readSettings(body);
  const lang = resolveLanguage(settings.language, user.locale);
  const text = STRINGS[lang];
  const userZone = isZone(user.time_zone_iana) ? user.time_zone_iana : null;
  const polled = typeof body.generatedAt === 'string';
  // The range has a day of margin on each side, so a retry body's zone (not known yet) can't move it out of the week
  const rangeZone = userZone || zoneOf(body) || 'UTC';

  const urls = tredictUrls(tredictRange(now, rangeZone));
  // While a 429 pause is in force no Tredict call is made at all, and the panels take the stale path
  const tredictPause = recentTredictPause(previous, now);
  const sequence = tredictPause ? null : tredictSequence({ fetch: fetchFn, token: settings.token, clock });
  const pausedRetryAt = recentWeatherRetry(previous, now);
  const retry = !polled && settings.hasLocation && !pausedRetryAt;
  const [results, weather] = await Promise.all([
    sequence ? fetchTredict(sequence, urls) : { plan: SKIPPED, activities: SKIPPED, efforts: SKIPPED },
    retry ? fetchWindow(fetchFn, windowUrl(settings), timeoutMs) : null
  ]);
  const rate = sequence ? sequence.rate() : null;
  const tredictRetryAt = rate ? tredictPauseUntil(now, rate.retryAfterS) : tredictPause;

  const windowBody = polled ? body : weather && weather.body;
  // Calendar and form: the user's zone, else the zone of the window body used; the run window: the API's zone
  const tz = userZone || zoneOf(windowBody) || 'UTC';
  const apiZone = zoneOf(windowBody) || tz;
  let weatherRetryAt = null;
  if (retry) weatherRetryAt = new Date(now).toISOString();
  else if (!polled && settings.hasLocation) weatherRetryAt = pausedRetryAt;

  const fetchedAt = new Date(now).toISOString();
  const fetchedAtText = dayAndTime(now, tz, text);
  const { plan } = results;
  const tredict = tredictPanels({
    plan,
    activities: results.activities,
    efforts: results.efforts,
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
  if (WEATHER_KINDS.includes(run.kind) && isObject(windowBody) && typeof windowBody.attribution === 'string') {
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
    tredictRetryAt,
    attribution: attribution.filter(Boolean).join(ATTRIBUTION_SEPARATOR)
  };
}

// Never rejects: anything unexpected gives the fixed error output. `timeoutMs` is the weather retry's; Tredict calls
// take theirs from the sequence's deadline, which `clock` drives.
async function buildBoard(input, { fetch: fetchFn, now, timeoutMs = REQUEST_TIMEOUT_MS, clock = Date.now } = {}) {
  const previous = previousOf(input);
  try {
    return await assembleBoard(input, { fetch: fetchFn, now, timeoutMs, clock, previous });
  } catch {
    return errorBoard(now, previous);
  }
}

module.exports = { buildBoard, recentTredictPause };
