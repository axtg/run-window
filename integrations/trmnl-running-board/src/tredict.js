const { zonedMidnight, weekDates, addDays, localDate } = require('./time');

const TREDICT_BASE = 'https://www.tredict.com/api/oauth/v2/';
const DEADLINE_MS = 4000;
const CALL_TIMEOUT_MS = 3000;
const MIN_START_MS = 500;

// From the day before this local Monday to the end of the day after next Monday, as UTC ISO strings
function tredictRange(now, timeZone) {
  const monday = weekDates(localDate(now, timeZone))[0];
  return {
    from: new Date(zonedMidnight(addDays(monday, -1), timeZone)).toISOString(),
    to: new Date(zonedMidnight(addDays(monday, 9), timeZone) - 1).toISOString()
  };
}

function tredictUrls(range) {
  const query = `startDate=${encodeURIComponent(range.from)}&endDate=${encodeURIComponent(range.to)}`;
  return {
    plan: `${TREDICT_BASE}plannedTrainingList?${query}`,
    activities: `${TREDICT_BASE}activityList?pageSize=50&extendedSummary=1`,
    efforts: `${TREDICT_BASE}efforts`
  };
}

function detailUrl(id) {
  return `${TREDICT_BASE}activity/${encodeURIComponent(id)}?extraValues=1`;
}

// Whole seconds from a Retry-After header, or null when absent, unreadable or an HTTP date
function retryAfterSeconds(response) {
  try {
    const value = response.headers.get('retry-after');
    return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
  } catch {
    return null;
  }
}

// Never rejects. The fetch races its own timer, so one that ignores the abort signal still settles.
async function fetchJson(fetchFn, url, token, timeoutMs = 3000) {
  if (!token) return { ok: false, kind: 'auth', status: null };
  const unavailable = status => ({ ok: false, kind: 'unavailable', status });
  let timer;
  try {
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const request = (async () => {
      const response = await fetchFn(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json;charset=UTF-8' },
        // Serial calls rely on this signal tearing the request down at the timeout; the race timer only settles the
        // promise, so without it a timed-out request would overlap the next one.
        signal: AbortSignal.timeout(timeoutMs)
      });
      const status = response.status;
      if (status === 401) return { ok: false, kind: 'paused', status };
      if (status === 403) return { ok: false, kind: 'auth', status };
      if (status === 404) return { ok: false, kind: 'missing', status };
      if (status === 429) return { ok: false, kind: 'rate', status, retryAfterS: retryAfterSeconds(response) };
      if (status === 402) return { ok: false, kind: 'payment', status };
      if (!(status >= 200 && status < 300)) return unavailable(status);
      try {
        return { ok: true, data: JSON.parse(await response.text()) };
      } catch {
        return unavailable(status);
      }
    })();
    request.catch(() => {});
    return (await Promise.race([request, timeout])) || unavailable(null);
  } catch {
    return unavailable(null);
  } finally {
    clearTimeout(timer);
  }
}

// Runs Tredict calls strictly one after another under one deadline and stops after a 429. call() never rejects.
function tredictSequence({ fetch, token, clock = Date.now, deadlineMs = DEADLINE_MS }) {
  const deadline = clock() + deadlineMs;
  let last = Promise.resolve();
  let rate = null;

  const run = async url => {
    if (rate) return { ok: false, kind: 'skipped' };
    const remaining = deadline - clock();
    if (remaining < MIN_START_MS) return { ok: false, kind: 'unavailable', status: null };
    const result = await fetchJson(fetch, url, token, Math.min(CALL_TIMEOUT_MS, remaining));
    if (result.kind === 'rate') rate = { retryAfterS: result.retryAfterS };
    return result;
  };

  return {
    call(url) {
      const result = last.then(() => run(url));
      last = result.catch(() => {});
      return result.catch(() => ({ ok: false, kind: 'unavailable', status: null }));
    },
    remaining: () => deadline - clock(),
    stopped: () => rate !== null,
    rate: () => rate
  };
}

module.exports = {
  TREDICT_BASE,
  DEADLINE_MS,
  CALL_TIMEOUT_MS,
  MIN_START_MS,
  tredictRange,
  tredictUrls,
  detailUrl,
  retryAfterSeconds,
  fetchJson,
  tredictSequence
};
