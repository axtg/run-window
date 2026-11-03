const { STRINGS, fill, formatKm, formatDuration, formatPace } = require('./strings');
const { localDate, weekDates, isoWeek } = require('./time');

const ITEMS_PER_DAY = 2;
const GARMIN_FALLBACK = 'Garmin';
const SPORT_KEYS = {
  running: 'sportRunning',
  cycling: 'sportCycling',
  swimming: 'sportSwimming',
  strength: 'sportStrength'
};

const isPositive = value => Number.isFinite(value) && value > 0;

function isZone(value) {
  if (typeof value !== 'string' || value === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// A plan's numeric `timezone` is an offset fixed when it was made (wrong across DST), so the user's zone decides
function planDay(plan, tz) {
  return localDate(Date.parse(plan.date), tz);
}

function activityDay(activity, tz) {
  return localDate(Date.parse(activity.date), isZone(activity.timezone) ? activity.timezone : tz);
}

const matchesSport = (entry, sport) => sport === 'all' || entry.sportType === sport;

// Copies only the fields the screen needs: never the summary (it holds start coordinates)
function weekItem(kind, title, sportType, metrics) {
  const item = { kind, title: typeof title === 'string' ? title : '', sportType: String(sportType ?? '') };
  for (const [key, value] of Object.entries(metrics)) {
    if (isPositive(value)) item[key] = value;
  }
  return item;
}

function activityMetrics(activity) {
  const summary = activity.summary && typeof activity.summary === 'object' ? activity.summary : {};
  const distanceM = summary.distance;
  const durationS = summary.duration;
  let paceSPerKm = summary.pace;
  if (!isPositive(paceSPerKm) && isPositive(distanceM) && isPositive(durationS)) {
    paceSPerKm = durationS / (distanceM / 1000);
  }
  if (!isPositive(distanceM)) paceSPerKm = undefined;
  return { distanceM, durationS, paceSPerKm, heartrate: summary.heartrate };
}

function buildWeek({ plans, activities, now, tz, sport = 'running' }) {
  const today = localDate(now, tz);
  const dates = weekDates(today);
  const byDate = new Map(dates.map(date => [date, []]));
  const totals = { doneDistanceM: 0, doneDurationS: 0 };
  let plannedDistanceM = 0;
  let plannedDurationS = 0;
  let planCount = 0;

  const seen = (Array.isArray(activities) ? activities : []).filter(activity => {
    if (!activity || typeof activity !== 'object') return false;
    const at = Date.parse(activity.date);
    return Number.isFinite(at) && at <= now;
  });
  const activityById = new Map(seen.filter(activity => activity.id).map(activity => [activity.id, activity]));
  const used = new Set();

  const addDone = (date, at, item, activity) => {
    byDate.get(date).push({ at, item, activity });
    totals.doneDistanceM += item.distanceM || 0;
    totals.doneDurationS += item.durationS || 0;
  };

  for (const plan of Array.isArray(plans) ? plans : []) {
    if (!plan || typeof plan !== 'object' || !matchesSport(plan, sport)) continue;
    const at = Date.parse(plan.date);
    if (!Number.isFinite(at)) continue;
    const date = planDay(plan, tz);
    if (!byDate.has(date)) continue;
    planCount += 1;
    if (isPositive(plan.distance)) plannedDistanceM += plan.distance;
    if (isPositive(plan.duration)) plannedDurationS += plan.duration;

    const activity = plan.executedTrainingId ? activityById.get(plan.executedTrainingId) : undefined;
    if (activity) {
      used.add(activity);
      const item = weekItem('done', plan.title, activity.sportType, activityMetrics(activity));
      addDone(date, Date.parse(activity.date), item, activity);
      continue;
    }
    const planned = { distanceM: plan.distance, durationS: plan.duration };
    let kind = 'planned';
    if (date < today) kind = plan.executedTrainingId ? 'done' : 'missed';
    const item =
      kind === 'done'
        ? weekItem(kind, plan.title, plan.sportType, {})
        : weekItem(kind, plan.title, plan.sportType, planned);
    byDate.get(date).push({ at, item });
  }

  for (const activity of seen) {
    if (used.has(activity) || !matchesSport(activity, sport)) continue;
    const date = activityDay(activity, tz);
    if (!byDate.has(date)) continue;
    addDone(
      date,
      Date.parse(activity.date),
      weekItem('unplanned', activity.title, activity.sportType, activityMetrics(activity)),
      activity
    );
  }

  const garmin = [];
  const days = dates.map(date => {
    const entries = byDate.get(date).sort((a, b) => a.at - b.at);
    const shown = entries.slice(0, ITEMS_PER_DAY);
    for (const { activity } of shown) {
      if (!activity || activity.isFromGarminApi !== true) continue;
      const text =
        typeof activity.attribution === 'string' && activity.attribution.trim()
          ? activity.attribution
          : GARMIN_FALLBACK;
      if (!garmin.includes(text)) garmin.push(text);
    }
    return {
      date,
      isToday: date === today,
      isPast: date < today,
      items: shown.map(entry => entry.item),
      more: entries.length - shown.length
    };
  });

  if (planCount > 0) {
    totals.plannedDistanceM = plannedDistanceM;
    totals.plannedDurationS = plannedDurationS;
  }
  return { week: isoWeek(today), days, totals, garmin };
}

function itemTitle(item, text) {
  if (item.title.trim() !== '') return item.title;
  return text[SPORT_KEYS[item.sportType] || 'sportOther'];
}

const minutesText = (seconds, text) => {
  const minutes = Math.round(seconds / 60);
  return minutes > 0 ? fill(text.minutes, { n: minutes }) : '';
};

function itemText(item, lang, text) {
  const parts = [];
  if (item.kind === 'done' || item.kind === 'unplanned') {
    if (item.distanceM) {
      parts.push(`${formatKm(item.distanceM, lang)} km`);
      if (item.paceSPerKm) parts.push(formatPace(item.paceSPerKm));
    } else {
      parts.push(itemTitle(item, text));
      if (item.durationS) parts.push(minutesText(item.durationS, text));
    }
    if (item.heartrate) parts.push(String(Math.round(item.heartrate)));
    return `✓ ${parts.filter(Boolean).join(' · ')}`;
  }
  parts.push(itemTitle(item, text));
  if (item.durationS) parts.push(minutesText(item.durationS, text));
  else if (item.distanceM) parts.push(`${formatKm(item.distanceM, lang)} km`);
  const plain = parts.filter(Boolean).join(' · ');
  return item.kind === 'missed' ? `✗ ${plain}` : plain;
}

function weekFooter(totals, lang) {
  const doneKm = formatKm(totals.doneDistanceM, lang);
  const doneTime = formatDuration(totals.doneDurationS);
  // A planned half is left out when nothing planned has that value, so it never reads "/ 0:00" or "/ 0.0 km"
  const km = isPositive(totals.plannedDistanceM) ? `${doneKm} / ${formatKm(totals.plannedDistanceM, lang)}` : doneKm;
  const time = isPositive(totals.plannedDurationS)
    ? `${doneTime} / ${formatDuration(totals.plannedDurationS)}`
    : doneTime;
  return `${km} km · ${time}`;
}

// Text stays verbatim: escaping is the markup's job
function weekView(week, lang) {
  const language = STRINGS[lang] ? lang : 'en';
  const text = STRINGS[language];
  return {
    title: `${text.week} ${week.week}`,
    days: week.days.map((day, index) => ({
      label: text.days[index],
      today: day.isToday,
      items: day.items.map(item => ({ kind: item.kind, text: itemText(item, language, text) })),
      more: day.more > 0 ? `+${day.more}` : ''
    })),
    footer: weekFooter(week.totals, language),
    garmin: week.garmin.slice()
  };
}

module.exports = { isZone, planDay, activityDay, matchesSport, buildWeek, weekView };
