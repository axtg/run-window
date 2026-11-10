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
  const CARDINAL_NAMES = {
    N: 'north',
    NE: 'north-east',
    E: 'east',
    SE: 'south-east',
    S: 'south',
    SW: 'south-west',
    W: 'west',
    NW: 'north-west'
  };

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

  // '7.0 km': the distance of a run of `minutes` at `paceSec` (seconds per km), to plan a route by.
  function planDistance(minutes, paceSec) {
    return `${((minutes * 60) / paceSec).toFixed(1)} km`;
  }

  // "Near you" opens OpenStreetMap at the rounded location the page sends to the API.
  function mapUrl(lat, lon) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=12/${lat}/${lon}`;
  }

  // The browser's accuracy (metres) past 5 km means a guess, as from an IP address: say so next to "Near you".
  const ROUGH_FROM_M = 5000;
  function roughNote(accuracyM) {
    if (!Number.isFinite(accuracyM) || accuracyM <= ROUGH_FROM_M) return '';
    return `· rough, ±${Math.round(accuracyM / 1000)} km`;
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

  // A word under the Wind and Feels numbers, from the whole values they show. Each list is [upper bound, word].
  const WIND_WORDS = [
    [5, 'calm'],
    [19, 'light'],
    [28, 'moderate'],
    [38, 'fresh'],
    [49, 'strong']
  ];
  const FEELS_WORDS = [
    [0, 'freezing'],
    [5, 'cold'],
    [16, 'ideal'],
    [22, 'warm'],
    [27, 'hot']
  ];

  function wordFor(words, value, top) {
    const found = words.find(([max]) => value <= max);
    return found ? found[1] : top;
  }

  function windWord(kmh) {
    return wordFor(WIND_WORDS, Math.round(kmh), 'very strong');
  }

  function feelsWord(celsius) {
    return wordFor(FEELS_WORDS, Math.round(celsius), 'very hot');
  }

  function tempOf(window) {
    return `${Math.round(window.apparentTempAvg) || 0} °C`; // `|| 0` turns -0 into 0
  }

  function goLine(result, { minutes, dayLabel, timeZone }) {
    if (result.kind === 'none') return noWindowText(minutes, dayLabel);
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

  function skyValue(window) {
    const sky = skyOf(window);
    return sky === 'dry' ? 'Dry' : `Rain${sky.slice('rain'.length)}`;
  }

  // A first prompt for an AI assistant with the MCP connector, from the page's settings. The place stays a placeholder:
  // the page never puts the location anywhere but its own request.
  const PROMPT_MIND = { wind: 'the wind', rain: 'rain', temp: 'the temperature' };
  const DEFAULT_RAIN_LIMIT = 40;
  function firstPrompt({ minutes, hours, prefer, allowDark, rain, day = 'today' }) {
    const when = String(hours)
      .split(',')
      .map(range => range.replace('-', '–'))
      .join(' or ');
    const parts = [
      `Using Best time to run, when is the best time ${day} for a ${minutes}-minute run near [your town]?`,
      `I can run ${when}.`
    ];
    if (PROMPT_MIND[prefer]) parts.push(`I mind ${PROMPT_MIND[prefer]} most.`);
    if (allowDark) parts.push('Running in the dark is fine.');
    if (rain !== DEFAULT_RAIN_LIMIT) parts.push(`Keep the chance of rain at or under ${rain} %.`);
    return parts.join(' ');
  }

  // The page's tint, from the shown window: wet, then dark, windy, cold, warm, else mild. Without a window, the time of
  // day on the device picks morning or evening. Names match the `data-sky` variants on <body> in index.html.
  const SKY_THEMES = ['mild', 'cold', 'warm', 'wet', 'windy', 'dark', 'morning', 'evening'];
  function skyTheme(result, day, localHour) {
    if (!result || result.kind === 'none') return localHour < 12 ? 'morning' : 'evening';
    const w = result.window;
    if (result.kind === 'fallback' || skyOf(w) !== 'dry') return 'wet';
    if (day && day.sunrise && day.sunset) {
      const outside = Date.parse(w.start) < Date.parse(day.sunrise) || Date.parse(w.end) > Date.parse(day.sunset);
      if (outside) return 'dark';
    }
    if (['fresh', 'strong', 'very strong'].includes(windWord(w.windAvg))) return 'windy';
    const feels = feelsWord(w.apparentTempAvg);
    if (feels === 'freezing' || feels === 'cold') return 'cold';
    if (feels === 'ideal') return 'mild';
    return 'warm';
  }

  // The rainbow under the header from /api/capacity: shorter and paler as today's new places are used, amber under
  // 10 %. Null when the answer is missing or malformed, so the page simply shows no bar.
  function quotaBar(capacity) {
    if (!capacity || typeof capacity.remainingShare !== 'number' || typeof capacity.full !== 'boolean') return null;
    const share = capacity.full ? 0 : Math.min(1, Math.max(0, capacity.remainingShare));
    const percent = Math.round(share * 100);
    const amber = share > 0 && share < 0.1;
    return {
      width: `${percent}%`,
      amber,
      opacity: amber ? '1' : (0.35 + 0.65 * share).toFixed(2),
      saturate: amber ? '1' : (0.15 + 0.85 * share).toFixed(2),
      label: capacity.full ? 'No new places left today' : `About ${percent} % of today's new places left`
    };
  }

  // Without a route the last number is the distance to plan for at the pace (`plan`, from planDistance); the run's
  // minutes are already in the answer's label.
  function keyNumbers(result, summary, minutes, plan = null) {
    if (result.kind === 'none') return [];
    const w = result.window;
    let last = { label: 'Run', value: `${minutes} min` };
    if (summary) last = { label: 'Climb', value: summary.climbM === null ? '–' : `+${summary.climbM} m` };
    else if (plan) last = { label: 'Plan', value: plan };
    return [
      { label: 'Sky', value: skyValue(w) },
      { label: 'Feels', value: tempOf(w), note: feelsWord(w.apparentTempAvg) },
      { label: 'Wind', value: `${Math.round(w.windAvg)} km/h ${w.windFromCardinal}`, note: windWord(w.windAvg) },
      last
    ];
  }

  // A key number split so the page can set its units smaller: '16 km/h E' → 16, ' km/h' (unit), ' E'.
  const UNIT = /(\s?(?:km\/h|km|°C|min|m|%)(?=\s|$))/;
  function valueParts(value) {
    return value
      .split(UNIT)
      .filter(Boolean)
      .map(text => ({ text, unit: UNIT.test(text) }));
  }

  function answerLabel(result, minutes) {
    if (result.kind === 'none') return '';
    if (result.kind === 'fallback') return `Least bad · ${minutes} min`;
    return result.fits ? `Best time · ${minutes} min` : 'Best 3 h · run is longer';
  }

  // The run's start and end in ms: the run itself when it fits the window, else the whole window it shows.
  function answerSpan(result, minutes) {
    const w = result.window;
    const startMs = new Date(w.start).getTime();
    if (result.kind === 'fallback' || !result.fits) return { startMs, endMs: new Date(w.end).getTime() };
    return { startMs, endMs: startMs + minutes * 60000 };
  }

  function answerTime(result, { minutes, timeZone }) {
    if (result.kind === 'none') return '';
    const { startMs, endMs } = answerSpan(result, minutes);
    const clock = ms => formatClock(new Date(ms).toISOString(), timeZone);
    return `${clock(startMs)}–${clock(endMs)}`;
  }

  // ---- Add to calendar. The event holds the answer only: no location, nothing from the route but its distance.

  function partOfDay(hour) {
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  // 'Sunday afternoon 10.4 km run', or '… 60 min run' without a route. Day and hour are the location's.
  function calendarEvent(result, summary, { minutes, timeZone, plan = null }) {
    if (result.kind === 'none') return null;
    const { startMs, endMs } = answerSpan(result, minutes);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      hour: 'numeric',
      hourCycle: 'h23'
    }).formatToParts(new Date(startMs));
    const weekday = parts.find(part => part.type === 'weekday').value;
    const hour = Number(parts.find(part => part.type === 'hour').value);
    const what = summary ? `${summary.distanceKm.toFixed(1)} km` : `${minutes} min`;
    const w = result.window;
    const wind = `Wind ${Math.round(w.windAvg)} km/h ${w.windFromCardinal}, ${windWord(w.windAvg)}`;
    const conditions = `${skyValue(w)} · Feels ${tempOf(w)}, ${feelsWord(w.apparentTempAvg)} · ${wind}`;
    return {
      title: `${weekday} ${partOfDay(hour)} ${what} run`,
      description: [plan ? `Plan ${plan}` : null, conditions, windLine(summary, w), 'Forecast from besttimetorun.com']
        .filter(Boolean)
        .join('\n'),
      startMs,
      endMs
    };
  }

  // Spaces as %20, not '+': not every calendar deeplink reads '+' as a space. A real '+' is already %2B.
  function calendarQuery(params) {
    return new URLSearchParams(params).toString().replace(/\+/g, '%20');
  }

  // Links that open a filled-in new event on the service's site, or its app on a phone. Chosen by the person, they
  // send the title, time and description to that service; never the location.
  function googleCalendarUrl(event) {
    const query = calendarQuery({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${icsStamp(event.startMs)}/${icsStamp(event.endMs)}`,
      details: event.description
    });
    return `https://calendar.google.com/calendar/render?${query}`;
  }

  function outlookCalendarUrl(event) {
    const query = calendarQuery({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: event.title,
      startdt: new Date(event.startMs).toISOString(),
      enddt: new Date(event.endMs).toISOString(),
      body: event.description
    });
    return `https://outlook.live.com/calendar/0/deeplink/compose?${query}`;
  }

  // Any other calendar app: an iCalendar file (RFC 5545), built in the browser. Times in UTC.
  function icsStamp(ms) {
    return new Date(ms)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  }

  function icsEscape(text) {
    return text.replace(/[\\;,]/g, match => `\\${match}`).replace(/\n/g, '\\n');
  }

  // RFC 5545 folds lines longer than 75 octets: CRLF and a space, never inside a UTF-8 character.
  function icsFold(line) {
    const encoder = new TextEncoder();
    const out = [];
    let current = '';
    let octets = 0;
    for (const char of line) {
      const size = encoder.encode(char).length;
      if (octets + size > (out.length ? 74 : 75)) {
        out.push(current);
        current = '';
        octets = 0;
      }
      current += char;
      octets += size;
    }
    out.push(current);
    return out.join('\r\n ');
  }

  function icsText(event, { uid, nowMs }) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//besttimetorun.com//Best time to run//EN',
      'BEGIN:VEVENT',
      `UID:${uid}@besttimetorun.com`,
      `DTSTAMP:${icsStamp(nowMs)}`,
      `DTSTART:${icsStamp(event.startMs)}`,
      `DTEND:${icsStamp(event.endMs)}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape(event.description)}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return `${lines.map(icsFold).join('\r\n')}\r\n`;
  }

  // Under today's "no dry window": what tomorrow holds for the same run, or null when it holds nothing.
  function tomorrowHint(result, { minutes, timeZone }) {
    if (result.kind === 'none') return null;
    const time = answerTime(result, { minutes, timeZone });
    if (result.kind === 'fallback') return `Tomorrow: least bad ${time}`;
    const sky = skyOf(result.window);
    return sky === 'dry' ? `Tomorrow ${time} is dry` : `Tomorrow ${time}, ${sky}`;
  }

  // ---- The three days: today, tomorrow and the day after, named by the location's own dates ('2026-11-04').
  const weekday = (date, style) =>
    new Intl.DateTimeFormat('en-US', { weekday: style, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const dayButton = date => weekday(date, 'short');
  function dayLabel(index, date) {
    if (index === 0) return 'today';
    if (index === 1) return 'tomorrow';
    return `on ${weekday(date, 'long')}`;
  }
  // The day after tomorrow is as far as the page looks: past that a forecast shifts too much to plan an hour on.
  const OUTLOOK_NOTE = 'Two days out, the forecast can still shift: check again on the day.';
  const outlookNote = index => (index >= 2 ? OUTLOOK_NOTE : null);

  // The longest run of back-to-back slots whose status is one of `statuses`, in minutes.
  function longestStretch(slots, statuses) {
    let longest = 0;
    let current = 0;
    slots.forEach((slot, index) => {
      const joined = index > 0 && Date.parse(slot.start) - Date.parse(slots[index - 1].start) === KEY_STEP_MIN * 60000;
      if (!statuses.includes(slot.status)) current = 0;
      else current = joined ? current + 1 : 1;
      longest = Math.max(longest, current);
    });
    return longest * KEY_STEP_MIN;
  }

  // Why no window fits, from the API's slot statuses (past, then dark, then missing, then rain, as lib/windows.js
  // tags them), so the answer never blames rain when the hours have simply gone by. `minutesLeft` is the longest
  // stretch that is still ahead, in daylight (when that is asked) and forecast, wet or dry.
  function noWindowCause(slots, minutes) {
    const statuses = new Set(slots.map(slot => slot.status));
    const minutesLeft = longestStretch(slots, ['ok', 'rain']);
    let cause = 'rain';
    if (slots.length > 0 && slots.every(slot => slot.status === 'past')) cause = 'past';
    else if (minutesLeft < minutes) cause = 'time';
    return {
      cause,
      minutesLeft,
      past: statuses.has('past'),
      dark: statuses.has('dark'),
      missing: statuses.has('missing')
    };
  }

  // The answer's line when nothing fits. Without a cause (or with rain as the cause) it is the dry-window line.
  function noWindowText(minutes, dayLabel, cause = null) {
    if (cause && cause.cause === 'past') return `Your hours ${dayLabel} have passed`;
    if (cause && cause.cause === 'time') {
      const left = cause.minutesLeft;
      if (cause.dark && !cause.past) {
        return left === 0
          ? `No daylight in your hours ${dayLabel}`
          : `Only ${left} min of daylight in your hours ${dayLabel}`;
      }
      const what = cause.dark ? 'left in daylight' : 'left';
      return `Only ${left} min ${what} in your hours ${dayLabel}`;
    }
    return `No dry window of ${minutes} min ${dayLabel}`;
  }

  // Smallest angle between two compass bearings, 0..180.
  function angleBetween(a, b) {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  function windLine(summary, window) {
    if (window.windAvg < LITTLE_WIND_KMH) return 'Little wind';
    const wind = CARDINAL_NAMES[window.windFromCardinal] || window.windFromCardinal;
    if (!summary || summary.shape === 'out-and-back') return `Wind from the ${wind} · start ${wind}, into it`;
    if (summary.shape === 'loop') {
      const asDrawn = angleBetween(summary.startBearing, window.windFrom) <= HEADWIND_MAX_ANGLE;
      return `${asDrawn ? 'As drawn' : 'Reverse it'}: ${wind} into the wind first`;
    }
    const head = angleBetween(summary.overallBearing, window.windFrom) <= HEADWIND_MAX_ANGLE;
    return `${head ? 'Headwind' : 'Tailwind'} overall, wind from the ${wind}`;
  }

  // The compass arrow's bearing: where the wind blows to, as on a weather map, so the run starts against it. None in
  // little wind.
  function windArrowDeg(window) {
    if (window.windAvg < LITTLE_WIND_KMH) return null;
    return (Math.round(window.windFrom) + 180) % 360;
  }

  function routeLine(summary) {
    if (!summary) return null;
    const distance = `${summary.distanceKm.toFixed(1)} km`;
    return summary.climbM === null ? distance : `${distance} · +${summary.climbM} m`;
  }

  function apiUrl(origin, { lat, lon, hours, allowDark, prefer, rain }, { slots = false } = {}) {
    const dark = allowDark ? 'ok' : 'avoid';
    const where = `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
    const query = `${where}&avail=${hours}&dark=${dark}&rain=${rain}&prefer=${prefer}`;
    return `${origin}/api/window?${query}${slots ? '&slots=1' : ''}`;
  }

  // The line under Mind most: what the choice trades when the day can't be good on every count.
  const PREFER_HINTS = {
    balanced: 'Wind, rain and temperature count the same.',
    wind: 'Calmer times win, even if colder or wetter.',
    rain: 'Drier times win, even if windier or colder.',
    temp: 'Times nearer 6–16 °C feels-like win, even if windier or wetter.'
  };

  function preferHint(prefer) {
    return PREFER_HINTS[prefer] || PREFER_HINTS.balanced;
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
    planDistance,
    durationKey,
    pickResult,
    formatClock,
    goLine,
    windLine,
    windArrowDeg,
    preferHint,
    windWord,
    feelsWord,
    keyNumbers,
    mapUrl,
    roughNote,
    valueParts,
    answerLabel,
    answerTime,
    calendarEvent,
    googleCalendarUrl,
    outlookCalendarUrl,
    icsText,
    noWindowText,
    noWindowCause,
    dayButton,
    dayLabel,
    outlookNote,
    tomorrowHint,
    routeLine,
    apiUrl,
    errorMessage,
    staleNote,
    SKY_THEMES,
    firstPrompt,
    skyTheme,
    quotaBar
  };

  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.RunPlan = api;
})();
