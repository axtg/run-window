const HOUR_MS = 3600000;
const MINUTE_MS = 60000;
const MAX_STALE_MS = 3 * HOUR_MS;
const RETRY_WAIT_MS = 5 * MINUTE_MS;
const UNAVAILABLE = 'Weather data is temporarily unavailable.';

// Upstream budget. Declared here and enforced in a later task.
const BUDGET = { keysPerDay: 300, callsPerMinute: 300, callsPerDay: 8000 };

const round2 = value => Math.round(value * 100) / 100 + 0;

// The next hh:05 strictly after `ms` (the next full hour plus 5 minutes, so at most 60 minutes away).
function nextExpiry(ms) {
  const candidate = Math.floor(ms / HOUR_MS) * HOUR_MS + 5 * MINUTE_MS;
  return candidate > ms ? candidate : candidate + HOUR_MS;
}

function unavailable() {
  const error = new Error(UNAVAILABLE);
  error.statusCode = 503;
  error.expose = true;
  return error;
}

function createWeatherCache({ fetchForecast, now = Date.now, onFailure = () => {} }) {
  const entries = new Map(); // key -> { forecast, fetchedAt, expiresAt }
  const failedAt = new Map(); // key -> time of the last failed upstream call
  const inflight = new Map(); // key -> Promise<{ forecast, stale }>

  function prune(time) {
    for (const [key, entry] of entries) {
      if (time - entry.fetchedAt > MAX_STALE_MS) entries.delete(key);
    }
    for (const [key, failed] of failedAt) {
      if (time - failed >= RETRY_WAIT_MS) failedAt.delete(key);
    }
  }

  function fallback(key, time) {
    const entry = entries.get(key);
    if (entry && time - entry.fetchedAt <= MAX_STALE_MS) return { forecast: entry.forecast, stale: true };
    throw unavailable();
  }

  async function refresh(key, lat, lon) {
    try {
      const forecast = await fetchForecast(lat, lon);
      const time = now();
      entries.set(key, { forecast, fetchedAt: time, expiresAt: nextExpiry(time) });
      failedAt.delete(key);
      return { forecast, stale: false };
    } catch {
      // Only a fixed reason is reported: upstream errors may carry details that do not belong in logs.
      const time = now();
      failedAt.set(key, time);
      const entry = entries.get(key);
      const stale = Boolean(entry) && time - entry.fetchedAt <= MAX_STALE_MS;
      onFailure(stale ? 'upstream_failed_serving_stale' : 'upstream_failed_no_usable_entry');
      return fallback(key, time);
    }
  }

  async function getForecast(lat, lon) {
    const roundedLat = round2(lat);
    const roundedLon = round2(lon);
    const key = `${roundedLat.toFixed(2)},${roundedLon.toFixed(2)}`;
    const time = now();
    prune(time);

    const entry = entries.get(key);
    if (entry && time < entry.expiresAt) return { forecast: entry.forecast, stale: false };
    if (inflight.has(key)) return inflight.get(key);
    if (failedAt.has(key)) return fallback(key, time);

    const call = refresh(key, roundedLat, roundedLon).finally(() => inflight.delete(key));
    inflight.set(key, call);
    return call;
  }

  return { getForecast, stats: () => ({ entries: entries.size }) };
}

module.exports = { BUDGET, createWeatherCache, nextExpiry };
