const { buildBoard } = require('../../integrations/trmnl-running-board/src/board');
const { loadTransform } = require('./harness');
const {
  windowOk,
  detailNoHr,
  NOW,
  TOKEN,
  MINUTE,
  headersOf,
  fakeFetch,
  makeInput,
  roundTrip,
  board
} = require('./boardCases');
const activitiesWeek = require('../fixtures/tredict/activities-week.json');
const effortsWeek = require('../fixtures/tredict/efforts-week.json');

const SECOND = 1000;

describe('buildBoard: normal case', () => {
  let output;
  let calls;

  beforeAll(async () => {
    ({ output, calls } = await board());
  });

  it('assembles every panel', () => {
    expect(output.v).toBe(1);
    expect(output.lang).toBe('en');
    expect(output.fetchedAt).toBe('2026-11-04T11:00:00.000Z');
    expect(output.fetchedAtText).toBe('We 12:00');
    expect(output.tredict).toEqual({ state: 'ok', message: '' });
    expect(output.tredictAt).toBe(output.fetchedAt);
    expect(output.tredictAtText).toBe('We 12:00');
    expect(output.week.title).toBe('WEEK 45');
    expect(output.week.days).toHaveLength(7);
    expect(output.form.today).toMatch(/^(\+|−)?\d+$/);
    expect(output.form.pastPath).not.toBe('');
    expect(output.run.kind).toBe('window');
    expect(output.run.heading).toBe('TOMORROW · 60 min');
  });

  it('joins the Garmin text and the API attribution', () => {
    expect(output.week.garmin.length).toBeGreaterThan(0);
    for (const text of output.week.garmin) expect(output.attribution).toContain(text);
    expect(output.attribution).toContain('Open-Meteo');
    expect(output.attribution).toBe([...output.week.garmin, windowOk.attribution].join(' · '));
  });

  it("makes the Tredict calls, this week's details included, with the token and no weather retry", () => {
    expect(calls.map(call => call.name)).toEqual(['plan', 'activities', 'efforts', 'detail', 'detail', 'detail']);
    for (const call of calls) expect(call.options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('leaks no coordinates, summaries or token and stays under 10 KB', () => {
    const json = JSON.stringify(output);
    expect(json).not.toContain('positionLat');
    expect(json).not.toContain('summary');
    expect(json).not.toContain('seriesSampled');
    expect(json).not.toContain('intensityDistribution');
    expect(json).not.toContain('Bearer');
    expect(json).not.toContain(TOKEN);
    expect(output.intensityCache).toHaveLength(3);
    expect(Buffer.byteLength(json)).toBeLessThan(10 * 1024);
  });

  it('uses Dutch text from the device locale', async () => {
    const { output: nl } = await board({ user: { time_zone_iana: 'Europe/Amsterdam', locale: 'nl-NL' } });
    expect(nl.lang).toBe('nl');
    expect(nl.fetchedAtText).toBe('wo 12:00');
    expect(nl.run.heading).toBe('MORGEN · 60 min');
  });

  it("falls back to the API's timezone when the user's is missing or invalid", async () => {
    const { output: noZone } = await board({ user: { locale: 'en' } });
    expect(noZone.fetchedAtText).toBe('We 12:00');
    const { output: badZone } = await board({ user: { time_zone_iana: 'Not/AZone', locale: 'en' } });
    expect(badZone.fetchedAtText).toBe('We 12:00');
  });

  it('is what the built transform returns', async () => {
    const fake = fakeFetch();
    const run = loadTransform({ fetch: fake.fetch, now: NOW });
    expect(roundTrip(await run(makeInput()))).toEqual(output);
  });
});

describe('buildBoard: Tredict states', () => {
  it.each(['plan', 'activities', 'efforts'])('401 shows the paused text (on %s)', async name => {
    const { output } = await board({}, { [name]: 401 });
    expect(output.tredict).toEqual({
      state: 'paused',
      message: 'Tredict token paused. Open the Tredict web app to reactivate it.'
    });
    expect(output.week).toBeNull();
    expect(output.form).toBeNull();
    expect(output.tredictAt).toBeNull();
    expect(output.tredictAtText).toBe('');
    expect(output.tredictRetryAt).toBeNull();
    expect(output.run.kind).toBe('window');
    if (name === 'plan') expect(output.run.heading).toBe('BEST TIME TODAY · 60 min');
  });

  it.each(['plan', 'activities', 'efforts'])('403 shows the invalid text (on %s)', async name => {
    const { output } = await board({}, { [name]: 403 });
    expect(output.tredict).toEqual({
      state: 'auth',
      message: 'Tredict token invalid. Check it has the activityRead scope.'
    });
    expect(output.week).toBeNull();
    expect(output.form).toBeNull();
    expect(output.tredictAt).toBeNull();
  });

  it('shows the Dutch paused and invalid texts', async () => {
    const user = { time_zone_iana: 'Europe/Amsterdam', locale: 'nl-NL' };
    expect((await board({ user }, { plan: 401 })).output.tredict).toEqual({
      state: 'paused',
      message: 'Tredict-token gepauzeerd. Open de Tredict-webapp om het weer te activeren.'
    });
    expect((await board({ user }, { plan: 403 })).output.tredict).toEqual({
      state: 'auth',
      message: 'Tredict-token ongeldig. Controleer of het de scope activityRead heeft.'
    });
  });

  it('treats a missing token as auth without calling Tredict', async () => {
    const { output, calls } = await board({ fields: { tredict_token: '' } });
    expect(output.tredict.state).toBe('auth');
    expect(calls).toHaveLength(0);
    expect(output.run.heading).toBe('BEST TIME TODAY · 60 min');
  });

  it('turns a 402 into payment', async () => {
    const { output } = await board({}, { efforts: 402 });
    expect(output.tredict).toEqual({ state: 'payment', message: "Tredict says this account can't use the API." });
    expect(output.week).toBeNull();
    expect(output.form).toBeNull();
  });

  it('lets the first failing call decide, without issuing the rest', async () => {
    const unavailable = await board({ previous: null }, { plan: 503, activities: 402, efforts: 401 });
    expect(unavailable.output.tredict.state).toBe('unavailable');
    expect(unavailable.calls.map(call => call.name)).toEqual(['plan']);
    const paused = await board({}, { plan: 401, activities: 403 });
    expect(paused.output.tredict.state).toBe('paused');
    expect(paused.calls.map(call => call.name)).toEqual(['plan']);
    const payment = await board({}, { activities: 402, efforts: 401 });
    expect(payment.output.tredict.state).toBe('payment');
    expect(payment.calls.map(call => call.name)).toEqual(['plan', 'activities']);
  });

  describe('stale data', () => {
    let first;

    beforeAll(async () => {
      first = (await board({}, {}, NOW - 2 * 60 * MINUTE)).output;
    });

    it('reuses a previous output from today when efforts fail', async () => {
      const { output } = await board({ previous: first }, { efforts: 503 });
      expect(output.tredict.state).toBe('stale');
      expect(first.tredictAtText).toBe('We 10:00');
      expect(output.tredict.message).toBe('Tredict data from We 10:00');
      expect(output.tredictAt).toBe(first.tredictAt);
      expect(output.tredictAtText).toBe(first.tredictAtText);
      expect(output.week).toEqual(first.week);
      expect(output.form).toEqual(first.form);
      expect(output.attribution).toContain(first.week.garmin[0]);
      expect(output.fetchedAt).toBe('2026-11-04T11:00:00.000Z');
    });

    it('keeps the first tredictAt over two failures in a row', async () => {
      const second = (await board({ previous: first }, { efforts: 503 }, NOW - 30 * MINUTE)).output;
      const { output } = await board({ previous: second }, { activities: 500 });
      expect(output.tredict.state).toBe('stale');
      expect(output.tredictAt).toBe(first.tredictAt);
    });

    it('is unavailable when the previous data is from yesterday', async () => {
      const yesterday = { ...first, tredictAt: '2026-11-03T20:00:00.000Z', tredictAtText: 'Tu 21:00' };
      const { output } = await board({ previous: yesterday }, { efforts: 503 });
      expect(output.tredict).toEqual({ state: 'unavailable', message: 'Tredict unavailable' });
      expect(output.week).toBeNull();
      expect(output.form).toBeNull();
      expect(output.tredictAt).toBeNull();
    });

    it('is unavailable without a previous output', async () => {
      const { output } = await board({ previous: null }, { efforts: 503 });
      expect(output.tredict.state).toBe('unavailable');
      expect(output.attribution).toBe(windowOk.attribution);
    });

    it('is unavailable when the previous output lacks a panel or a version', async () => {
      expect((await board({ previous: { ...first, week: null } }, { efforts: 503 })).output.tredict.state).toBe(
        'unavailable'
      );
      expect((await board({ previous: { ...first, v: 2 } }, { efforts: 503 })).output.tredict.state).toBe(
        'unavailable'
      );
    });

    it('treats efforts without keys as empty when the plan and activity calls succeed', async () => {
      const { output } = await board({ previous: first }, { efforts: { trainingEfforts: {} } });
      expect(output.tredict).toEqual({ state: 'ok', message: '' });
      expect(output.tredictAt).toBe(output.fetchedAt);
      expect(output.form.empty).toBe('No training data yet');
      expect(output.week.days).toHaveLength(7);
    });

    it('treats efforts without keys as unavailable when another call failed (Review Focus 2)', async () => {
      const overrides = { activities: 503, efforts: { trainingEfforts: {} } };
      const { output } = await board({ previous: null }, overrides);
      expect(output.tredict).toEqual({ state: 'unavailable', message: 'Tredict unavailable' });
      expect(output.form).toBeNull();
      const { output: plan } = await board({ previous: null }, { plan: 503, efforts: { trainingEfforts: {} } });
      expect(plan.tredict.state).toBe('unavailable');
    });

    it('treats an HTML body as unavailable (Review Focus 2)', async () => {
      const html = () => ({ status: 200, text: async () => '<html>' });
      const { output } = await board({ previous: null }, { activities: html });
      expect(output.tredict.state).toBe('unavailable');
      expect(output.run.kind).toBe('window');
    });

    it('keeps plans for the session when only the plan call succeeded', async () => {
      const { output } = await board({ previous: null }, { efforts: 503 });
      expect(output.run.heading).toBe('TOMORROW · 60 min');
      const { output: unknown } = await board({ previous: null }, { plan: 503 });
      expect(unknown.run.heading).toBe('BEST TIME TODAY · 60 min');
    });

    it('replaces unsafe path data and numbers when reusing', async () => {
      const previous = {
        ...first,
        form: { ...first.form, pastPath: 'M 0 0"/><script>', futurePath: 'M0 0 Z', zeroY: 'x', todayX: Infinity },
        week: { ...first.week, days: [{ label: 'Mo', today: false, items: [{ kind: 'bad', text: 'x' }], more: '' }] }
      };
      const { output } = await board({ previous: roundTrip(previous) }, { efforts: 503 });
      expect(output.tredict.state).toBe('stale');
      expect(output.form.pastPath).toBe('');
      expect(output.form.futurePath).toBe('');
      expect(output.form.zeroY).toBe(0);
      expect(output.form.todayX).toBe(0);
      expect(output.week.days[0].items).toEqual([{ kind: 'planned', text: 'x' }]);
    });

    it('copies only the contract fields from a previous output', async () => {
      const previous = {
        ...first,
        week: { ...first.week, summary: { positionLat: 52.37 }, token: TOKEN },
        form: { ...first.form, extra: 'Bearer x' },
        tredict: { state: 'ok', message: TOKEN }
      };
      const { output } = await board({ previous }, { efforts: 503 });
      const json = JSON.stringify(output);
      expect(json).not.toContain('positionLat');
      expect(json).not.toContain('summary');
      expect(json).not.toContain('Bearer');
      expect(json).not.toContain(TOKEN);
    });
  });
});

describe('buildBoard: Tredict sequence', () => {
  const tredictNames = calls => calls.filter(call => call.name !== 'window').map(call => call.name);
  const rateLimited = retryAfter => () => ({
    status: 429,
    headers: headersOf(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }),
    text: async () => '{"error":"x"}'
  });
  const at = ms => new Date(ms).toISOString();

  it('calls Tredict one at a time in plan, activities, efforts, detail order', async () => {
    const { calls, output } = await board();
    expect(output.tredict.state).toBe('ok');
    const tredict = calls.filter(call => call.name !== 'window');
    expect(tredict.map(call => call.name)).toEqual(['plan', 'activities', 'efforts', 'detail', 'detail', 'detail']);
    for (let i = 1; i < tredict.length; i += 1) expect(tredict[i].start).toBeGreaterThan(tredict[i - 1].end);
  });

  it('the weather retry runs alongside', async () => {
    const { calls, output } = await board({ body: {} });
    expect(output.run.kind).toBe('window');
    const window = calls.find(call => call.name === 'window');
    const plan = calls.find(call => call.name === 'plan');
    expect(window.start).toBeLessThan(plan.end);
  });

  it('a 429 stops the sequence and pauses', async () => {
    const { output, calls } = await board({ previous: null }, { activities: rateLimited('3600') });
    expect(tredictNames(calls)).toEqual(['plan', 'activities']);
    expect(output.tredictRetryAt).toBe(at(NOW + 3600 * SECOND));
    expect(output.tredict).toEqual({ state: 'unavailable', message: 'Tredict unavailable' });
  });

  it.each([
    ['60', 1800],
    ['99999', 21600],
    [undefined, 1800],
    ['Wed, 04 Nov 2026 12:00:00 GMT', 1800]
  ])('clamps Retry-After %s to %i s', async (retryAfter, seconds) => {
    const { output } = await board({}, { activities: rateLimited(retryAfter) });
    expect(output.tredictRetryAt).toBe(at(NOW + seconds * SECOND));
  });

  it('shows stale panels from today on a 429', async () => {
    const first = (await board({}, {}, NOW - 2 * 60 * MINUTE)).output;
    const { output } = await board({ previous: first }, { plan: rateLimited('3600') });
    expect(output.tredict).toEqual({ state: 'stale', message: 'Tredict data from We 10:00' });
    expect(output.week).toEqual(first.week);
    expect(output.tredictRetryAt).toBe(at(NOW + 3600 * SECOND));
  });

  describe('a pause in force', () => {
    let first;

    beforeAll(async () => {
      first = (await board({}, {}, NOW - 2 * 60 * MINUTE)).output;
    });

    it('a run inside the pause calls no Tredict', async () => {
      const tredictRetryAt = at(NOW + 10 * MINUTE);
      const { output, calls } = await board({ previous: { ...first, tredictRetryAt } });
      expect(tredictNames(calls)).toEqual([]);
      expect(output.tredict).toEqual({ state: 'stale', message: 'Tredict data from We 10:00' });
      expect(output.week).toEqual(first.week);
      expect(output.form).toEqual(first.form);
      expect(output.tredictAt).toBe(first.tredictAt);
      expect(output.tredictRetryAt).toBe(tredictRetryAt);
      expect(output.run.kind).toBe('window');
    });

    it('keeps the weather retry while paused', async () => {
      const tredictRetryAt = at(NOW + 10 * MINUTE);
      const { output, calls } = await board({ body: {}, previous: { ...first, tredictRetryAt } });
      expect(calls.map(call => call.name)).toEqual(['window']);
      expect(output.run.kind).toBe('window');
    });

    it('is unavailable inside the pause without data from today', async () => {
      const tredictRetryAt = at(NOW + 10 * MINUTE);
      const previous = { ...first, tredictAt: '2026-11-03T20:00:00.000Z', tredictRetryAt };
      const { output, calls } = await board({ previous });
      expect(tredictNames(calls)).toEqual([]);
      expect(output.tredict).toEqual({ state: 'unavailable', message: 'Tredict unavailable' });
      expect(output.tredictRetryAt).toBe(tredictRetryAt);
    });

    it('a run after the pause calls again', async () => {
      const { output, calls } = await board({ previous: { ...first, tredictRetryAt: at(NOW - MINUTE) } });
      expect(tredictNames(calls)).toEqual(['plan', 'activities', 'efforts']);
      expect(output.tredict.state).toBe('ok');
      expect(output.tredictRetryAt).toBeNull();
    });

    it('restarts the pause from now on a 429 after the last one passed', async () => {
      const previous = { ...first, tredictRetryAt: at(NOW - MINUTE) };
      const { output } = await board({ previous }, { efforts: rateLimited('3600') });
      expect(output.tredictRetryAt).toBe(at(NOW + 3600 * SECOND));
      expect(output.tredict.state).toBe('stale');
    });

    it('ignores a pause too far ahead (Review Focus 2)', async () => {
      const { output, calls } = await board({ previous: { ...first, tredictRetryAt: '3000-01-01T00:00:00.000Z' } });
      expect(tredictNames(calls)).toEqual(['plan', 'activities', 'efforts']);
      expect(output.tredictRetryAt).toBeNull();
      const edge = await board({ previous: { ...first, tredictRetryAt: at(NOW + 21600 * SECOND + 1) } });
      expect(tredictNames(edge.calls)).toHaveLength(3);
    });

    it('ignores an unreadable pause', async () => {
      for (const tredictRetryAt of ['soon', 12345, null]) {
        const { calls, output } = await board({ previous: { ...first, tredictRetryAt } });
        expect(tredictNames(calls)).toHaveLength(3);
        expect(output.tredictRetryAt).toBeNull();
      }
    });

    it('the error output keeps the pause', async () => {
      const tredictRetryAt = at(NOW + 10 * MINUTE);
      const input = makeInput({ previous: { ...first, tredictRetryAt } });
      Object.defineProperty(input, 'days', {
        get() {
          throw new Error('boom');
        }
      });
      const output = roundTrip(await buildBoard(input, { fetch: fakeFetch().fetch, now: NOW }));
      expect(output.run.kind).toBe('error');
      expect(output.tredict.state).toBe('unavailable');
      expect(output.tredictRetryAt).toBe(tredictRetryAt);
      expect(output.intensity).toBeNull();
      expect(output.intensityCache).toEqual(first.intensityCache);
      expect(JSON.stringify(output)).not.toContain('boom');
    });
  });

  it('the error output keeps a pause and a cache from the same run', async () => {
    const input = makeInput({ previous: null });
    Object.defineProperty(input, 'days', {
      get() {
        throw new Error('boom');
      }
    });
    const fake = fakeFetch({ details: { SynAct03xxxxxxxxxxxxxx: rateLimited('3600') } });
    const output = roundTrip(await buildBoard(input, { fetch: fake.fetch, now: NOW }));
    expect(fake.calls.map(call => call.name)).toEqual(['plan', 'activities', 'efforts', 'detail', 'detail']);
    expect(output.run.kind).toBe('error');
    expect(output.tredictRetryAt).toBe(at(NOW + 3600 * SECOND));
    expect(output.intensityCache).toEqual([['SynAct04xxxxxxxxxxxxxx', 2100, 450, 150]]);
    expect(output.intensity).toBeNull();
  });

  it('leaves tredictRetryAt null without a pause or a 429', async () => {
    expect((await board()).output.tredictRetryAt).toBeNull();
    expect((await board({}, { efforts: 503 })).output.tredictRetryAt).toBeNull();
  });

  it('a slow plan call leaves less time', async () => {
    let time = NOW;
    const clock = () => time;
    const slowPlan = () => {
      time += 3600;
      return { status: 200, headers: headersOf(), text: async () => JSON.stringify({ _embedded: {} }) };
    };
    const { output, calls } = await board({ previous: null, clock }, { plan: slowPlan });
    expect(tredictNames(calls)).toEqual(['plan']);
    expect(output.tredict.state).toBe('unavailable');
    expect(output.tredictRetryAt).toBeNull();
  });
});

describe('buildBoard: weather retry', () => {
  it('reports badSettings when the retry answers 400', async () => {
    const { output, calls } = await board({ body: {} }, { window: 400 });
    expect(output.run).toEqual({ kind: 'badSettings', heading: 'Check your hours setting', lines: [] });
    const retry = calls.find(call => call.name === 'window');
    expect(retry.url).toBe(
      'https://run.xadi.eu/api/window?lat=52.37&lon=4.89&avail=07-09%2C12-14%2C17-21&dark=avoid&rain=40'
    );
    expect(retry.options.headers).toBeUndefined();
    expect(JSON.stringify(retry.options)).not.toContain(TOKEN);
    expect(output.attribution).not.toContain('Open-Meteo');
  });

  it('reports an error when the retry answers 503', async () => {
    const { output } = await board({ body: {} }, { window: 503 });
    expect(output.run).toEqual({ kind: 'error', heading: 'Weather unavailable', lines: [] });
  });

  it('uses the retry body when it succeeds', async () => {
    const { output } = await board({ body: {} });
    expect(output.run.kind).toBe('window');
    expect(output.attribution).toContain('Open-Meteo');
  });

  it('does not retry when the polled body has generatedAt', async () => {
    const { calls } = await board();
    expect(calls.some(call => call.name === 'window')).toBe(false);
  });

  it('anchors the 30-minute pause to the retry, not to each skipped run', async () => {
    const first = await board({ body: {} }, { window: 503 });
    expect(first.calls.filter(call => call.name === 'window')).toHaveLength(1);
    expect(first.output.weatherRetryAt).toBe('2026-11-04T11:00:00.000Z');
    expect(first.output.run.kind).toBe('error');

    const second = await board({ body: {}, previous: first.output }, { window: 400 }, NOW + 10 * MINUTE);
    expect(second.calls.some(call => call.name === 'window')).toBe(false);
    expect(second.output.run.kind).toBe('error');
    expect(second.output.weatherRetryAt).toBe(first.output.weatherRetryAt);

    const third = await board({ body: {}, previous: second.output }, { window: 400 }, NOW + 31 * MINUTE);
    expect(third.calls.filter(call => call.name === 'window')).toHaveLength(1);
    expect(third.output.run).toEqual({ kind: 'badSettings', heading: 'Check your hours setting', lines: [] });
    expect(third.output.weatherRetryAt).toBe(new Date(NOW + 31 * MINUTE).toISOString());
  });

  it('keeps badSettings over two failed polls in a row', async () => {
    const first = await board({ body: {} }, { window: 400 });
    expect(first.output.run.kind).toBe('badSettings');
    const second = await board({ body: {}, previous: first.output }, { window: 400 }, NOW + 29 * MINUTE);
    expect(second.calls.filter(call => call.name === 'window')).toHaveLength(1);
    expect(second.output.run).toEqual({ kind: 'badSettings', heading: 'Check your hours setting', lines: [] });
    expect(second.output.weatherRetryAt).toBe(new Date(NOW + 29 * MINUTE).toISOString());
  });

  it('retries a failed poll 10 minutes after a successful retry', async () => {
    const first = await board({ body: {} });
    expect(first.output.run.kind).toBe('window');
    expect(first.output.weatherRetryAt).toBe('2026-11-04T11:00:00.000Z');
    const second = await board({ body: {}, previous: first.output }, {}, NOW + 10 * MINUTE);
    expect(second.calls.filter(call => call.name === 'window')).toHaveLength(1);
    expect(second.output.run.kind).toBe('window');
  });

  it('no longer pauses on an old-style error output without weatherRetryAt', async () => {
    const previous = { v: 1, fetchedAt: new Date(NOW - 5 * MINUTE).toISOString(), run: { kind: 'error' } };
    const { calls } = await board({ body: {}, previous });
    expect(calls.some(call => call.name === 'window')).toBe(true);
  });

  it('leaves weatherRetryAt null when no retry is needed or possible', async () => {
    const previous = { v: 1, weatherRetryAt: new Date(NOW - 5 * MINUTE).toISOString() };
    expect((await board({ previous })).output.weatherRetryAt).toBeNull();
    expect((await board({ body: {}, fields: { lat_lon: '' }, previous })).output.weatherRetryAt).toBeNull();
  });

  it('dates the retry case by the location when the user has no zone', async () => {
    const evening = Date.parse('2026-11-04T20:15:00Z');
    const { output } = await board({ body: {}, user: { locale: 'en' } }, { plan: 503 }, evening);
    expect(output.fetchedAtText).toBe('We 21:15');
    expect(output.run.kind).toBe('window');
    expect(output.run.heading).toBe('TOMORROW · 60 min');
  });

  it('does not retry without a location', async () => {
    const { output, calls } = await board({ body: {}, fields: { lat_lon: '' } });
    expect(calls.some(call => call.name === 'window')).toBe(false);
    expect(output.run.kind).toBe('noLocation');
  });
});

describe('buildBoard: attribution', () => {
  it.each(['shorter', 'fallback', 'none'])('includes the weather attribution for a %s panel', async name => {
    const body = require(`../fixtures/trmnl/window-${name}.json`);
    const { output } = await board({ body }, { plan: 503 });
    expect(output.run.kind).toBe(name);
    expect(output.attribution).toBe(body.attribution);
  });
});

describe('buildBoard: timezones', () => {
  it("picks the run window by the location's hours, the calendar by the user's", async () => {
    // 21:15 in Amsterdam (past 07-09,12-14,17-21), 09:15 on Thursday in Auckland
    const evening = Date.parse('2026-11-04T20:15:00Z');
    const user = { time_zone_iana: 'Pacific/Auckland', locale: 'en' };
    const { output } = await board({ user }, { plan: 503 }, evening);
    expect(output.fetchedAtText).toBe('Th 09:15');
    expect(output.run.kind).toBe('window');
    expect(output.run.heading).toBe('TOMORROW · 60 min');
  });

  it("uses the location's today while its hours remain, whatever the user's date", async () => {
    // 12:00 on Wednesday in Amsterdam, 00:00 on Thursday in Auckland
    const user = { time_zone_iana: 'Pacific/Auckland', locale: 'en' };
    const { output } = await board({ user }, { plan: 503 });
    expect(output.fetchedAtText).toBe('Th 00:00');
    expect(output.run.heading).toBe('BEST TIME TODAY · 60 min');
  });
});

describe('buildBoard: garbage input (Review Focus 5)', () => {
  const expectBasic = output => {
    expect(output.v).toBe(1);
    expect(output.fetchedAt).toBe('2026-11-04T11:00:00.000Z');
    expect(typeof output.fetchedAtText).toBe('string');
    expect(output.run).toEqual(expect.objectContaining({ kind: expect.any(String), heading: expect.any(String) }));
  };

  it('handles an empty input', async () => {
    const output = roundTrip(await buildBoard({}, { fetch: fakeFetch().fetch, now: NOW }));
    expectBasic(output);
    expect(output.tredict.state).toBe('auth');
    expect(output.run.kind).toBe('noLocation');
    expect(output.fetchedAtText).toBe('We 11:00');
  });

  it('handles a null trmnl and a missing input', async () => {
    expectBasic(roundTrip(await buildBoard({ trmnl: null }, { fetch: fakeFetch().fetch, now: NOW })));
    expectBasic(roundTrip(await buildBoard(undefined, { fetch: fakeFetch().fetch, now: NOW })));
  });

  it('handles a rejecting fetch', async () => {
    const fetch = async () => {
      throw new Error('network');
    };
    const output = roundTrip(await buildBoard(makeInput({ body: {} }), { fetch, now: NOW }));
    expectBasic(output);
    expect(output.tredict.state).toBe('unavailable');
    expect(output.run.kind).toBe('error');
  });

  it('handles a missing fetch', async () => {
    const output = roundTrip(await buildBoard(makeInput({ body: {} }), { now: NOW }));
    expectBasic(output);
    expect(output.tredict.state).toBe('unavailable');
  });

  it('handles an HTML body everywhere', async () => {
    const fetch = async () => ({ status: 200, text: async () => '<html>' });
    const output = roundTrip(await buildBoard(makeInput({ body: {} }), { fetch, now: NOW }));
    expectBasic(output);
    expect(output.tredict.state).toBe('unavailable');
    expect(output.run.kind).toBe('error');
  });

  it('handles a fetch that never resolves within the timeouts', async () => {
    jest.useFakeTimers();
    try {
      const calls = [];
      const fetch = url => {
        calls.push(url);
        return new Promise(() => {});
      };
      const pending = buildBoard(makeInput({ body: {} }), { fetch, now: NOW, timeoutMs: 50 });
      let settled = false;
      pending.then(() => {
        settled = true;
      });
      // The weather retry gives up at 50 ms; the plan call at 3000 ms ends the Tredict sequence
      await jest.advanceTimersByTimeAsync(2999);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      const output = roundTrip(await pending);
      expect(calls.filter(url => url.includes('tredict.com'))).toHaveLength(1);
      expectBasic(output);
      expect(output.tredict.state).toBe('unavailable');
      expect(output.run.kind).toBe('error');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the dark theme in the normal and the fixed error output', async () => {
    const { output } = await board({ fields: { theme: 'dark' } });
    expect(output.theme).toBe('dark');
    const input = makeInput({ fields: { theme: 'dark' } });
    Object.defineProperty(input, 'days', {
      get() {
        throw new Error('boom');
      }
    });
    const error = roundTrip(await buildBoard(input, { fetch: fakeFetch().fetch, now: NOW }));
    expect(error.run.kind).toBe('error');
    expect(error.theme).toBe('dark');
  });

  it('returns the fixed error output when something unexpected throws', async () => {
    const input = makeInput();
    Object.defineProperty(input, 'days', {
      get() {
        throw new Error('boom');
      }
    });
    const output = roundTrip(await buildBoard(input, { fetch: fakeFetch().fetch, now: NOW }));
    expect(output).toEqual({
      v: 1,
      lang: 'en',
      theme: 'light',
      fetchedAt: '2026-11-04T11:00:00.000Z',
      fetchedAtText: 'We 11:00',
      tredict: { state: 'unavailable', message: 'Tredict unavailable' },
      tredictAt: null,
      tredictAtText: '',
      week: null,
      form: null,
      run: { kind: 'error', heading: 'Weather unavailable', lines: [] },
      intensity: null,
      weatherRetryAt: null,
      tredictRetryAt: null,
      // The getter throws after this run's detail calls, so their cache survives
      intensityCache: [
        ['SynAct04xxxxxxxxxxxxxx', 2100, 450, 150],
        ['SynAct03xxxxxxxxxxxxxx', 2100, 450, 150],
        ['SynAct02xxxxxxxxxxxxxx', 2100, 450, 150]
      ],
      attribution: ''
    });
    expect(JSON.stringify(output)).not.toContain('boom');
  });
});

describe('buildBoard: intensity', () => {
  const ACT02 = 'SynAct02xxxxxxxxxxxxxx';
  const ACT03 = 'SynAct03xxxxxxxxxxxxxx';
  const ACT04 = 'SynAct04xxxxxxxxxxxxxx';
  const ACT07 = 'SynAct07xxxxxxxxxxxxxx';
  const HR = [2100, 450, 150];
  const BAR = {
    heading: 'Intensity this week · 2:15',
    segments: [
      { kind: 'low', x: 0, width: 280 },
      { kind: 'moderate', x: 280, width: 60 },
      { kind: 'high', x: 340, width: 20 }
    ],
    labels: ['low 78%', 'moderate 17%', 'high 5%'],
    garmin: ['Synthetic Garmin attribution text']
  };
  const GARMIN = 'Synthetic Garmin attribution text';
  const detailIds = calls =>
    calls.filter(call => call.name === 'detail').map(call => decodeURIComponent(call.url.split('/activity/')[1]));
  const rateLimited = () => ({ status: 429, headers: headersOf({ 'Retry-After': '3600' }), text: async () => '{}' });
  const count = (text, part) => text.split(part).length - 1;

  let cold;

  beforeAll(async () => {
    cold = await board({ previous: {} });
  });

  it("a cold cache fetches this week's runs and shows the bar", () => {
    const tredict = cold.calls.filter(call => call.name !== 'window');
    expect(tredict.map(call => call.name)).toEqual(['plan', 'activities', 'efforts', 'detail', 'detail', 'detail']);
    for (let i = 1; i < tredict.length; i += 1) expect(tredict[i].start).toBeGreaterThan(tredict[i - 1].end);
    expect(detailIds(cold.calls)).toEqual([ACT04, ACT03, ACT02].map(id => `${id}?extraValues=1`));
    expect(cold.output.intensity.heading.startsWith('Intensity this week · ')).toBe(true);
    expect(cold.output.intensity).toEqual(BAR);
    expect(cold.output.intensityCache).toEqual([ACT04, ACT03, ACT02].map(id => [id, ...HR]));
    expect(cold.output.tredict.state).toBe('ok');
  });

  it('shows the bar in Dutch', async () => {
    const { output } = await board({ user: { time_zone_iana: 'Europe/Amsterdam', locale: 'nl-NL' } });
    expect(output.intensity.heading).toBe('Intensiteit deze week · 2:15');
    expect(output.intensity.labels).toEqual(['laag 78%', 'gemiddeld 17%', 'hoog 5%']);
  });

  it('a warm cache makes no detail calls', async () => {
    const { output, calls } = await board({ previous: cold.output });
    expect(detailIds(calls)).toEqual([]);
    expect(output.intensity).toEqual(cold.output.intensity);
    expect(output.intensityCache).toEqual(cold.output.intensityCache);
  });

  it('four new runs: three now, the bar next run', async () => {
    const extra = { ...activitiesWeek._embedded.activityList[3], id: ACT07, date: '2026-11-03T07:00:00.000Z' };
    delete extra._links;
    const activities = { _embedded: { activityList: [...activitiesWeek._embedded.activityList, extra] } };
    const first = await board({ previous: {} }, { activities });
    expect(detailIds(first.calls)).toEqual([ACT04, ACT07, ACT03].map(id => `${id}?extraValues=1`));
    expect(first.output.intensity).toBeNull();
    expect(first.output.intensityCache.map(entry => entry[0])).toEqual([ACT04, ACT07, ACT03]);
    const second = await board({ previous: first.output }, { activities }, NOW + 5 * MINUTE);
    expect(detailIds(second.calls)).toEqual([`${ACT02}?extraValues=1`]);
    expect(second.output.intensity.heading).toBe('Intensity this week · 3:00');
    expect(second.output.intensityCache.map(entry => entry[0])).toEqual([ACT04, ACT07, ACT03, ACT02]);
  });

  it("last week's ids drop out (Review Focus 4)", async () => {
    const previous = {
      intensityCache: [
        ['SynAct01xxxxxxxxxxxxxx', 600, 0, 0],
        ['SynOldxxxxxxxxxxxxxxxx', 1, 2, 3]
      ]
    };
    const { output, calls } = await board({ previous });
    expect(detailIds(calls)).toEqual([ACT04, ACT03, ACT02].map(id => `${id}?extraValues=1`));
    expect(output.intensityCache.map(entry => entry[0])).toEqual([ACT04, ACT03, ACT02]);
    // Monday 00:15 local, before this week's first run: no ids, no calls, no bar
    const monday = await board({ previous: cold.output }, {}, Date.parse('2026-11-01T23:15:00Z'));
    expect(detailIds(monday.calls)).toEqual([]);
    expect(monday.output.intensity).toBeNull();
    expect(monday.output.intensityCache).toEqual([]);
  });

  it('a run without heart rate is cached as zeros', async () => {
    const { output } = await board({ previous: {} }, { details: { [ACT02]: detailNoHr } });
    expect(output.intensityCache).toEqual([
      [ACT04, ...HR],
      [ACT03, ...HR],
      [ACT02, 0, 0, 0]
    ]);
    expect(output.intensity.heading).toBe('Intensity this week · 1:30');
  });

  it('a 2xx without the distribution is cached as zeros', async () => {
    const { output } = await board({ previous: {} }, { details: { [ACT02]: { _id: 'x' } } });
    expect(output.intensityCache[2]).toEqual([ACT02, 0, 0, 0]);
  });

  it('no bar when every run lacks heart rate', async () => {
    const { output } = await board({ previous: {} }, { detail: detailNoHr });
    expect(output.intensityCache).toHaveLength(3);
    expect(output.intensity).toBeNull();
  });

  it('a 404 is cached as zeros, a 503 is retried and ends the detail calls', async () => {
    const { output, calls } = await board({ previous: {} }, { details: { [ACT04]: 404, [ACT03]: 503 } });
    expect(detailIds(calls)).toEqual([ACT04, ACT03].map(id => `${id}?extraValues=1`));
    expect(output.intensityCache).toEqual([[ACT04, 0, 0, 0]]);
    expect(output.intensity).toBeNull();
    expect(output.tredict.state).toBe('ok');
    const next = await board({ previous: output }, {}, NOW + 5 * MINUTE);
    expect(detailIds(next.calls)).toEqual([ACT03, ACT02].map(id => `${id}?extraValues=1`));
    expect(next.output.intensity.heading).toBe('Intensity this week · 1:30');
  });

  it('the first 503 on a detail call ends the detail calls', async () => {
    const { output, calls } = await board({ previous: {} }, { details: { [ACT04]: 503 } });
    expect(detailIds(calls)).toEqual([`${ACT04}?extraValues=1`]);
    expect(output.intensity).toBeNull();
    expect(output.intensityCache).toEqual([]);
    expect(output.tredict.state).toBe('ok');
  });

  it('a 429 on a detail call keeps the panels and pauses', async () => {
    const { output, calls } = await board({ previous: {} }, { details: { [ACT03]: rateLimited } });
    expect(detailIds(calls)).toEqual([ACT04, ACT03].map(id => `${id}?extraValues=1`));
    expect(output.tredict).toEqual({ state: 'ok', message: '' });
    expect(output.week).not.toBeNull();
    expect(output.form).not.toBeNull();
    expect(output.tredictRetryAt).toBe(new Date(NOW + 3600 * SECOND).toISOString());
    expect(output.intensity).toBeNull();
    expect(output.intensityCache).toEqual([[ACT04, ...HR]]);
  });

  it('no detail calls with under a second left', async () => {
    let time = NOW;
    const clock = () => time;
    const slowEfforts = () => {
      time += 3100;
      return { status: 200, headers: headersOf(), text: async () => JSON.stringify(effortsWeek) };
    };
    const { output, calls } = await board({ previous: {}, clock }, { efforts: slowEfforts });
    expect(calls.map(call => call.name)).toEqual(['plan', 'activities', 'efforts']);
    expect(output.tredict.state).toBe('ok');
    expect(output.intensity).toBeNull();
    expect(output.intensityCache).toEqual([]);
  });

  it('stops detail calls once under a second is left', async () => {
    let time = NOW;
    const clock = () => time;
    const slowDetail = () => {
      time += 2000;
      return { status: 200, headers: headersOf(), text: async () => JSON.stringify({ _id: 'x' }) };
    };
    const { calls } = await board({ previous: {}, clock }, { detail: slowDetail });
    // 4000 ms: 2000 left after the first detail, 0 after the second
    expect(detailIds(calls)).toHaveLength(2);
  });

  it('the Garmin run adds its attribution', () => {
    expect(cold.output.week.garmin).toContain(GARMIN);
    expect(count(cold.output.attribution, GARMIN)).toBe(1);
    expect(cold.output.attribution.endsWith(windowOk.attribution)).toBe(true);
  });

  // Two more Monday runs push the Garmin run (Act03) off its day's two rows, so only the bar shows it
  const offRows = () => {
    const list = activitiesWeek._embedded.activityList;
    const more = [1, 2].map(n => ({
      ...list[3],
      id: `SynAct1${n}xxxxxxxxxxxxxx`,
      date: `2026-11-02T0${n}:00:00.000Z`
    }));
    const ids = [ACT04, ACT03, ACT02, ...more.map(activity => activity.id)];
    return { activities: { _embedded: { activityList: [...list, ...more] } }, ids };
  };

  it('a Garmin run beyond the rows a day shows still adds its attribution', async () => {
    const { activities, ids } = offRows();
    const previous = { intensityCache: ids.map(id => [id, ...HR]) };
    const { output } = await board({ previous }, { activities });
    expect(output.week.garmin).not.toContain(GARMIN);
    expect(count(output.attribution, GARMIN)).toBe(1);
    expect(output.intensity.garmin).toEqual([GARMIN]);
  });

  it('stale panels keep the attribution of a Garmin run only the bar shows', async () => {
    const { activities, ids } = offRows();
    const previous = { intensityCache: ids.map(id => [id, ...HR]) };
    const first = (await board({ previous }, { activities }, NOW - 2 * 60 * MINUTE)).output;
    expect(first.week.garmin).not.toContain(GARMIN);
    const { output } = await board({ previous: first }, { activities, efforts: 503 });
    expect(output.tredict.state).toBe('stale');
    expect(output.intensity).toEqual(first.intensity);
    expect(count(output.attribution, GARMIN)).toBe(1);
  });

  it('a cached Garmin run adds no text while the bar is incomplete', async () => {
    const { activities, ids } = offRows();
    const previous = { intensityCache: ids.filter(id => id !== ACT02).map(id => [id, ...HR]) };
    const { output } = await board({ previous }, { activities, details: { [ACT02]: 503 } });
    expect(output.intensity).toBeNull();
    expect(output.intensityCache.map(entry => entry[0])).toContain(ACT03);
    expect(count(output.attribution, GARMIN)).toBe(0);
  });

  it('stale panels drop non-string Garmin texts of a reused bar', async () => {
    const first = (await board({ previous: {} }, {}, NOW - 2 * 60 * MINUTE)).output;
    const intensity = { ...first.intensity, garmin: [5, { x: 1 }, 'Kept text'] };
    const { output } = await board({ previous: { ...first, intensity } }, { efforts: 503 });
    expect(output.intensity.garmin).toEqual(['Kept text']);
    expect(count(output.attribution, 'Kept text')).toBe(1);
  });

  it('stale panels keep the bar', async () => {
    const first = (await board({ previous: {} }, {}, NOW - 2 * 60 * MINUTE)).output;
    const { output, calls } = await board({ previous: first }, { efforts: 503 });
    expect(output.tredict.state).toBe('stale');
    expect(output.intensity).toEqual(first.intensity);
    expect(output.intensityCache).toEqual(first.intensityCache);
    expect(detailIds(calls)).toEqual([]);
  });

  it('stale panels drop a malformed bar', async () => {
    const first = (await board({ previous: {} }, {}, NOW - 2 * 60 * MINUTE)).output;
    const bad = [
      { ...first.intensity, heading: 5 },
      { ...first.intensity, segments: [{ kind: 'extreme', x: 0, width: 360 }] },
      { ...first.intensity, segments: [{ kind: 'low', x: 'x', width: 360 }] },
      { ...first.intensity, labels: ['a', 'b'] },
      'x'
    ];
    for (const intensity of bad) {
      const { output } = await board({ previous: { ...first, intensity } }, { efforts: 503 });
      expect(output.tredict.state).toBe('stale');
      expect(output.intensity).toBeNull();
    }
    const extra = { ...first.intensity, note: TOKEN, segments: first.intensity.segments.map(s => ({ ...s, y: 1 })) };
    const { output } = await board({ previous: { ...first, intensity: extra } }, { efforts: 503 });
    expect(output.intensity).toEqual(first.intensity);
  });

  it.each([
    ['paused', { plan: 401 }],
    ['auth', { plan: 403 }],
    ['payment', { efforts: 402 }]
  ])('%s shows no bar and carries the cache', async (state, overrides) => {
    const { output, calls } = await board({ previous: cold.output }, overrides);
    expect(output.tredict.state).toBe(state);
    expect(output.intensity).toBeNull();
    expect(output.intensityCache).toEqual(cold.output.intensityCache);
    expect(detailIds(calls)).toEqual([]);
  });

  it('unavailable without stale data shows no bar and carries the cache', async () => {
    const previous = { intensityCache: cold.output.intensityCache };
    const { output } = await board({ previous }, { efforts: 503 });
    expect(output.tredict.state).toBe('unavailable');
    expect(output.intensity).toBeNull();
    expect(output.intensityCache).toEqual(cold.output.intensityCache);
  });

  it('a pause in force carries the bar and the cache', async () => {
    const previous = { ...cold.output, tredictRetryAt: new Date(NOW + 10 * MINUTE).toISOString() };
    const { output, calls } = await board({ previous }, {}, NOW + MINUTE);
    expect(calls).toEqual([]);
    expect(output.tredict.state).toBe('stale');
    expect(output.intensity).toEqual(cold.output.intensity);
    expect(output.intensityCache).toEqual(cold.output.intensityCache);
  });

  it('a malformed cache is ignored', async () => {
    for (const intensityCache of ['x', [[1, 2]]]) {
      const { output, calls } = await board({ previous: { intensityCache } });
      expect(detailIds(calls)).toHaveLength(3);
      expect(output.intensity).toEqual(BAR);
      expect(output.intensityCache).toEqual(cold.output.intensityCache);
    }
  });

  it('first run after the upgrade (Review Focus 1)', async () => {
    const v1 = (await board({ previous: {} }, {}, NOW - 2 * 60 * MINUTE)).output;
    delete v1.intensityCache;
    delete v1.tredictRetryAt;
    delete v1.intensity;
    const { output, calls } = await board({ previous: v1 });
    expect(output.tredict).toEqual({ state: 'ok', message: '' });
    expect(detailIds(calls)).toHaveLength(3);
    expect(output.intensity).toEqual(BAR);
    expect(output.tredictRetryAt).toBeNull();
  });
});
