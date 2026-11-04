// Privacy smoke test for public/app.js: loads the page's five scripts in a vm with a minimal fake DOM, opens a route
// and checks that only the rounded start point leaves the page, and that nothing from the file reaches storage or the
// URL. The fake fetch forwards to the real Express app, so the test also shows the API accepts what the page sends.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');
const { DOMParser } = require('@xmldom/xmldom');

const { createApp } = require('../../app');
const { parseForecast } = require('../../lib/forecast');
const { makeForecastJson } = require('../helpers/forecast');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const SCRIPTS = ['route.js', 'plan.js', 'strip.js', 'settings.js', 'app.js']; // the order in index.html
const FILE_NAME = 'hill-loop.gpx';
const GPX = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'routes', FILE_NAME), 'utf8');
const ROUTE_NAME = 'Hill test loop';
const ORIGIN = 'https://run.xadi.eu';
const NOW = Date.UTC(2026, 10, 2, 9, 0, 0);
const QUERY_KEYS = ['avail', 'dark', 'lat', 'lon', 'rain', 'slots'];

// Every coordinate in the fixture written with more than 2 decimals: none of them may leave memory.
const PRECISE_COORDS = [...GPX.matchAll(/(?:lat|lon)="(-?\d+\.\d{3,})"/g)].map(match => match[1]);

const weather = {
  getForecast: jest.fn().mockResolvedValue({
    forecast: parseForecast(
      makeForecastJson({
        startMs: Date.UTC(2026, 10, 1, 23),
        hours: 96,
        sun: [
          { sunriseMs: Date.UTC(2026, 10, 2, 6, 38), sunsetMs: Date.UTC(2026, 10, 2, 16, 9) },
          { sunriseMs: Date.UTC(2026, 10, 3, 6, 40), sunsetMs: Date.UTC(2026, 10, 3, 16, 7) }
        ]
      })
    ),
    stale: false
  }),
  stats: jest.fn().mockReturnValue({})
};
const api = createApp({ weather, now: () => NOW });

// Only what app.js touches on its elements.
function fakeElement() {
  const listeners = {};
  return {
    textContent: '',
    value: '',
    hidden: false,
    files: null,
    attributes: {},
    children: [],
    listeners,
    parentElement: { getBoundingClientRect: () => ({ width: 360, left: 0 }) },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    appendChild(child) {
      this.children.push(child);
    },
    replaceChildren() {
      this.children = [];
    },
    getBoundingClientRect: () => ({ width: 360, left: 0 })
  };
}

class QuietDOMParser extends DOMParser {
  constructor() {
    super({ onError() {} });
  }
}

function loadPage() {
  const elements = new Map();
  const record = { fetches: [], storage: [], history: [] };
  const store = new Map();
  const sandbox = {
    URL,
    URLSearchParams,
    DOMParser: QuietDOMParser,
    location: { origin: ORIGIN, search: '' },
    navigator: {},
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, fakeElement());
        return elements.get(id);
      },
      createElementNS: () => fakeElement()
    },
    localStorage: {
      getItem(key) {
        record.storage.push({ op: 'get', key });
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        record.storage.push({ op: 'set', key, value: String(value) });
        store.set(key, String(value));
      }
    },
    history: {
      replaceState(_state, _title, url) {
        record.history.push(String(url));
      },
      pushState(_state, _title, url) {
        record.history.push(String(url));
      }
    },
    caches: {
      open: async () => ({ match: async () => undefined, put: async () => {} }),
      delete: async () => true
    },
    addEventListener() {},
    async fetch(url) {
      record.fetches.push(String(url));
      const target = new URL(url);
      const response = await request(api).get(target.pathname + target.search);
      return {
        ok: response.status < 400,
        status: response.status,
        headers: { get: name => response.headers[name.toLowerCase()] || null },
        json: async () => response.body
      };
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, name), 'utf8'), sandbox, { filename: name });
  }
  return { sandbox, elements, record, store };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function leaks(text) {
  const found = [ROUTE_NAME, FILE_NAME, ...PRECISE_COORDS].filter(secret => text.includes(secret));
  return found;
}

describe('app.js privacy smoke test', () => {
  const rejections = [];
  const onRejection = reason => rejections.push(reason);
  beforeAll(() => process.on('unhandledRejection', onRejection));
  afterAll(() => process.off('unhandledRejection', onRejection));

  it('sends only the rounded start point and keeps the route out of storage and the URL', async () => {
    expect(PRECISE_COORDS.length).toBeGreaterThan(0);
    const { sandbox, elements, record, store } = loadPage();

    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();

    expect(rejections).toEqual([]);
    expect(elements.get('source').textContent).toBe(ROUTE_NAME); // the route was read
    expect(elements.get('result').hidden).toBe(false); // and the answer drawn

    expect(record.fetches).toHaveLength(1);
    const url = new URL(record.fetches[0]);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/api/window');
    expect([...url.searchParams.keys()].sort()).toEqual(QUERY_KEYS);
    expect(url.searchParams.get('lat')).toMatch(/^-?\d+(\.\d{1,2})?$/);
    expect(url.searchParams.get('lon')).toMatch(/^-?\d+(\.\d{1,2})?$/);
    expect(url.searchParams.get('slots')).toBe('1');
    expect(leaks(record.fetches[0])).toEqual([]);

    // A settings change after opening the route writes to storage, so the storage check has something to inspect.
    elements.get('chip-dark').listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    const writes = record.storage.filter(entry => entry.op === 'set');
    expect(writes.length).toBeGreaterThan(0);
    for (const { key, value } of writes) expect(leaks(`${key} ${value}`)).toEqual([]);
    for (const [key, value] of store) expect(leaks(`${key} ${value}`)).toEqual([]);
    for (const historyUrl of record.history) expect(leaks(historyUrl)).toEqual([]);
    for (const fetched of record.fetches) expect(leaks(fetched)).toEqual([]);
  });
});
