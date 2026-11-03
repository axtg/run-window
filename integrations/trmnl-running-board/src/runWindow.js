const { STRINGS, fill, cardinalText, conditionsText } = require('./strings');
const { localDate, localTime, addDays, availabilityEnd } = require('./time');
const { planDay, matchesSport } = require('./week');

const SESSION_STEP_MINUTES = 15;
const MAX_SESSION_MINUTES = 180;
const DEFAULT_SESSION_MINUTES = 60;
const FALLBACK_MINUTES = 60;
const STALE_WARNING = 'stale_data';
const EN_DASH = '–';
const HEADING_SEPARATOR = ' · ';

// Plans of the sport on that local day, not yet done, earliest first
function remainingPlans(plans, date, tz, sport) {
  return plans
    .filter(item => item && Number.isFinite(Date.parse(item.date)))
    .filter(item => matchesSport(item, sport) && !item.executedTrainingId && planDay(item, tz) === date)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

// `duration` is in seconds; never estimated from distance
function sessionLength(planned) {
  const seconds = planned.duration;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { minutes: DEFAULT_SESSION_MINUTES, reason: 'noDuration', overLimit: false };
  }
  const rounded = Math.max(SESSION_STEP_MINUTES, Math.ceil(seconds / 60 / SESSION_STEP_MINUTES) * SESSION_STEP_MINUTES);
  if (rounded > MAX_SESSION_MINUTES) return { minutes: MAX_SESSION_MINUTES, reason: 'planned', overLimit: true };
  return { minutes: rounded, reason: 'planned', overLimit: false };
}

function pickSession({ plans, now, tz, avail, sport = 'running' }) {
  const today = localDate(now, tz);
  const tomorrow = addDays(today, 1);
  const pastToday = now > availabilityEnd(avail, today, tz);
  const choose = (day, details) => ({ day, date: day === 'today' ? today : tomorrow, ...details });
  const unplanned = reason => ({ minutes: DEFAULT_SESSION_MINUTES, reason, overLimit: false });

  if (!Array.isArray(plans)) return choose(pastToday ? 'tomorrow' : 'today', unplanned('unknown'));

  const leftToday = remainingPlans(plans, today, tz, sport);
  if (!pastToday && leftToday.length > 0) return choose('today', sessionLength(leftToday[0]));

  const nextDay = remainingPlans(plans, tomorrow, tz, sport);
  if (nextDay.length > 0) return choose('tomorrow', sessionLength(nextDay[0]));

  const plannedToday = plans.some(
    item => item && Number.isFinite(Date.parse(item.date)) && matchesSport(item, sport) && planDay(item, tz) === today
  );
  return choose(!pastToday && !plannedToday ? 'today' : 'tomorrow', unplanned('noPlan'));
}

// The API contract's compass points
const WIND_CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// A window the screen can print in full; anything less counts as missing, so the next option is used
function readableWindow(value) {
  if (!value || typeof value !== 'object') return null;
  const readable =
    Number.isFinite(Date.parse(value.start)) &&
    Number.isFinite(Date.parse(value.end)) &&
    Number.isFinite(value.precipProbMax) &&
    Number.isFinite(value.windAvg) &&
    Number.isFinite(value.apparentTempAvg) &&
    WIND_CARDINALS.includes(value.windFromCardinal);
  return readable ? value : null;
}

// The session's own window, else the longest shorter one, else the API's fallback
function chooseWindow(day, minutes) {
  const windows = day.windows && typeof day.windows === 'object' ? day.windows : {};
  const exact = readableWindow(windows[String(minutes)]);
  if (exact) return { kind: 'window', window: exact, minutes };
  for (let length = minutes - SESSION_STEP_MINUTES; length >= SESSION_STEP_MINUTES; length -= SESSION_STEP_MINUTES) {
    const shorter = readableWindow(windows[String(length)]);
    if (shorter) return { kind: 'shorter', window: shorter, minutes: length };
  }
  const fallback = readableWindow(day.fallback);
  if (fallback) return { kind: 'fallback', window: fallback, minutes: FALLBACK_MINUTES };
  return { kind: 'none', window: null, minutes };
}

function sessionHeading(session, text) {
  const dayWord = session.day === 'tomorrow' ? text.headingTomorrow : text.headingToday;
  let length = fill(text.minutes, { n: session.minutes });
  if (session.reason === 'noDuration') length += ` ${text.noDuration}`;
  if (session.reason === 'noPlan') length += `${HEADING_SEPARATOR}${text.noSession}`;
  if (session.overLimit) length += `${HEADING_SEPARATOR}${text.doesntFit}`;
  return `${dayWord}${HEADING_SEPARATOR}${length}`;
}

// The non-window kinds replace the length; "BEST TIME TODAY" would contradict them, TOMORROW still matters
function fallbackHeading(session, phrase, text) {
  return session.day === 'tomorrow' ? `${text.headingTomorrow}${HEADING_SEPARATOR}${phrase}` : phrase;
}

function windowHeading(choice, session, text) {
  if (choice.kind === 'window') return sessionHeading(session, text);
  if (choice.kind === 'shorter') return fallbackHeading(session, fill(text.onlyFits, { n: choice.minutes }), text);
  if (choice.kind === 'fallback') return fallbackHeading(session, text.noDryFallback, text);
  return fallbackHeading(session, text.noDryWindow, text);
}

function windowLines(choice, day, body, lang, text) {
  const tz = body.location && body.location.timezone;
  const lines = [];
  const chosen = choice.window;
  if (chosen) {
    const start = localTime(Date.parse(chosen.start), tz);
    const end = localTime(Date.parse(chosen.end), tz);
    const conditions = conditionsText(chosen, lang);
    lines.push(`${start}${EN_DASH}${end}`);
    lines.push([conditions.sky, conditions.wind, conditions.temp].join(HEADING_SEPARATOR));
    if (chosen.windFromCardinal) {
      lines.push(fill(text.windStart, { cardinal: cardinalText(chosen.windFromCardinal, lang) }));
    }
    if (day.sunset && Number.isFinite(Date.parse(day.sunset))) {
      lines.push(fill(text.darkAfter, { time: localTime(Date.parse(day.sunset), tz) }));
    }
  }
  if (Array.isArray(body.warnings) && body.warnings.includes(STALE_WARNING)) lines.push(text.weatherStale);
  return lines;
}

function windowPanel({ body, status, session, lang, hasLocation }) {
  const language = STRINGS[lang] ? lang : 'en';
  const text = STRINGS[language];
  const message = (kind, heading) => ({ kind, heading, lines: [] });

  if (!hasLocation) return message('noLocation', text.setLocation);
  if (!body || typeof body !== 'object' || !Array.isArray(body.days)) {
    return status === 400 ? message('badSettings', text.checkHours) : message('error', text.weatherUnavailable);
  }
  const day = body.days.find(entry => entry && typeof entry === 'object' && entry.date === session.date);
  if (!day) return message('error', text.weatherUnavailable);

  const choice = chooseWindow(day, session.minutes);
  return {
    kind: choice.kind,
    heading: windowHeading(choice, session, text),
    lines: windowLines(choice, day, body, language, text)
  };
}

module.exports = { pickSession, windowPanel };
