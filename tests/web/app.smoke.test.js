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

// Only what app.js touches on its elements. Elements from createElement are kept too, so a test can reach the
// controls app.js builds (the hour rows).
const focusLog = [];

function fakeElement(tagName = 'div') {
  const listeners = {};
  return {
    tagName,
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    files: null,
    attributes: {},
    children: [],
    listeners,
    open: false,
    parentElement: { getBoundingClientRect: () => ({ width: 360, left: 0 }) },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return name in this.attributes ? this.attributes[name] : null;
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    focus() {
      focusLog.push(this);
    },
    getBoundingClientRect: () => ({ width: 360, left: 0 })
  };
}

class QuietDOMParser extends DOMParser {
  constructor() {
    super({ onError() {} });
  }
}

function loadPage({ navigator = {}, stored = null } = {}) {
  const elements = new Map();
  const created = [];
  const record = { fetches: [], storage: [], history: [] };
  const store = new Map();
  if (stored !== null) store.set('run-window-settings', stored);
  const sandbox = {
    URL,
    URLSearchParams,
    DOMParser: QuietDOMParser,
    location: { origin: ORIGIN, search: '' },
    navigator,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, fakeElement());
        return elements.get(id);
      },
      createElement(tagName) {
        const node = fakeElement(tagName);
        created.push(node);
        return node;
      },
      createElementNS: (_ns, tagName) => fakeElement(tagName)
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
  return { sandbox, elements, created, record, store };
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
    elements.get('dark-ok').listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    const writes = record.storage.filter(entry => entry.op === 'set');
    expect(writes.length).toBeGreaterThan(0);
    for (const { key, value } of writes) expect(leaks(`${key} ${value}`)).toEqual([]);
    for (const [key, value] of store) expect(leaks(`${key} ${value}`)).toEqual([]);
    for (const historyUrl of record.history) expect(leaks(historyUrl)).toEqual([]);
    for (const fetched of record.fetches) expect(leaks(fetched)).toEqual([]);
  });
  it('saves only the five settings and asks once per settled change that alters the request', async () => {
    const { sandbox, elements, record, store } = loadPage();
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    expect(record.fetches).toHaveLength(1);

    // Pace is not part of the request (the response holds every run length), so it redraws without asking again.
    const paceBefore = elements.get('pace-input').value;
    elements.get('pace-up').listeners.click();
    await flush();
    expect(elements.get('pace-input').value).not.toBe(paceBefore);
    expect(record.fetches).toHaveLength(1);

    elements.get('add-hours').listeners.click();
    await flush();
    expect(record.fetches).toHaveLength(2);

    const rain = elements.get('rain-input');
    rain.value = '55';
    rain.listeners.input(); // dragging: the value text only
    await flush();
    expect(record.fetches).toHaveLength(2);
    rain.listeners.change(); // released: one request
    await flush();
    expect(record.fetches).toHaveLength(3);

    expect(rejections).toEqual([]);
    expect([...store.keys()]).toEqual([sandbox.RunSettings.STORAGE_KEY]);
    const saved = JSON.parse(store.get(sandbox.RunSettings.STORAGE_KEY));
    expect(Object.keys(saved).sort()).toEqual(['allowDark', 'durationMin', 'hours', 'paceSec', 'rain']);
    expect(saved).toMatchObject({ paceSec: 365, hours: '10-16,16-17', rain: 55 });

    for (const fetched of record.fetches) {
      const url = new URL(fetched);
      expect(url.origin).toBe(ORIGIN);
      expect([...url.searchParams.keys()].sort()).toEqual(QUERY_KEYS);
      expect(url.searchParams.get('lat')).toMatch(/^-?\d+(\.\d{1,2})?$/);
      expect(url.searchParams.get('lon')).toMatch(/^-?\d+(\.\d{1,2})?$/);
      expect(leaks(fetched)).toEqual([]);
    }
    expect(new URL(record.fetches[2]).searchParams.get('avail')).toBe('10-16,16-17');
    expect(new URL(record.fetches[2]).searchParams.get('rain')).toBe('55');
    for (const historyUrl of record.history) expect(leaks(historyUrl)).toEqual([]);
  });

  it('moving an hour handle asks once, on release, with the clamped hours', async () => {
    const { sandbox, created, record, store } = loadPage();
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    const end = created.find(node => node.tagName === 'input' && node.attributes['aria-label'] === 'End of hours 1');
    expect(end).toBeDefined();
    expect(end.attributes['aria-valuetext']).toBe('16'); // the stored text, read out instead of the number
    end.value = '18';
    end.listeners.input();
    end.value = '20';
    end.listeners.input();
    expect(record.fetches).toHaveLength(1);
    end.listeners.change();
    await flush();
    expect(rejections).toEqual([]);
    expect(record.fetches).toHaveLength(2);
    expect(new URL(record.fetches[1]).searchParams.get('avail')).toBe('10-20');
    expect(JSON.parse(store.get(sandbox.RunSettings.STORAGE_KEY)).hours).toBe('10-20');
  });

  it('says the location is off and asks nothing when location is denied', async () => {
    const geolocation = { getCurrentPosition: (onOk, onError) => onError({ code: 1 }) };
    const { elements, record } = loadPage({ navigator: { geolocation } });
    elements.get('use-location').listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    expect(elements.get('status').textContent).toBe('Location is off. Open a route file instead.');
    expect(record.fetches).toHaveLength(0);
  });
  it('reads a half-hour bound out as stored and moves focus to a remaining row after a removal', async () => {
    const { created } = loadPage({ stored: JSON.stringify({ hours: '07:30-09,12-14' }) });
    const label = name => created.filter(node => node.attributes['aria-label'] === name).pop();
    expect(label('Start of hours 1').attributes['aria-valuetext']).toBe('07:30');
    expect(label('Start of hours 1').value).toBe('8');
    expect(label('End of hours 2').attributes['aria-valuetext']).toBe('14');
    focusLog.length = 0;
    label('Remove hours 2').listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    expect(focusLog.pop()).toBe(label('Start of hours 1'));
  });
});
