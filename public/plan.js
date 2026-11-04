// Turns a route summary and one API day into the page's overview lines. Runs in the browser and in the Jest tests.
(function () {
  const DRY_MAX_PROBABILITY = 20;
  const MIN_PACE_SEC = 180;
  const MAX_PACE_SEC = 900;
  const KEY_STEP_MIN = 15;
  const MAX_KEY_MIN = 180;
  const FALLBACK_KEY = '60';
  const LITTLE_WIND_KMH = 10;
  const HEADWIND_MAX_ANGLE = 90;
  const GENERIC_ERROR = 'Weather unavailable, try again later.';

  function parsePace(text) {
    if (typeof text !== 'string' || !/^\d{1,2}:\d{2}$/.test(text)) return null;
    const [minutes, seconds] = text.split(':').map(Number);
    if (seconds >= 60) return null;
    const total = minutes * 60 + seconds;
    return total >= MIN_PACE_SEC && total <= MAX_PACE_SEC ? total : null;
  }

  function formatPace(sec) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function runMinutes(distanceKm, paceSec) {
    return Math.round((distanceKm * paceSec) / 60);
  }

  function durationKey(minutes) {
    const rounded = Math.max(KEY_STEP_MIN, Math.ceil(minutes / KEY_STEP_MIN) * KEY_STEP_MIN);
    if (rounded > MAX_KEY_MIN) return { key: String(MAX_KEY_MIN), fits: false };
    return { key: String(rounded), fits: true };
  }

  function pickResult(day, minutes) {
    const { key, fits } = durationKey(minutes);
    const window = day.windows[key] || null;
    if (window) return { kind: 'window', window, key, fits };
    if (key === FALLBACK_KEY && day.fallback) return { kind: 'fallback', window: day.fallback, key, fits };
    return { kind: 'none', window: null, key, fits };
  }

  function formatClock(iso, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(iso));
  }

  function skyOf(window) {
    const dry = window.qualifies && window.precipProbMax <= DRY_MAX_PROBABILITY;
    return dry ? 'dry' : `rain ${window.precipProbMax} %`;
  }

  function tempOf(window) {
    return `${Math.round(window.apparentTempAvg) || 0} °C`; // `|| 0` turns -0 into 0
  }

  function goLine(result, { minutes, dayLabel, timeZone }) {
    if (result.kind === 'none') return `No dry window of ${minutes} min ${dayLabel}`;
    const w = result.window;
    const from = formatClock(w.start, timeZone);
    if (result.kind === 'fallback') {
      return `Least bad: ${from}–${formatClock(w.end, timeZone)} · ${w.precipProbMax} % rain`;
    }
    if (!result.fits) {
      return `Best 3 h: ${from}–${formatClock(w.end, timeZone)} · ${skyOf(w)} · ${tempOf(w)}`;
    }
    const end = new Date(new Date(w.start).getTime() + minutes * 60000).toISOString();
    return `Go ${from}–${formatClock(end, timeZone)} · ${skyOf(w)} · ${tempOf(w)}`;
  }

  // Smallest angle between two compass bearings, 0..180.
  function angleBetween(a, b) {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  function windLine(summary, window) {
    if (window.windAvg < LITTLE_WIND_KMH) return 'Little wind';
    const wind = window.windFromCardinal;
    if (!summary || summary.shape === 'out-and-back') return `Start into the ${wind} wind`;
    if (summary.shape === 'loop') {
      const asDrawn = angleBetween(summary.startBearing, window.windFrom) <= HEADWIND_MAX_ANGLE;
      return `${asDrawn ? 'As drawn' : 'Reverse it'}: into the ${wind} wind first`;
    }
    const head = angleBetween(summary.overallBearing, window.windFrom) <= HEADWIND_MAX_ANGLE;
    return `${head ? 'Headwind' : 'Tailwind'} overall, wind from ${wind}`;
  }

  function routeLine(summary) {
    if (!summary) return null;
    const distance = `${summary.distanceKm.toFixed(1)} km`;
    return summary.climbM === null ? distance : `${distance} · +${summary.climbM} m`;
  }

  function offsetMinutes(timeZone, nowMs) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    }).formatToParts(new Date(nowMs));
    const get = type => Number(parts.find(part => part.type === type).value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - Math.floor(nowMs / 1000) * 1000) / 60000);
  }

  function zoneNote(locationTz, deviceTz, nowMs) {
    return offsetMinutes(locationTz, nowMs) === offsetMinutes(deviceTz, nowMs) ? null : `${locationTz} time`;
  }

  function apiUrl(origin, { lat, lon, hours, allowDark, rain }, { slots = false } = {}) {
    const dark = allowDark ? 'ok' : 'avoid';
    const query = `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&avail=${hours}&dark=${dark}&rain=${rain}`;
    return `${origin}/api/window?${query}${slots ? '&slots=1' : ''}`;
  }

  function errorMessage({ status, message, retryAfter }) {
    if (status === 400 && message) return message;
    if (status === 503 && message && retryAfter) return `${message} Try again in ${Math.ceil(retryAfter / 60)} min.`;
    return GENERIC_ERROR;
  }

  function staleNote(body) {
    const warnings = body && body.warnings;
    return Array.isArray(warnings) && warnings.includes('stale_data') ? 'Weather from up to 3 hours ago' : null;
  }

  const api = {
    DRY_MAX_PROBABILITY,
    parsePace,
    formatPace,
    runMinutes,
    durationKey,
    pickResult,
    formatClock,
    goLine,
    windLine,
    routeLine,
    zoneNote,
    apiUrl,
    errorMessage,
    staleNote
  };

  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.RunPlan = api;
})();
