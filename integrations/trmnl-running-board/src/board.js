const { STRINGS, resolveLanguage, fill } = require('./strings');
const { localDate, localTime, dayOfWeek } = require('./time');
const { readSettings, windowUrl, CAPACITY_URL } = require('./settings');
const { tredictRange, tredictUrls, tredictSequence, detailUrl } = require('./tredict');
const {
  INTENSITY_PER_RUN,
  DETAIL_MIN_MS,
  readIntensityCache,
  cacheList,
  intensityOf,
  intensityView
} = require('./intensity');
const { isZone, buildWeek, recentActivities, weekView } = require('./week');
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
const INTENSITY_KINDS = ['low', 'moderate', 'high'];

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const textOf = value => (typeof value === 'string' ? value : '');
const finiteOf = value => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const union = (...lists) => [...new Set(lists.flat())];

// The fixed output for anything unexpected: no input-derived text, never an error's text. Only the Tredict pause and
// the intensity cache carry over, from this run when it got that far, else from the previous output, so a throw can't
// drop them.
function errorBoard(now, previous, carry = {}, theme = 'light') {
  const at = Number.isFinite(now) ? now : Date.now();
  let fetchedAtText;
  try {
    fetchedAtText = dayAndTime(at, 'UTC', STRINGS.en);
  } catch {
    fetchedAtText = '';
  }
  let tredictRetryAt;
  try {
    tredictRetryAt = carry.tredictRetryAt || recentTredictPause(previous, at);
  } catch {
    tredictRetryAt = null;
  }
  let intensityCache;
  try {
    intensityCache = Array.isArray(carry.intensityCache) ? carry.intensityCache : carriedCache(previous);
  } catch {
    intensityCache = [];
  }
  return {
    v: BOARD_VERSION,
    lang: 'en',
    theme,
    fetchedAt: new Date(at).toISOString(),
    fetchedAtText,
    tredict: { state: 'unavailable', message: STRINGS.en.tredictUnavailable },
    tredictAt: null,
    tredictAtText: '',
    week: null,
    form: null,
    intensity: null,
    run: { kind: 'error', heading: STRINGS.en.weatherUnavailable, lines: [] },
    weatherRetryAt: null,
    tredictRetryAt,
    intensityCache,
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
async function fetchPanels(sequence, urls) {
  const plan = embeddedList(await sequence.call(urls.plan), 'plannedWorkoutList');
  if (!plan.ok) return { plan, activities: SKIPPED, efforts: SKIPPED };
  const activities = embeddedList(await sequence.call(urls.activities), 'activityList');
  if (!activities.ok) return { plan, activities, efforts: SKIPPED };
  return { plan, activities, efforts: effortsOf(await sequence.call(urls.efforts)) };
}

// The panels' calls, then the past 7 days' uncached detail calls on the same sequence. The week needs the run's zone,
// which only the weather retry knows when the user has none.
async function fetchTredict(sequence, urls, { zone, now, sport, previous }) {
  const results = await fetchPanels(sequence, urls);
  if (![results.plan, results.activities, results.efforts].every(part => part.ok)) return results;
  const week = buildWeek({ plans: results.plan.list, activities: results.activities.list, now, tz: await zone, sport });
  const recent = recentActivities(results.activities.list, now);
  const ids = [...new Set(recent.map(entry => entry.id))];
  const cache = readIntensityCache(isObject(previous) ? previous.intensityCache : null);
  await fetchIntensity(sequence, ids, cache);
  return { ...results, week, recent, ids, cache };
}

// Newest first, within the per-run budget and deadline. A 404 (or a body without the field) is cached as zeros, since
// asking again won't help; any other failure leaves the id for a later run and ends the detail calls, as does a 429.
async function fetchIntensity(sequence, ids, cache) {
  let calls = 0;
  for (const id of ids) {
    if (cache.has(id)) continue;
    if (calls >= INTENSITY_PER_RUN || sequence.stopped() || sequence.remaining() < DETAIL_MIN_MS) return;
    calls += 1;
    const result = await sequence.call(detailUrl(id));
    if (result.ok) cache.set(id, intensityOf(result.data));
    else if (result.kind === 'missing') cache.set(id, [0, 0, 0]);
    else return;
  }
}

// The previous output's cache as it was, for runs that don't know the past 7 days' ids
function carriedCache(previous) {
  const cache = readIntensityCache(isObject(previous) ? previous.intensityCache : null);
  return cacheList(cache, [...cache.keys()]);
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

function reuseIntensity(intensity) {
  if (!isObject(intensity) || typeof intensity.heading !== 'string') return null;
  const { segments, labels } = intensity;
  if (!Array.isArray(segments) || segments.length > INTENSITY_KINDS.length) return null;
  if (!Array.isArray(labels) || labels.length !== 3 || !labels.every(label => typeof label === 'string')) return null;
  const valid = segment =>
    isObject(segment) &&
    INTENSITY_KINDS.includes(segment.kind) &&
    isFiniteNumber(segment.x) &&
    isFiniteNumber(segment.width);
  if (!segments.every(valid)) return null;
  return {
    heading: intensity.heading,
    segments: segments.map(({ kind, x, width }) => ({ kind, x, width })),
    labels: labels.slice(),
    garmin: (Array.isArray(intensity.garmin) ? intensity.garmin : []).filter(name => typeof name === 'string')
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
  return {
    week,
    form,
    intensity: reuseIntensity(previous.intensity),
    tredictAt: previous.tredictAt,
    tredictAtText: textOf(previous.tredictAtText)
  };
}

function tredictPanels({ results, previous, now, tz, lang, fetchedAt, fetchedAtText }) {
  const text = STRINGS[lang];
  const { plan, activities, efforts } = results;
  const parts = [plan, activities, efforts];
  const failed = kind => parts.some(part => !part.ok && part.kind === kind);
  const empty = {
    week: null,
    form: null,
    intensity: null,
    garmin: [],
    intensityCache: carriedCache(previous),
    tredictAt: null,
    tredictAtText: ''
  };

  if (failed('paused')) return { state: 'paused', message: text.tokenPaused, ...empty };
  if (failed('auth')) return { state: 'auth', message: text.tokenInvalid, ...empty };
  if (failed('payment')) return { state: 'payment', message: text.tredictPayment, ...empty };
  if (parts.some(part => !part.ok)) {
    const stale = staleTredict(previous, now, tz);
    if (!stale) return { state: 'unavailable', message: text.tredictUnavailable, ...empty };
    return {
      state: 'stale',
      message: fill(text.tredictDataFrom, { time: stale.tredictAtText }),
      ...empty,
      ...stale,
      garmin: union(stale.week.garmin, stale.intensity ? stale.intensity.garmin : [])
    };
  }

  const { week, recent, ids, cache } = results;
  const series = formSeries({ efforts: efforts.efforts, today: localDate(now, tz) });
  // The bar only once every activity of the past 7 days is cached
  const complete = ids.every(id => cache.has(id));
  const entries = ids.map(id => cache.get(id));
  const view = complete ? intensityView(entries, lang) : null;
  // The bar keeps the Garmin texts of the runs that add to it, so stale panels can attribute them too
  const adds = entry => entry.garmin !== null && cache.get(entry.id).some(value => value > 0);
  const intensity = view && { ...view, garmin: union(recent.filter(adds).map(entry => entry.garmin)) };
  // The footer: the calendar rows' Garmin texts, then the bar's
  const garmin = union(week.garmin, intensity ? intensity.garmin : []);
  return {
    state: 'ok',
    message: '',
    week: weekView(week, lang),
    form: formChart(series, lang),
    intensity,
    garmin,
    intensityCache: cacheList(cache, ids),
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

async function assembleBoard(input, { fetch: fetchFn, now, timeoutMs, clock, previous, carry }) {
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
  // Runs alongside the Tredict calls; the detail calls wait for it only when the week's zone depends on it
  const weatherCall = retry ? fetchWindow(fetchFn, windowUrl(settings), timeoutMs) : Promise.resolve(null);
  // Alongside the retry, never after it, so it adds no time: only read when the retry answers 503
  const capacityCall = retry ? fetchWindow(fetchFn, CAPACITY_URL, timeoutMs) : Promise.resolve(null);
  // Calendar, form and intensity: the user's zone, else the zone of the window body used
  const zone = weatherCall.then(weather => userZone || zoneOf(polled ? body : weather && weather.body) || 'UTC');
  const [results, weather, capacity] = await Promise.all([
    sequence
      ? fetchTredict(sequence, urls, { zone, now, sport: settings.sport, previous })
      : { plan: SKIPPED, activities: SKIPPED, efforts: SKIPPED },
    weatherCall,
    capacityCall
  ]);
  const rate = sequence ? sequence.rate() : null;
  const tredictRetryAt = rate ? tredictPauseUntil(now, rate.retryAfterS) : tredictPause;
  carry.tredictRetryAt = tredictRetryAt;

  const windowBody = polled ? body : weather && weather.body;
  const tz = await zone;
  // The run window: the API's zone
  const apiZone = zoneOf(windowBody) || tz;
  let weatherRetryAt = null;
  if (retry) weatherRetryAt = new Date(now).toISOString();
  else if (!polled && settings.hasLocation) weatherRetryAt = pausedRetryAt;

  const fetchedAt = new Date(now).toISOString();
  const fetchedAtText = dayAndTime(now, tz, text);
  const { plan } = results;
  const tredict = tredictPanels({ results, previous, now, tz, lang, fetchedAt, fetchedAtText });
  carry.intensityCache = tredict.intensityCache;

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
    full: Boolean(capacity && isObject(capacity.body) && capacity.body.full === true),
    session,
    lang,
    hasLocation: settings.hasLocation
  });

  const attribution = tredict.garmin.slice();
  if (WEATHER_KINDS.includes(run.kind) && isObject(windowBody) && typeof windowBody.attribution === 'string') {
    attribution.push(windowBody.attribution);
  }

  const { state, message, tredictAt, tredictAtText, week, form, intensity, intensityCache } = tredict;
  return {
    v: BOARD_VERSION,
    lang,
    theme: settings.theme,
    fetchedAt,
    fetchedAtText,
    tredict: { state, message },
    tredictAt,
    tredictAtText,
    week,
    form,
    intensity,
    run,
    weatherRetryAt,
    tredictRetryAt,
    intensityCache,
    attribution: attribution.filter(Boolean).join(ATTRIBUTION_SEPARATOR)
  };
}

// Never rejects: anything unexpected gives the fixed error output. `timeoutMs` is the weather retry's; Tredict calls
// take theirs from the sequence's deadline, which `clock` drives.
async function buildBoard(input, { fetch: fetchFn, now, timeoutMs = REQUEST_TIMEOUT_MS, clock = Date.now } = {}) {
  const previous = previousOf(input);
  // What this run has worked out so far that must survive a throw: its Tredict pause and its intensity cache
  const carry = {};
  try {
    return await assembleBoard(input, { fetch: fetchFn, now, timeoutMs, clock, previous, carry });
  } catch {
    // readSettings never throws, so even the error output keeps the chosen theme
    return errorBoard(now, previous, carry, readSettings(input).theme);
  }
}

module.exports = { buildBoard, recentTredictPause };
