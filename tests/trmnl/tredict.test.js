const {
  TREDICT_BASE,
  tredictRange,
  tredictUrls,
  detailUrl,
  retryAfterSeconds,
  fetchJson,
  tredictSequence
} = require('../../integrations/trmnl-running-board/src/tredict');

const AMS = 'Europe/Amsterdam';

describe('tredictRange', () => {
  it('runs from the day before this Monday to the end of the day after next Monday', () => {
    expect(tredictRange(Date.parse('2026-11-04T10:00:00Z'), AMS)).toEqual({
      from: '2026-10-31T23:00:00.000Z',
      to: '2026-11-10T22:59:59.999Z'
    });
  });

  it('uses the local week on Sunday 23:30 and keeps the CEST offset for the start', () => {
    expect(tredictRange(Date.parse('2026-11-01T22:30:00Z'), AMS).from).toBe('2026-10-24T22:00:00.000Z');
  });
});

describe('tredictUrls', () => {
  it('builds the three endpoints with the range', () => {
    const range = { from: '2026-10-31T23:00:00.000Z', to: '2026-11-10T22:59:59.999Z' };
    const urls = tredictUrls(range);
    expect(TREDICT_BASE).toBe('https://www.tredict.com/api/oauth/v2/');
    expect(urls.plan.startsWith(`${TREDICT_BASE}plannedTrainingList?`)).toBe(true);
    expect(urls.activities.startsWith(`${TREDICT_BASE}activityList?`)).toBe(true);
    expect(urls.efforts.startsWith(`${TREDICT_BASE}efforts`)).toBe(true);
    expect(urls.plan).toContain(`startDate=${encodeURIComponent(range.from)}`);
    expect(urls.activities).toContain('extendedSummary=1');
    expect(urls.activities).toContain('pageSize=50');
    expect(urls.plan).toContain(`endDate=${encodeURIComponent(range.to)}`);
    expect(urls.efforts).toBe(`${TREDICT_BASE}efforts`);
  });
});

describe('fetchJson', () => {
  const respond = (status, body) =>
    jest.fn(async () => ({ status, ok: status >= 200 && status < 300, text: async () => body }));
  const URL_ = 'https://www.tredict.com/api/oauth/v2/efforts';

  it('returns parsed JSON on 200 and sends both headers, the token only in Authorization', async () => {
    const fetch = respond(200, '{"a":1}');
    await expect(fetchJson(fetch, URL_, 'tok123')).resolves.toEqual({ ok: true, data: { a: 1 } });
    const [calledUrl, options] = fetch.mock.calls[0];
    expect(calledUrl).toBe(URL_);
    expect(options.headers).toEqual({
      Authorization: 'Bearer tok123',
      Accept: 'application/json;charset=UTF-8'
    });
    expect(options.signal).toBeDefined();
    expect(calledUrl).not.toContain('tok123');
  });

  it.each([
    [401, 'paused'],
    [403, 'auth'],
    [402, 'payment'],
    [500, 'unavailable'],
    [404, 'missing']
  ])('classifies %i as %s', async (status, kind) => {
    await expect(fetchJson(respond(status, 'x'), URL_, 't')).resolves.toEqual({ ok: false, kind, status });
  });

  it('maps 429 to rate with a null Retry-After when there are no headers', async () => {
    await expect(fetchJson(respond(429, 'x'), URL_, 't')).resolves.toEqual({
      ok: false,
      kind: 'rate',
      status: 429,
      retryAfterS: null
    });
  });

  it('reads Retry-After seconds on a 429', async () => {
    const withHeader = value =>
      jest.fn(async () => ({
        status: 429,
        text: async () => '',
        headers: { get: name => (name === 'retry-after' ? value : null) }
      }));
    await expect(fetchJson(withHeader('120'), URL_, 't')).resolves.toMatchObject({ kind: 'rate', retryAfterS: 120 });
    await expect(fetchJson(withHeader('Wed, 21 Oct 2026 07:28:00 GMT'), URL_, 't')).resolves.toMatchObject({
      retryAfterS: null
    });
    expect(retryAfterSeconds({})).toBeNull();
    expect(
      retryAfterSeconds({
        headers: {
          get: () => {
            throw new Error('x');
          }
        }
      })
    ).toBeNull();
  });

  it('treats an HTML 200 body as unavailable', async () => {
    await expect(fetchJson(respond(200, '<html>'), URL_, 't')).resolves.toEqual({
      ok: false,
      kind: 'unavailable',
      status: 200
    });
  });

  it('treats a rejected fetch as unavailable with no status', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('network');
    });
    await expect(fetchJson(fetch, URL_, 't')).resolves.toEqual({ ok: false, kind: 'unavailable', status: null });
  });

  it('treats a body read failure as unavailable', async () => {
    const fetch = jest.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => {
        throw new Error('broken');
      }
    }));
    await expect(fetchJson(fetch, URL_, 't')).resolves.toMatchObject({ ok: false, kind: 'unavailable' });
  });

  it('settles within the timeout when fetch ignores the signal (Review Focus 5)', async () => {
    const fetch = jest.fn(() => new Promise(() => {}));
    const started = Date.now();
    const result = await fetchJson(fetch, URL_, 't', 50);
    expect(result).toEqual({ ok: false, kind: 'unavailable', status: null });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetch.mock.calls[0][1].signal).toBeDefined();
  });

  it('answers auth without calling fetch when there is no token', async () => {
    const fetch = jest.fn();
    for (const token of ['', undefined, null]) {
      await expect(fetchJson(fetch, URL_, token)).resolves.toEqual({ ok: false, kind: 'auth', status: null });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never rejects when fetch throws synchronously', async () => {
    const fetch = jest.fn(() => {
      throw new Error('sync');
    });
    await expect(fetchJson(fetch, URL_, 't')).resolves.toMatchObject({ ok: false, kind: 'unavailable' });
  });
});

describe('detailUrl', () => {
  it('encodes the id', () => {
    expect(detailUrl('a/b')).toBe(`${TREDICT_BASE}activity/a%2Fb?extraValues=1`);
  });
});

describe('tredictSequence', () => {
  const URL_ = 'https://www.tredict.com/api/oauth/v2/efforts';
  const ok = { status: 200, text: async () => '{}' };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  it('starts no call before the previous one settled', async () => {
    const events = [];
    let n = 0;
    const fetch = jest.fn(async () => {
      const id = ++n;
      events.push(`start${id}`);
      await sleep(20);
      events.push(`end${id}`);
      return ok;
    });
    const sequence = tredictSequence({ fetch, token: 't' });
    await Promise.all([sequence.call(URL_), sequence.call(URL_), sequence.call(URL_)]);
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
  });

  it('stops after a 429', async () => {
    const answers = [ok, { status: 429, text: async () => '' }, ok];
    const fetch = jest.fn(async () => answers.shift());
    const sequence = tredictSequence({ fetch, token: 't' });
    await sequence.call(URL_);
    expect(sequence.stopped()).toBe(false);
    await expect(sequence.call(URL_)).resolves.toMatchObject({ ok: false, kind: 'rate' });
    expect(sequence.stopped()).toBe(true);
    await expect(sequence.call(URL_)).resolves.toEqual({ ok: false, kind: 'skipped' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sequence.rate()).toEqual({ retryAfterS: null });
  });

  it('shrinks timeouts to the deadline', async () => {
    let now = 0;
    let calls = 0;
    const fetch = jest.fn(() => {
      if (++calls === 1) {
        now = 3200;
        return Promise.resolve(ok);
      }
      return new Promise(() => {});
    });
    const sequence = tredictSequence({ fetch, token: 't', clock: () => now });
    await sequence.call(URL_);
    expect(sequence.remaining()).toBe(800);
    const started = Date.now();
    await expect(sequence.call(URL_)).resolves.toEqual({ ok: false, kind: 'unavailable', status: null });
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(700);
    expect(waited).toBeLessThan(1500);
  });

  it('refuses to start with under 500 ms left', async () => {
    let now = 0;
    const fetch = jest.fn();
    const sequence = tredictSequence({ fetch, token: 't', clock: () => now });
    now = 3600;
    await expect(sequence.call(URL_)).resolves.toEqual({ ok: false, kind: 'unavailable', status: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a late resolve after the timer (Review Focus 5)', async () => {
    const begin = Date.now();
    const starts = [];
    let n = 0;
    const fetch = jest.fn(async () => {
      starts.push(Date.now() - begin);
      if (++n === 1) {
        await sleep(900);
        return ok;
      }
      return ok;
    });
    // The fake clock leaves 550 ms, so the first call times out at 550 ms although fetch resolves at 900 ms
    let now = 0;
    const sequence = tredictSequence({ fetch, token: 't', clock: () => now });
    now = 3450;
    const [first, second] = await Promise.all([sequence.call(URL_), sequence.call(URL_)]);
    expect(first).toEqual({ ok: false, kind: 'unavailable', status: null });
    expect(second).toEqual({ ok: true, data: {} });
    expect(starts[1]).toBeGreaterThanOrEqual(500);
    expect(starts[1]).toBeLessThan(850);
  });
});
