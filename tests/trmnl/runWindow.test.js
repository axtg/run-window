const { pickSession, windowPanel } = require('../../integrations/trmnl-running-board/src/runWindow');

const AMS = 'Europe/Amsterdam';
const AVAIL = '07-09,17-21';
const ms = iso => Date.parse(iso);
const fixture = name => require(`../fixtures/trmnl/window-${name}.json`);
const plannedWeek = require('../fixtures/tredict/planned-week.json')._embedded.plannedWorkoutList;

const WEDNESDAY_10 = ms('2026-11-04T09:00:00Z');
const WEDNESDAY_2130 = ms('2026-11-04T20:30:00Z');
const SUNDAY_10 = ms('2026-11-08T09:00:00Z');

const plan = (id, date, extra = {}) => ({ id, date, timezone: 1, sportType: 'running', title: id, ...extra });
const pick = (plans, now = WEDNESDAY_10, extra = {}) => pickSession({ plans, now, tz: AMS, avail: AVAIL, ...extra });
const session = (extra = {}) => ({
  day: 'today',
  date: '2026-11-04',
  minutes: 60,
  reason: 'planned',
  overLimit: false,
  ...extra
});
const panel = (body, extra = {}) =>
  windowPanel({ body, status: 200, session: session(), lang: 'en', hasLocation: true, ...extra });

describe('pickSession', () => {
  it('keeps today at 12:00 when the last range has minutes', () => {
    const noon = ms('2026-11-04T11:00:00Z');
    const result = pick([plan('A', '2026-11-04T16:30:00Z', { duration: 45 * 60 })], noon, {
      avail: '07-09,17:30-21:30'
    });
    expect(result).toEqual({ day: 'today', date: '2026-11-04', minutes: 45, reason: 'planned', overLimit: false });
  });

  it('rounds a 52-minute plan today up to 60', () => {
    const result = pick([plan('A', '2026-11-04T16:00:00Z', { duration: 52 * 60 })]);
    expect(result).toEqual({ day: 'today', date: '2026-11-04', minutes: 60, reason: 'planned', overLimit: false });
  });

  it('caps a 200-minute plan at 180 and flags it', () => {
    const result = pick([plan('A', '2026-11-04T16:00:00Z', { duration: 200 * 60 })]);
    expect(result).toMatchObject({ minutes: 180, overLimit: true, reason: 'planned' });
  });

  it('rounds a short plan up to at least 15', () => {
    expect(pick([plan('A', '2026-11-04T16:00:00Z', { duration: 300 })]).minutes).toBe(15);
    expect(pick([plan('A', '2026-11-04T16:00:00Z', { duration: 3600 })]).minutes).toBe(60);
    expect(pick([plan('A', '2026-11-04T16:00:00Z', { duration: 3601 })]).minutes).toBe(75);
  });

  it('uses 60 with noDuration for a plan without a duration', () => {
    expect(pick([plan('A', '2026-11-04T16:00:00Z')])).toMatchObject({ minutes: 60, reason: 'noDuration' });
    expect(pick([plan('A', '2026-11-04T16:00:00Z', { duration: 0 })])).toMatchObject({
      minutes: 60,
      reason: 'noDuration'
    });
  });

  it('takes the earliest remaining plan today', () => {
    const plans = [
      plan('Late', '2026-11-04T17:00:00Z', { duration: 1800 }),
      plan('Done', '2026-11-04T06:00:00Z', { duration: 5400, executedTrainingId: 'X' }),
      plan('Early', '2026-11-04T11:00:00Z', { duration: 2700 })
    ];
    expect(pick(plans)).toMatchObject({ day: 'today', minutes: 45 });
  });

  it("moves to tomorrow when today's run is done", () => {
    const plans = [
      plan('Done', '2026-11-04T06:00:00Z', { duration: 3600, executedTrainingId: 'X' }),
      plan('Next', '2026-11-05T07:00:00Z', { duration: 2700 })
    ];
    expect(pick(plans)).toEqual({
      day: 'tomorrow',
      date: '2026-11-05',
      minutes: 45,
      reason: 'planned',
      overLimit: false
    });
  });

  it('moves to tomorrow on a rest day with a plan tomorrow (planned week, Wednesday)', () => {
    expect(pick(plannedWeek)).toMatchObject({ day: 'tomorrow', date: '2026-11-05', minutes: 60 });
  });

  it('counts other sports only with the all filter', () => {
    const plans = [plan('Bike', '2026-11-04T16:00:00Z', { sportType: 'cycling', duration: 5400 })];
    expect(pick(plans)).toMatchObject({ day: 'today', reason: 'noPlan', minutes: 60 });
    expect(pick(plans, WEDNESDAY_10, { sport: 'all' })).toMatchObject({ day: 'today', reason: 'planned', minutes: 90 });
  });

  it("moves to tomorrow at 21:30 with a plan today, past today's hours", () => {
    const plans = [
      plan('Today', '2026-11-04T16:00:00Z', { duration: 2700 }),
      plan('Tomorrow', '2026-11-05T07:00:00Z', { duration: 1800 })
    ];
    expect(pick(plans, WEDNESDAY_2130)).toMatchObject({ day: 'tomorrow', date: '2026-11-05', minutes: 30 });
  });

  it('says noPlan today at 10:00 when nothing is planned today or tomorrow', () => {
    expect(pick([])).toEqual({ day: 'today', date: '2026-11-04', minutes: 60, reason: 'noPlan', overLimit: false });
  });

  it('says noPlan tomorrow at 21:30 when nothing is planned', () => {
    expect(pick([], WEDNESDAY_2130)).toMatchObject({ day: 'tomorrow', date: '2026-11-05', reason: 'noPlan' });
  });

  it("says noPlan tomorrow when today's run is done and nothing is planned tomorrow", () => {
    const plans = [plan('Done', '2026-11-04T06:00:00Z', { duration: 3600, executedTrainingId: 'X' })];
    expect(pick(plans)).toMatchObject({ day: 'tomorrow', date: '2026-11-05', reason: 'noPlan', minutes: 60 });
  });

  it('uses 60 and unknown when plans are null (Tredict failed)', () => {
    expect(pick(null)).toEqual({ day: 'today', date: '2026-11-04', minutes: 60, reason: 'unknown', overLimit: false });
    expect(pick(null, WEDNESDAY_2130)).toMatchObject({ day: 'tomorrow', date: '2026-11-05', reason: 'unknown' });
  });

  it('uses next Monday on a Sunday with nothing left today', () => {
    const plans = [plan('Monday', '2026-11-09T07:00:00Z', { duration: 2400 })];
    expect(pick(plans, SUNDAY_10)).toEqual({
      day: 'tomorrow',
      date: '2026-11-09',
      minutes: 45,
      reason: 'planned',
      overLimit: false
    });
  });

  it('ignores plans with an unreadable date', () => {
    expect(pick([plan('Bad', 'not a date', { duration: 3600 })])).toMatchObject({ reason: 'noPlan' });
  });
});

describe('windowPanel', () => {
  it('shows the window with its conditions (en)', () => {
    expect(panel(fixture('ok'))).toEqual({
      kind: 'window',
      heading: 'BEST TIME TODAY · 60 min',
      lines: ['12:15–13:15', 'dry · 18 km/h SW · 8°C', 'start into the wind (SW)', 'dark after 17:07']
    });
  });

  it('shows the window with its conditions (nl)', () => {
    expect(panel(fixture('ok'), { lang: 'nl' })).toEqual({
      kind: 'window',
      heading: 'BESTE TIJD VANDAAG · 60 min',
      lines: ['12:15–13:15', 'droog · 18 km/u ZW · 8°C', 'begin tegen de wind in (ZW)', 'donker na 17:07']
    });
  });

  it('never uses the API label', () => {
    expect(JSON.stringify(panel(fixture('ok')))).not.toContain('invented');
  });

  it('picks the window for the session length', () => {
    const result = panel(fixture('ok'), { session: session({ minutes: 90 }) });
    expect(result.heading).toBe('BEST TIME TODAY · 90 min');
    expect(result.lines[0]).toBe('12:15–13:45');
  });

  it('heads tomorrow with TOMORROW and uses that day', () => {
    const result = panel(fixture('ok'), { session: session({ day: 'tomorrow', date: '2026-11-05' }) });
    expect(result.heading).toBe('TOMORROW · 60 min');
    expect(result.lines[0]).toBe('08:00–09:00');
    expect(
      panel(fixture('ok'), { lang: 'nl', session: session({ day: 'tomorrow', date: '2026-11-05' }) }).heading
    ).toBe('MORGEN · 60 min');
  });

  it('adds the session notes to the heading', () => {
    expect(panel(fixture('ok'), { session: session({ reason: 'noDuration' }) }).heading).toBe(
      'BEST TIME TODAY · 60 min (no duration planned)'
    );
    expect(panel(fixture('ok'), { session: session({ reason: 'noPlan' }) }).heading).toBe(
      'BEST TIME TODAY · 60 min · no session planned'
    );
    expect(panel(fixture('ok'), { session: session({ minutes: 180, overLimit: true }) }).heading).toBe(
      "BEST TIME TODAY · 180 min · doesn't fully fit"
    );
  });

  it('says nothing about the session when plans are unknown', () => {
    const result = panel(fixture('ok'), { session: session({ reason: 'unknown' }) });
    expect(result.heading).toBe('BEST TIME TODAY · 60 min');
    expect(result.heading).not.toContain('no session planned');
  });

  it("uses today's entry when days[0] is yesterday (cached across midnight)", () => {
    const result = panel(fixture('cached'));
    expect(result.kind).toBe('window');
    expect(result.lines[0]).toBe('12:15–13:15');
  });

  it('says error when no entry matches the session date', () => {
    const result = panel(fixture('cached'), { session: session({ date: '2026-11-06' }) });
    expect(result).toEqual({ kind: 'error', heading: 'Weather unavailable', lines: [] });
  });

  it('falls back to the longest shorter window', () => {
    const result = panel(fixture('shorter'), { session: session({ minutes: 90 }) });
    expect(result.kind).toBe('shorter');
    expect(result.heading).toBe('Only 45 min fits your hours');
    expect(result.lines[0]).toBe('12:15–13:00');
    expect(panel(fixture('shorter'), { lang: 'nl', session: session({ minutes: 90 }) }).heading).toBe(
      'Alleen 45 min past in je uren'
    );
  });

  it('keeps TOMORROW in the heading of a shorter window', () => {
    const body = fixture('shorter');
    const shifted = {
      ...body,
      days: [
        { ...body.days[1], date: '2026-11-04' },
        { ...body.days[0], date: '2026-11-05' }
      ]
    };
    const result = panel(shifted, { session: session({ day: 'tomorrow', date: '2026-11-05', minutes: 90 }) });
    expect(result.heading).toBe('TOMORROW · Only 45 min fits your hours');
  });

  it('shows the least bad 60 minutes, never as dry', () => {
    const result = panel(fixture('fallback'));
    expect(result.kind).toBe('fallback');
    expect(result.heading).toBe('No dry window. Least bad 60 min:');
    expect(result.lines[0]).toBe('17:00–18:00');
    expect(result.lines[1]).toBe('rain 15% · 18 km/h SW · 8°C');
    expect(result.lines.join(' ')).not.toMatch(/\bdry\b/);
    expect(panel(fixture('fallback'), { lang: 'nl' }).lines[1]).toBe('regen 15% · 18 km/u ZW · 8°C');
  });

  it('says none when there is neither a window nor a fallback', () => {
    expect(panel(fixture('none'))).toEqual({ kind: 'none', heading: 'No dry window in your hours', lines: [] });
    const noKey = fixture('none');
    const withoutFallback = { ...noKey, days: noKey.days.map(({ fallback: _fallback, ...day }) => day) };
    expect(panel(withoutFallback).kind).toBe('none');
  });

  it('warns about stale weather and leaves out dark after without a sunset', () => {
    const result = panel(fixture('stale'));
    expect(result.kind).toBe('window');
    expect(result.lines).toContain('weather may be out of date');
    expect(result.lines.join(' ')).not.toContain('dark after');
    expect(panel(fixture('stale'), { lang: 'nl' }).lines).toContain('weer is mogelijk verouderd');
  });

  it('warns about stale weather when there is no window', () => {
    const body = { ...fixture('none'), warnings: ['stale_data'] };
    expect(panel(body).lines).toEqual(['weather may be out of date']);
  });

  it.each([503, 429, null])('says Weather unavailable without a body (status %p)', status => {
    expect(panel(null, { status })).toEqual({ kind: 'error', heading: 'Weather unavailable', lines: [] });
  });

  it('says error for a body without days', () => {
    expect(panel({}, { status: 200 }).kind).toBe('error');
    expect(panel({ days: 'x' }).kind).toBe('error');
  });

  it('says badSettings on a 400', () => {
    expect(panel(null, { status: 400 })).toEqual({
      kind: 'badSettings',
      heading: 'Check your hours setting',
      lines: []
    });
    expect(panel(null, { status: 400, lang: 'nl' }).heading).toBe('Controleer je uren-instelling');
  });

  it('says noLocation without a location, before anything else', () => {
    expect(panel(fixture('ok'), { hasLocation: false })).toEqual({
      kind: 'noLocation',
      heading: 'Set your location in the plugin settings',
      lines: []
    });
    expect(panel(null, { status: 400, hasLocation: false }).kind).toBe('noLocation');
  });

  it('treats an unreadable window as missing', () => {
    const body = fixture('ok');
    const broken = {
      ...body,
      days: [{ ...body.days[0], windows: { ...body.days[0].windows, 60: { start: 'x', end: 'y' } } }, body.days[1]]
    };
    expect(panel(broken)).toMatchObject({ kind: 'shorter', heading: 'Only 45 min fits your hours' });
    const noWindows = { ...body, days: [{ date: '2026-11-04' }] };
    expect(panel(noWindows).kind).toBe('none');
  });

  describe('windows with missing condition fields', () => {
    const body = fixture('ok');
    const good = body.days[0].windows['60'];
    const MALFORMED = [
      ['only start and end', { start: good.start, end: good.end }],
      ['windAvg null', { ...good, windAvg: null }],
      ['unknown cardinal', { ...good, windFromCardinal: 'XX' }],
      ['precipProbMax missing', { ...good, precipProbMax: undefined }],
      ['apparentTempAvg NaN', { ...good, apparentTempAvg: NaN }],
      ['windAvg as text', { ...good, windAvg: '18' }]
    ];
    const withDay = (windows, extra = {}) => ({
      ...body,
      days: [{ ...body.days[0], windows, ...extra }, body.days[1]]
    });
    const allMalformed = bad => Object.fromEntries(Object.keys(body.days[0].windows).map(key => [key, bad]));

    it.each(MALFORMED)('falls through to a valid shorter window (%s)', (name, bad) => {
      const result = panel(withDay({ ...body.days[0].windows, 60: bad }));
      expect(result).toMatchObject({ kind: 'shorter', heading: 'Only 45 min fits your hours' });
      expect(result.lines[1]).toBe('dry · 18 km/h SW · 8°C');
    });

    it.each(MALFORMED)('gives none when every window is malformed (%s)', (name, bad) => {
      expect(panel(withDay(allMalformed(bad), { fallback: bad }), { lang: 'nl' })).toMatchObject({ kind: 'none' });
    });

    it.each(MALFORMED)('uses a valid fallback when every window is malformed (%s)', (name, bad) => {
      const fallback = fixture('fallback').days[0].fallback;
      expect(panel(withDay(allMalformed(bad), { fallback })).kind).toBe('fallback');
    });

    it.each(MALFORMED)('never prints undefined, null or NaN (%s)', (name, bad) => {
      for (const lang of ['en', 'nl']) {
        for (const windows of [{ ...body.days[0].windows, 60: bad }, allMalformed(bad)]) {
          const result = panel(withDay(windows, { fallback: bad }), { lang });
          expect([result.heading, ...result.lines].join('\n')).not.toMatch(/undefined|null|NaN/);
        }
      }
    });
  });

  it('falls back to en for an unknown language', () => {
    expect(panel(fixture('ok'), { lang: 'de' }).heading).toBe('BEST TIME TODAY · 60 min');
  });
});
