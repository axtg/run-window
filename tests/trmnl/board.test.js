const { buildBoard } = require('../../integrations/trmnl-running-board/src/board');
const { loadTransform } = require('./harness');

const windowOk = require('../fixtures/trmnl/window-ok.json');
const plannedWeek = require('../fixtures/tredict/planned-week.json');
const activitiesWeek = require('../fixtures/tredict/activities-week.json');
const effortsWeek = require('../fixtures/tredict/efforts-week.json');

const NOW = Date.parse('2026-11-04T11:00:00Z');
const TOKEN = 'synthetic-token-value-123';
const MINUTE = 60000;

// Routes by URL to fixtures; `overrides` maps a route name to a status, a body, or a function returning a response
function fakeFetch(overrides = {}) {
  const calls = [];
  const bodies = {
    plan: plannedWeek,
    activities: activitiesWeek,
    efforts: effortsWeek,
    window: windowOk
  };
  const route = url => {
    if (url.includes('plannedTrainingList')) return 'plan';
    if (url.includes('activityList')) return 'activities';
    if (url.includes('/efforts')) return 'efforts';
    if (url.startsWith('https://run.xadi.eu/api/window')) return 'window';
    return 'unknown';
  };
  const fetch = async (url, options = {}) => {
    const name = route(url);
    calls.push({ name, url, options });
    const override = overrides[name];
    if (typeof override === 'function') return override(url, options);
    if (typeof override === 'number') return { status: override, text: async () => '{"error":"x"}' };
    const body = override !== undefined ? override : bodies[name];
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

function makeInput({ body = windowOk, fields = {}, previous, user } = {}) {
  return {
    ...body,
    trmnl: {
      user: user || { time_zone_iana: 'Europe/Amsterdam', locale: 'en' },
      plugin_settings: {
        custom_fields_values: { tredict_token: TOKEN, lat_lon: '52.37,4.89', ...fields }
      },
      previous_merge_variables: previous === undefined ? {} : previous
    }
  };
}

const roundTrip = value => JSON.parse(JSON.stringify(value));

async function board(options = {}, fetchOverrides = {}, now = NOW) {
  const fake = fakeFetch(fetchOverrides);
  const output = await buildBoard(makeInput(options), { fetch: fake.fetch, now });
  return { output: roundTrip(output), calls: fake.calls };
}

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
    expect(output.tredict.message).toContain('Tredict token paused or invalid');
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

    it('treats efforts without keys as unavailable (Review Focus 2)', async () => {
      const { output } = await board({ previous: first }, { efforts: { trainingEfforts: {} } });
      expect(output.tredict.state).toBe('stale');
      const { output: fresh } = await board({ previous: null }, { efforts: { trainingEfforts: {} } });
      expect(fresh.tredict.state).toBe('unavailable');
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

  it('does not retry within 30 minutes of a weather error', async () => {
    const previous = { v: 1, fetchedAt: new Date(NOW - 20 * MINUTE).toISOString(), run: { kind: 'error' } };
    const { output, calls } = await board({ body: {}, previous });
    expect(calls.some(call => call.name === 'window')).toBe(false);
    expect(output.run.kind).toBe('error');
  });

  it('retries again 30 minutes after a weather error', async () => {
    const previous = { v: 1, fetchedAt: new Date(NOW - 31 * MINUTE).toISOString(), run: { kind: 'error' } };
    const { calls } = await board({ body: {}, previous });
    expect(calls.some(call => call.name === 'window')).toBe(true);
  });

  it('does not retry without a location', async () => {
    const { output, calls } = await board({ body: {}, fields: { lat_lon: '' } });
    expect(calls.some(call => call.name === 'window')).toBe(false);
    expect(output.run.kind).toBe('noLocation');
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
      fetchedAt: '2026-11-04T11:00:00.000Z',
      fetchedAtText: '',
      tredict: { state: 'unavailable', message: 'Tredict unavailable' },
      tredictAt: null,
      tredictAtText: '',
      week: null,
      form: null,
      run: { kind: 'error', heading: 'Weather unavailable', lines: [] },
      attribution: ''
    });
    expect(JSON.stringify(output)).not.toContain('boom');
  });
});
