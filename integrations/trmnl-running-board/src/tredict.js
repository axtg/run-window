const { zonedMidnight, weekDates, addDays, localDate } = require('./time');

const TREDICT_BASE = 'https://www.tredict.com/api/oauth/v2/';

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
        signal: AbortSignal.timeout(timeoutMs)
      });
      const status = response.status;
      if (status === 401 || status === 403) return { ok: false, kind: 'auth', status };
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

module.exports = { TREDICT_BASE, tredictRange, tredictUrls, fetchJson };
