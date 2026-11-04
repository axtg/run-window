const { buildBoard } = require('../../integrations/trmnl-running-board/src/board');
const { loadTransform } = require('./harness');
const { windowOk, NOW, TOKEN, MINUTE, fakeFetch, makeInput, roundTrip, board } = require('./boardCases');

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

  it('makes three Tredict calls with the token and no weather retry', () => {
    expect(calls.map(call => call.name).sort()).toEqual(['activities', 'efforts', 'plan']);
    for (const call of calls) expect(call.options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('leaks no coordinates, summaries or token and stays under 10 KB', () => {
    const json = JSON.stringify(output);
    expect(json).not.toContain('positionLat');
    expect(json).not.toContain('summary');
    expect(json).not.toContain('Bearer');
    expect(json).not.toContain(TOKEN);
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
  it.each(['plan', 'activities', 'efforts'])('turns a 401 on %s into auth', async name => {
    const { output } = await board({}, { [name]: 401 });
    expect(output.tredict.state).toBe('auth');
    expect(output.tredict.message).toContain('Tredict token invalid');
    expect(output.week).toBeNull();
    expect(output.form).toBeNull();
    expect(output.tredictAt).toBeNull();
    expect(output.tredictAtText).toBe('');
    expect(output.run.kind).toBe('window');
    if (name === 'plan') expect(output.run.heading).toBe('BEST TIME TODAY · 60 min');
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

  it('prefers auth over payment over unavailable', async () => {
    expect((await board({}, { plan: 503, activities: 402, efforts: 401 })).output.tredict.state).toBe('auth');
    expect((await board({}, { plan: 503, activities: 402 })).output.tredict.state).toBe('payment');
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

  it('handles a fetch that never resolves within the timeout', async () => {
    const fetch = () => new Promise(() => {});
    const started = Date.now();
    const output = roundTrip(await buildBoard(makeInput({ body: {} }), { fetch, now: NOW, timeoutMs: 50 }));
    expect(Date.now() - started).toBeLessThan(1000);
    expectBasic(output);
    expect(output.tredict.state).toBe('unavailable');
    expect(output.run.kind).toBe('error');
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
      fetchedAt: '2026-11-04T11:00:00.000Z',
      fetchedAtText: 'We 11:00',
      tredict: { state: 'unavailable', message: 'Tredict unavailable' },
      tredictAt: null,
      tredictAtText: '',
      week: null,
      form: null,
      run: { kind: 'error', heading: 'Weather unavailable', lines: [] },
      weatherRetryAt: null,
      attribution: ''
    });
    expect(JSON.stringify(output)).not.toContain('boom');
  });
});
