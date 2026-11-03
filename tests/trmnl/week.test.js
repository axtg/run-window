const { planDay, activityDay, buildWeek, weekView } = require('../../integrations/trmnl-running-board/src/week');

const AMS = 'Europe/Amsterdam';
const ms = iso => Date.parse(iso);
const plannedWeek = require('../fixtures/tredict/planned-week.json')._embedded.plannedWorkoutList;
const activitiesWeek = require('../fixtures/tredict/activities-week.json')._embedded.activityList;
const plannedDst = require('../fixtures/tredict/planned-dst.json')._embedded.plannedWorkoutList;
const activitiesDst = require('../fixtures/tredict/activities-dst.json')._embedded.activityList;

const WEDNESDAY_NOON = ms('2026-11-04T11:00:00Z');
const MONDAY_MORNING = ms('2026-11-02T06:00:00Z');
const SUNDAY_EVENING = ms('2026-11-08T20:00:00Z');
const DST_SUNDAY_LATE = ms('2026-10-25T22:45:00Z');

const week = (now, sport = 'running', plans = plannedWeek, activities = activitiesWeek) =>
  buildWeek({ plans, activities, now, tz: AMS, sport });
const titles = day => day.items.map(item => item.title);
const allItems = result => result.days.flatMap(day => day.items);

describe('planDay and activityDay', () => {
  it('puts the 23:30 Sunday activity on Sunday and the 00:30 Monday one on Monday (Review Focus 3)', () => {
    expect(activityDay(activitiesWeek[0], AMS)).toBe('2026-11-01');
    expect(activityDay(activitiesWeek[1], AMS)).toBe('2026-11-02');
  });

  it('puts both 25 Oct activities on Sunday 25 Oct across the DST change (Review Focus 3)', () => {
    expect(activityDay(activitiesDst[1], AMS)).toBe('2026-10-25');
    expect(activityDay(activitiesDst[2], AMS)).toBe('2026-10-25');
  });

  it("uses the user's IANA zone for a plan and ignores its numeric timezone (Review Focus 3)", () => {
    const plan = { id: 'SynPlanX', date: '2026-10-25T22:30:00.000Z', timezone: 2, sportType: 'running', title: 'X' };
    expect(planDay(plan, AMS)).toBe('2026-10-25');
  });

  it("uses an activity's own zone, else the user's", () => {
    const activity = { date: '2026-11-04T23:30:00.000Z', timezone: 'America/New_York' };
    expect(activityDay(activity, AMS)).toBe('2026-11-04');
    expect(activityDay({ date: activity.date }, AMS)).toBe('2026-11-05');
    expect(activityDay({ date: activity.date, timezone: 1 }, AMS)).toBe('2026-11-05');
    expect(activityDay({ date: activity.date, timezone: 'Not/AZone' }, AMS)).toBe('2026-11-05');
  });
});

describe('buildWeek on Wednesday 2026-11-04 12:00', () => {
  const result = week(WEDNESDAY_NOON);

  it('covers the ISO week with today and past flags', () => {
    expect(result.week).toBe(45);
    expect(result.days.map(day => day.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08'
    ]);
    expect(result.days.map(day => day.isToday)).toEqual([false, false, true, false, false, false, false]);
    expect(result.days.map(day => day.isPast)).toEqual([true, true, false, false, false, false, false]);
  });

  it('shows the Monday plan as done with distance, pace and heart rate', () => {
    const done = result.days[0].items.find(item => item.kind === 'done');
    expect(done).toEqual({
      kind: 'done',
      title: 'Easy run',
      sportType: 'running',
      distanceM: 8000,
      durationS: 2760,
      paceSPerKm: 345,
      heartrate: 142
    });
  });

  it('puts the 00:30 Monday activity on Monday as unplanned and leaves the 23:30 Sunday one out', () => {
    expect(result.days[0].items.map(item => [item.kind, item.title])).toEqual([
      ['unplanned', 'Dawn run'],
      ['done', 'Easy run']
    ]);
    expect(allItems(result).map(item => item.title)).not.toContain('Night run');
  });

  it('marks the past plan without an executed training as missed', () => {
    expect(result.days[1].items).toEqual([
      { kind: 'missed', title: 'Missed tempo', sportType: 'running', distanceM: 10000, durationS: 3000 }
    ]);
  });

  it('shows the run without a plan as unplanned', () => {
    expect(result.days[2].items.map(item => [item.kind, item.title])).toEqual([['unplanned', 'Unplanned run']]);
  });

  it('shows at most 2 items on Thursday and counts the rest in more', () => {
    expect(titles(result.days[3])).toEqual(['Threshold run', 'Recovery run']);
    expect(result.days[3].more).toBe(1);
    expect(result.days.filter(day => day !== result.days[3]).every(day => day.more === 0)).toBe(true);
  });

  it('keeps future plans planned, even when the matched activity is later than now', () => {
    expect(result.days[6].items.map(item => [item.kind, item.title])).toEqual([['planned', 'Sunday long run']]);
  });

  it('never gives a plan a pace, and leaves out a missing duration', () => {
    const plans = allItems(result).filter(item => item.kind === 'planned' || item.kind === 'missed');
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every(item => !('paceSPerKm' in item) && !('heartrate' in item))).toBe(true);
    const distanceOnly = result.days[5].items.find(item => item.title === 'Distance only');
    expect(distanceOnly).toEqual({ kind: 'planned', title: 'Distance only', sportType: 'running', distanceM: 12000 });
  });

  it('leaves out the heart rate of an activity without one', () => {
    const dawn = result.days[0].items[0];
    expect(dawn).toEqual({
      kind: 'unplanned',
      title: 'Dawn run',
      sportType: 'running',
      distanceM: 4200,
      durationS: 1500,
      paceSPerKm: 357
    });
  });

  it('totals done activities and all plans of the filtered sport', () => {
    expect(result.totals).toEqual({
      doneDistanceM: 4200 + 8000 + 6500,
      doneDurationS: 1500 + 2760 + 2200,
      plannedDistanceM: 8000 + 10000 + 9000 + 5000 + 4000 + 12000 + 7000 + 16000,
      plannedDurationS: 2700 + 3000 + 2900 + 1800 + 1500 + 2400 + 5400
    });
  });

  it('counts an activity once when two plans point at it', () => {
    const twin = { ...plannedWeek[0], id: 'SynPlanTwinxxxxxxxxxxx', title: 'Twin run' };
    const doubled = week(WEDNESDAY_NOON, 'running', [...plannedWeek, twin]);
    expect(doubled.totals.doneDistanceM).toBe(result.totals.doneDistanceM);
    expect(doubled.totals.doneDurationS).toBe(result.totals.doneDurationS);
    const withMetrics = doubled.days[0].items.filter(item => item.kind === 'done' && item.distanceM);
    expect(withMetrics).toHaveLength(1);
  });

  it('lists the Garmin attribution of a shown Garmin activity once', () => {
    expect(result.garmin).toEqual(['Synthetic Garmin attribution text']);
  });

  it('drops the strength session with sport running and keeps it with all', () => {
    expect(titles(result.days[2])).not.toContain('Strength');
    const all = week(WEDNESDAY_NOON, 'all');
    expect(all.days[2].items.map(item => [item.kind, item.title])).toEqual([
      ['unplanned', 'Unplanned run'],
      ['planned', 'Strength']
    ]);
    expect(all.totals.plannedDurationS).toBe(result.totals.plannedDurationS + 3000);
    expect(all.totals.plannedDistanceM).toBe(result.totals.plannedDistanceM);
  });
});

describe('buildWeek on other days', () => {
  it('Monday 07:00: nothing missed, done totals only the 00:30 activity', () => {
    const result = week(MONDAY_MORNING);
    expect(allItems(result).some(item => item.kind === 'missed')).toBe(false);
    expect(result.days[0].items.map(item => [item.kind, item.title])).toEqual([
      ['unplanned', 'Dawn run'],
      ['planned', 'Easy run']
    ]);
    expect(result.totals.doneDistanceM).toBe(4200);
    expect(result.totals.doneDurationS).toBe(1500);
    expect(result.garmin).toEqual([]);
  });

  it('Sunday 21:00: every plan is done or missed, nothing is planned', () => {
    const result = week(SUNDAY_EVENING);
    const items = allItems(result);
    expect(items.some(item => item.kind === 'planned')).toBe(false);
    expect(result.days[6].items.map(item => [item.kind, item.title])).toEqual([['done', 'Sunday long run']]);
    expect(result.days[3].items.map(item => item.kind)).toEqual(['missed', 'missed']);
    expect(result.days[3].more).toBe(1);
  });

  it('Sunday 21:00 with all sports: the strength session is done with its duration and heart rate', () => {
    const result = week(SUNDAY_EVENING, 'all');
    const strength = result.days[2].items.find(item => item.title === 'Strength');
    expect(strength).toEqual({ kind: 'done', title: 'Strength', sportType: 'misc', durationS: 3000, heartrate: 112 });
    expect(result.totals.doneDurationS).toBe(week(SUNDAY_EVENING).totals.doneDurationS + 3000);
  });

  it('DST week: both 25 Oct activities land on Sunday 25 Oct (Review Focus 3)', () => {
    const result = week(DST_SUNDAY_LATE, 'running', plannedDst, activitiesDst);
    expect(result.week).toBe(43);
    expect(result.days[6].date).toBe('2026-10-25');
    expect(result.days[6].items.map(item => [item.kind, item.title])).toEqual([
      ['unplanned', 'Sunday 00:30 CEST run'],
      ['done', 'Sunday run']
    ]);
    expect(result.days[6].items[1].distanceM).toBe(6000);
    expect(allItems(result).map(item => item.title)).not.toContain('Monday after');
  });

  it('DST week: a plan at 2026-10-25T22:30Z with timezone 2 is on Sunday 25 Oct (Review Focus 3)', () => {
    const plan = {
      id: 'SynPlanLate',
      date: '2026-10-25T22:30:00.000Z',
      timezone: 2,
      sportType: 'running',
      title: 'Late plan',
      duration: 1800
    };
    const result = week(DST_SUNDAY_LATE, 'running', [plan], []);
    expect(result.days[6].items).toEqual([
      { kind: 'planned', title: 'Late plan', sportType: 'running', durationS: 1800 }
    ]);
  });

  it('keeps only the chosen sport: cycling keeps only cycling', () => {
    const ride = {
      id: 'SynActRide',
      date: '2026-11-03T16:00:00.000Z',
      timezone: 'Europe/Amsterdam',
      sportType: 'cycling',
      title: 'Ride',
      summary: { distance: 20000, duration: 2400 }
    };
    const ridePlan = { date: '2026-11-05T16:00:00.000Z', sportType: 'cycling', title: 'Ride plan', duration: 3600 };
    const result = week(WEDNESDAY_NOON, 'cycling', [...plannedWeek, ridePlan], [...activitiesWeek, ride]);
    expect(allItems(result).map(item => [item.kind, item.title])).toEqual([
      ['unplanned', 'Ride'],
      ['planned', 'Ride plan']
    ]);
    expect(result.totals).toEqual({
      doneDistanceM: 20000,
      doneDurationS: 2400,
      plannedDistanceM: 0,
      plannedDurationS: 3600
    });
  });

  it('defaults to running when no sport is given', () => {
    const result = buildWeek({ plans: plannedWeek, activities: activitiesWeek, now: WEDNESDAY_NOON, tz: AMS });
    expect(result.totals).toEqual(week(WEDNESDAY_NOON).totals);
  });

  it('ignores activities after now', () => {
    const result = week(ms('2026-11-02T06:59:00Z'));
    expect(result.days[0].items.map(item => item.title)).toEqual(['Dawn run', 'Easy run']);
    expect(result.days[0].items[1].kind).toBe('planned');
  });

  it('empty plans and activities: 7 days, no items, zero done totals (Review Focus 4)', () => {
    const result = week(WEDNESDAY_NOON, 'running', [], []);
    expect(result.days).toHaveLength(7);
    expect(result.days.every(day => day.items.length === 0 && day.more === 0)).toBe(true);
    expect(result.totals).toEqual({ doneDistanceM: 0, doneDurationS: 0 });
    expect(result.garmin).toEqual([]);
  });

  it('survives garbage entries', () => {
    const result = buildWeek({
      plans: [null, {}, { date: 'nope' }, 'x'],
      activities: [null, {}, { date: 'nope' }],
      now: WEDNESDAY_NOON,
      tz: AMS,
      sport: 'all'
    });
    expect(result.days.every(day => day.items.length === 0)).toBe(true);
    const missing = buildWeek({ plans: undefined, activities: undefined, now: WEDNESDAY_NOON, tz: AMS });
    expect(missing.days).toHaveLength(7);
  });
});

describe('weekView', () => {
  const view = weekView(week(WEDNESDAY_NOON), 'en');

  it('prints the title, the day labels and the today flag', () => {
    expect(view.title).toBe('WEEK 45');
    expect(view.days.map(day => day.label)).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    expect(view.days.map(day => day.today)).toEqual([false, false, true, false, false, false, false]);
    expect(weekView(week(WEDNESDAY_NOON), 'nl').days.map(day => day.label)).toEqual([
      'ma',
      'di',
      'wo',
      'do',
      'vr',
      'za',
      'zo'
    ]);
  });

  it('prints done, unplanned, missed and planned items', () => {
    expect(view.days[0].items).toEqual([
      { kind: 'unplanned', text: '✓ 4.2 km · 5:57' },
      { kind: 'done', text: '✓ 8.0 km · 5:45 · 142' }
    ]);
    expect(view.days[1].items).toEqual([{ kind: 'missed', text: '✗ Missed tempo · 50 min' }]);
    expect(view.days[3].items).toEqual([
      { kind: 'planned', text: 'Threshold run · 48 min' },
      { kind: 'planned', text: 'Recovery run · 30 min' }
    ]);
    expect(view.days[5].items[0]).toEqual({ kind: 'planned', text: 'Distance only · 12.0 km' });
  });

  it('prints more as +N or an empty string', () => {
    expect(view.days.map(day => day.more)).toEqual(['', '', '', '+1', '', '', '']);
  });

  it('prints the footer as done / planned distance and time', () => {
    expect(view.footer).toBe('18.7 / 71.0 km · 1:48 / 5:28');
    expect(weekView(week(WEDNESDAY_NOON), 'nl').footer).toBe('18,7 / 71,0 km · 1:48 / 5:28');
  });

  it('prints done-only totals when nothing is planned', () => {
    const doneOnly = weekView(week(WEDNESDAY_NOON, 'running', [], activitiesWeek), 'en');
    expect(doneOnly.footer).toBe('18.7 km · 1:48');
  });

  it('leaves out the planned half of a footer pair whose planned total is 0', () => {
    const plan = fields => ({ date: '2026-11-06T07:00:00.000Z', sportType: 'running', title: 'P', ...fields });
    const footer = plans => weekView(week(WEDNESDAY_NOON, 'running', plans, activitiesWeek), 'en').footer;
    expect(footer([plan({ distance: 12000 })])).toBe('18.7 / 12.0 km · 1:48');
    expect(footer([plan({ duration: 16200 })])).toBe('18.7 km · 1:48 / 4:30');
    expect(footer([plan({ distance: 42000, duration: 16200 })])).toBe('18.7 / 42.0 km · 1:48 / 4:30');
    expect(footer([plan({})])).toBe('18.7 km · 1:48');
    for (const plans of [[plan({ distance: 12000 })], [plan({ duration: 16200 })], [plan({})]]) {
      const text = weekView(week(WEDNESDAY_NOON, 'running', plans, []), 'en').footer;
      expect(text).not.toMatch(/\/ 0:00|\/ 0\.0 km|undefined|NaN|null/);
    }
  });

  it('prints zero done totals for an empty week (Review Focus 4)', () => {
    const empty = weekView(week(WEDNESDAY_NOON, 'running', [], []), 'en');
    expect(empty.footer).toBe('0.0 km · 0:00');
    expect(empty.days.every(day => day.items.length === 0 && day.more === '')).toBe(true);
    expect(empty.garmin).toEqual([]);
  });

  it('passes the Garmin attribution through', () => {
    expect(view.garmin).toEqual(['Synthetic Garmin attribution text']);
  });

  it('keeps the hostile title verbatim (Review Focus 1)', () => {
    const hostile = view.days[5].items[1];
    expect(hostile).toEqual({ kind: 'planned', text: 'Tempo </script><b>"x"</b> {{ x }} {% raw %} 🏃 · 40 min' });
  });

  it('never prints undefined, NaN, null or 0:00 in items', () => {
    const views = [view, weekView(week(SUNDAY_EVENING, 'all'), 'nl'), weekView(week(MONDAY_MORNING), 'en')];
    for (const each of views) {
      for (const item of each.days.flatMap(day => day.items)) {
        expect(item.text).not.toMatch(/undefined|NaN|null|0:00/);
      }
    }
  });

  it('prints a done session without distance by its title, a done plan without an activity by its title', () => {
    const sunday = weekView(week(SUNDAY_EVENING, 'all'), 'en');
    expect(sunday.days[2].items).toContainEqual({ kind: 'done', text: '✓ Strength · 50 min · 112' });
    const lost = weekView(
      week(SUNDAY_EVENING, 'running', [{ ...plannedWeek[0], executedTrainingId: 'SynActMissing' }], []),
      'en'
    );
    expect(lost.days[0].items).toEqual([{ kind: 'done', text: '✓ Easy run' }]);
  });

  it('falls back to a sport name when a plan has no title', () => {
    const plan = { date: '2026-11-05T07:00:00.000Z', sportType: 'running', duration: 1800 };
    const other = { date: '2026-11-05T08:00:00.000Z', sportType: 'yoga', title: '  ' };
    expect(weekView(week(WEDNESDAY_NOON, 'all', [plan, other], []), 'en').days[3].items).toEqual([
      { kind: 'planned', text: 'Run · 30 min' },
      { kind: 'planned', text: 'Session' }
    ]);
    expect(weekView(week(WEDNESDAY_NOON, 'all', [plan], []), 'nl').days[3].items[0].text).toBe('Hardlopen · 30 min');
  });
});
