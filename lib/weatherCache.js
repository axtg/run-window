const crypto = require('crypto');

const HOUR_MS = 3600000;
const MINUTE_MS = 60000;
const DAY_MS = 24 * HOUR_MS;
const MAX_STALE_MS = 3 * HOUR_MS;
const RETRY_WAIT_MS = 5 * MINUTE_MS;
const UNAVAILABLE = 'Weather data is temporarily unavailable.';

// Upstream budget, protecting Open-Meteo's free quota for everyone.
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

function capacityError(retryAfter) {
  const error = new Error('The service is at capacity for new locations today. Try again after midnight UTC.');
  error.statusCode = 503;
  error.expose = true;
  error.retryAfter = retryAfter;
  return error;
}

const hmac = (salt, key) => crypto.createHmac('sha256', salt).update(key).digest('hex');

function createWeatherCache({
  fetchForecast,
  now = Date.now,
  onFailure = () => {},
  budget = BUDGET,
  hashKey = hmac,
  sweepIntervalMs = 10 * MINUTE_MS
}) {
  const entries = new Map(); // key -> { forecast, fetchedAt, expiresAt }
  const failedAt = new Map(); // key -> time of the last failed upstream call
  const inflight = new Map(); // key -> Promise<{ forecast, stale }>

  // Budget state, in memory only. Admitted keys are kept as salted hashes; the salt is replaced each UTC day.
  let day = null;
  let salt = null;
  let admittedKeys = new Set();
  let callsToday = 0;
  let minute = null;
  let callsThisMinute = 0;

  function rollOver(time) {
    const currentDay = Math.floor(time / DAY_MS);
    if (currentDay !== day) {
      day = currentDay;
      salt = crypto.randomBytes(32);
      admittedKeys = new Set();
      callsToday = 0;
    }
    const currentMinute = Math.floor(time / MINUTE_MS);
    if (currentMinute !== minute) {
      minute = currentMinute;
      callsThisMinute = 0;
    }
  }

  // A key admitted earlier today keeps working; a new one is refused once the day's cap is used.
  function admit(key, time) {
    const hash = hashKey(salt, key);
    if (admittedKeys.has(hash)) return;
    if (admittedKeys.size >= budget.keysPerDay) {
      throw capacityError(Math.ceil(((day + 1) * DAY_MS - time) / 1000));
    }
    admittedKeys.add(hash);
  }

  const overBudget = () => callsThisMinute >= budget.callsPerMinute || callsToday >= budget.callsPerDay;

  function prune(time) {
    for (const [key, entry] of entries) {
      if (time - entry.fetchedAt > MAX_STALE_MS) entries.delete(key);
    }
    for (const [key, failed] of failedAt) {
      if (time - failed >= RETRY_WAIT_MS) failedAt.delete(key);
    }
  }

  // Retention must not depend on traffic: entries older than 3 hours go and the day's salt and key set are replaced.
  function sweep(time = now()) {
    prune(time);
    rollOver(time);
  }

  // Never keeps the process alive.
  setInterval(sweep, sweepIntervalMs).unref();

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
    sweep(time);
    admit(key, time);

    const entry = entries.get(key);
    if (entry && time < entry.expiresAt) return { forecast: entry.forecast, stale: false };
    if (inflight.has(key)) return inflight.get(key);
    if (failedAt.has(key) || overBudget()) return fallback(key, time);

    callsToday += 1;
    callsThisMinute += 1;
    const call = refresh(key, roundedLat, roundedLon).finally(() => inflight.delete(key));
    inflight.set(key, call);
    return call;
  }

  // Counts and ages only: nothing here can be read back as a location.
  function stats() {
    const time = now();
    sweep(time);
    let oldest = 0;
    for (const entry of entries.values()) oldest = Math.max(oldest, time - entry.fetchedAt);
    return {
      entries: entries.size,
      oldestAgeSeconds: Math.floor(oldest / 1000),
      keysToday: admittedKeys.size,
      callsToday,
      callsThisMinute
    };
  }

  return { getForecast, stats };
}

module.exports = { BUDGET, createWeatherCache, nextExpiry };
