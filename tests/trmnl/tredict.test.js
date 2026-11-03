const {
  TREDICT_BASE,
  tredictRange,
  tredictUrls,
  fetchJson
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
    [401, 'auth'],
    [403, 'auth'],
    [402, 'payment'],
    [500, 'unavailable'],
    [404, 'unavailable']
  ])('classifies %i as %s', async (status, kind) => {
    await expect(fetchJson(respond(status, 'x'), URL_, 't')).resolves.toEqual({ ok: false, kind, status });
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
