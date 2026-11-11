// Privacy smoke test for public/app.js: loads the page's six scripts in a vm with a minimal fake DOM, opens a route
// and checks that only the rounded start point leaves the page, and that nothing from the file reaches storage or the
// URL. The fake fetch forwards to the real Express app, so the test also shows the API accepts what the page sends.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks'); // not the global one, which Jest's fake timers replace
const request = require('supertest');
const { DOMParser } = require('@xmldom/xmldom');
const { resolveObjectURL } = require('buffer');

const { createApp } = require('../../app');
const { parseForecast } = require('../../lib/forecast');
const { makeForecastJson } = require('../helpers/forecast');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const SCRIPTS = ['analytics.js', 'route.js', 'plan.js', 'strip.js', 'settings.js', 'app.js']; // as in index.html
const FILE_NAME = 'hill-loop.gpx';
const GPX = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'routes', FILE_NAME), 'utf8');
const ROUTE_NAME = 'Hill test loop';
const ORIGIN = 'https://besttimetorun.com';
const NOW = Date.UTC(2026, 10, 2, 9, 0, 0);
const QUERY_KEYS = ['avail', 'dark', 'lat', 'lon', 'prefer', 'rain', 'slots'];

// Every coordinate in the fixture written with more than 2 decimals: none of them may leave memory.
const PRECISE_COORDS = [...GPX.matchAll(/(?:lat|lon)="(-?\d+\.\d{3,})"/g)].map(match => match[1]);

const CAPACITY = { perDay: 300, remainingShare: 0.85, full: false, asOf: 'a', resetsAt: 'b' };

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
  stats: jest.fn().mockReturnValue({}),
  capacity: () => CAPACITY
};
// A high rate limit: these tests load many pages in quick succession through one app, and are not about the limit.
const api = createApp({ weather, now: () => NOW, rateLimit: 1000 });

// An app of its own for a test that needs other weather. `values(i)` overrides hour i (Open-Meteo names).
function apiWith(values) {
  const forecast = parseForecast(
    makeForecastJson({
      startMs: Date.UTC(2026, 10, 1, 23),
      hours: 96,
      sun: [
        { sunriseMs: Date.UTC(2026, 10, 2, 6, 38), sunsetMs: Date.UTC(2026, 10, 2, 16, 9) },
        { sunriseMs: Date.UTC(2026, 10, 3, 6, 40), sunsetMs: Date.UTC(2026, 10, 3, 16, 7) }
      ],
      values
    })
  );
  const own = {
    getForecast: jest.fn().mockResolvedValue({ forecast, stale: false }),
    stats: () => ({}),
    capacity: () => CAPACITY
  };
  return createApp({ weather: own, now: () => NOW, rateLimit: 1000 });
}
const geolocation = { getCurrentPosition: onOk => onOk({ coords: { latitude: 52.3702, longitude: 4.8952 } }) };

// Only what app.js touches on its elements. Elements from createElement are kept too, so a test can reach the
// controls app.js builds (the hour rows).
const focusLog = [];

// SVG elements, as in a browser, have no reflected `hidden` property: assigning `.hidden` only adds an expando that
// changes nothing. They hide through the attribute alone, which isHidden() reads. Ids of the page's SVG elements:
const SVG_IDS = new Set([
  'wind-compass',
  'wind-arrow',
  'copy-icon',
  'copy-check',
  'timeline',
  'rain-fill',
  'quota-bar',
  'quota-fill',
  'quota-saturate'
]);
// The page's markup starts these hidden.
const HIDDEN_IN_HTML = new Set(['copy-check', 'quota-bar']);

const isHidden = node => (node.svg ? 'hidden' in node.attributes : node.hidden === true);

function fakeElement(tagName = 'div', { svg = false } = {}) {
  const listeners = {};
  return {
    tagName,
    svg,
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
    removeAttribute(name) {
      delete this.attributes[name];
    },
    toggleAttribute(name, force) {
      const on = force === undefined ? !(name in this.attributes) : Boolean(force);
      if (on) this.attributes[name] = '';
      else delete this.attributes[name];
      if (name === 'hidden' && !this.svg) this.hidden = on; // HTML elements reflect it
      return on;
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
    click() {
      this.clicked = true;
    },
    getBoundingClientRect: () => ({ width: 360, left: 0 })
  };
}

class QuietDOMParser extends DOMParser {
  constructor() {
    super({ onError() {} });
  }
}

function loadPage({ navigator = {}, stored = null, app = api, matchMedia, search = '' } = {}) {
  const elements = new Map();
  const created = [];
  const record = { fetches: [], capacity: [], storage: [], history: [] };
  const store = new Map();
  if (stored !== null) store.set('run-window-settings', stored);
  const sandbox = {
    URL,
    URLSearchParams,
    Blob,
    TextEncoder,
    DOMParser: QuietDOMParser,
    location: { origin: ORIGIN, search },
    navigator,
    document: {
      body: fakeElement('body'),
      getElementById(id) {
        if (!elements.has(id)) {
          const node = fakeElement(SVG_IDS.has(id) ? 'svg' : 'div', { svg: SVG_IDS.has(id) });
          if (HIDDEN_IN_HTML.has(id)) node.toggleAttribute('hidden', true);
          elements.set(id, node);
        }
        return elements.get(id);
      },
      createElement(tagName) {
        const node = fakeElement(tagName);
        created.push(node);
        return node;
      },
      createElementNS: (_ns, tagName) => fakeElement(tagName, { svg: true })
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
    setTimeout: (handler, ms) => setTimeout(handler, ms), // looked up per call, so Jest's fake timers apply
    clearTimeout: id => clearTimeout(id),
    async fetch(url) {
      // /api/capacity is kept apart: it carries nothing about the visitor (its own test checks that).
      if (new URL(url).pathname === '/api/capacity') record.capacity.push(String(url));
      else record.fetches.push(String(url));
      const target = new URL(url);
      const response = await request(app).get(target.pathname + target.search);
      return {
        ok: response.status < 400,
        status: response.status,
        headers: { get: name => response.headers[name.toLowerCase()] || null },
        json: async () => response.body
      };
    }
  };
  if (matchMedia) sandbox.matchMedia = matchMedia;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, name), 'utf8'), sandbox, { filename: name });
  }
  return { sandbox, elements, created, record, store };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

// The location path doesn't hand back refresh()'s promise: wait until the answer is drawn. The wait is bounded in real
// time, not in rounds: a round is one setImmediate, and the fake fetch's HTTP call to Express can take many rounds on a
// busy runner. On a timeout the message carries #status, where the page reports what went wrong.
const ANSWER_TIMEOUT_MS = 5000;
async function answered(elements) {
  const deadline = performance.now() + ANSWER_TIMEOUT_MS;
  while (elements.get('result').hidden !== false && performance.now() < deadline) await flush();
  if (elements.get('result').hidden !== false) {
    const status = elements.get('status').textContent;
    throw new Error(`#result still hidden after ${ANSWER_TIMEOUT_MS} ms; #status: ${JSON.stringify(status)}`);
  }
}

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
    expect(elements.get('source').title).toBe(ROUTE_NAME); // the full name, for when it is cut short
    expect(elements.get('source-map').hidden).toBe(true); // a route has no map link
    expect(elements.get('source-map').getAttribute('href')).toBeNull();
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
  it('saves only the six settings and asks once per settled change that alters the request', async () => {
    const { sandbox, elements, record, store } = loadPage();
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    expect(record.fetches).toHaveLength(1);

    // Pace is not part of the request (the response holds every run length), so it redraws without asking again.
    const pace = elements.get('pace-input');
    pace.value = '6:05';
    pace.listeners.change();
    await flush();
    expect(pace.value).toBe('6:05');
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
    expect(Object.keys(saved).sort()).toEqual(['allowDark', 'durationMin', 'hours', 'paceSec', 'prefer', 'rain']);
    expect(saved).toMatchObject({ paceSec: 365, hours: '10-16,16-17', rain: 55, prefer: 'balanced' });

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
    expect(end.attributes['aria-valuetext']).toBe('16:00'); // a clock time, not the bare number
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

  it('without a route: duration and pace; the answer plans the distance; edits redraw without asking', async () => {
    const stored = JSON.stringify({ paceSec: 385, durationMin: 45 });
    const { elements, record } = loadPage({ navigator: { geolocation }, stored });
    elements.get('use-location').listeners.click();
    await answered(elements);
    expect(rejections).toEqual([]);
    expect(record.fetches).toHaveLength(1);
    expect(elements.get('duration-group').hidden).toBe(false);
    expect(elements.get('pace-group').hidden).toBe(false);
    expect(elements.get('run-distance').hidden).toBe(true);
    expect(elements.get('run-minutes').hidden).toBe(true);
    expect(elements.get('pace-input').value).toBe('6:25');
    const plan = () => {
      const item = elements.get('key-numbers').children.find(node => node.children[0].textContent === 'Plan');
      return item.children[1].children.map(part => part.textContent).join('');
    };
    expect(plan()).toBe('7.0 km'); // 45 min at 6:25

    elements.get('duration-up').listeners.click();
    expect(elements.get('duration-value').textContent).toBe('60 min');
    expect(plan()).toBe('9.4 km');
    const pace = elements.get('pace-input');
    pace.value = '6:50';
    pace.listeners.change();
    expect(plan()).toBe('8.8 km');
    pace.value = 'soon'; // a bad value goes back to the saved one
    pace.listeners.change();
    expect(pace.value).toBe('6:50');
    await flush();
    expect(record.fetches).toHaveLength(1);
  });

  describe('a town by name', () => {
    const UTRECHT = {
      name: 'Utrecht',
      region: 'Utrecht',
      country: 'Netherlands',
      countryCode: 'NL',
      lat: 52.09,
      lon: 5.12
    };
    const OTHER = {
      name: 'Utrecht',
      region: 'KwaZulu-Natal',
      country: 'South Africa',
      countryCode: 'ZA',
      lat: -27.66,
      lon: 30.32
    };
    const withPlaces = found =>
      createApp({ weather, places: { search: jest.fn().mockResolvedValue(found) }, now: () => NOW, rateLimit: 1000 });
    const submit = elements => elements.get('place-form').listeners.submit({ preventDefault() {} });

    it('one match is used at once: named in the source line, its coordinates sent', async () => {
      const { elements, record } = loadPage({ app: withPlaces([UTRECHT]) });
      elements.get('place-input').value = '  Utrecht ';
      await submit(elements);
      await answered(elements);
      expect(rejections).toEqual([]);
      const sent = new URL(record.fetches.at(-1));
      expect(sent.pathname).toBe('/api/window');
      expect([sent.searchParams.get('lat'), sent.searchParams.get('lon')]).toEqual(['52.09', '5.12']);
      expect(new URL(record.fetches[0]).searchParams.get('q')).toBe('Utrecht');
      expect(elements.get('source-map').textContent).toBe('Utrecht');
      expect(elements.get('source-map').title).toBe('Utrecht, Netherlands');
      expect(elements.get('prompt').hidden).toBe(true);
    });

    it('more matches are listed to pick from; none says so', async () => {
      const { elements } = loadPage({ app: withPlaces([UTRECHT, OTHER]) });
      elements.get('place-input').value = 'Utrecht';
      await submit(elements);
      expect(elements.get('place-note').textContent).toBe('Which one?');
      const buttons = elements.get('place-results').children.map(item => item.children[0]);
      expect(buttons.map(button => button.textContent)).toEqual([
        'Utrecht, Netherlands',
        'Utrecht, KwaZulu-Natal, South Africa'
      ]);
      buttons[1].listeners.click();
      await answered(elements);
      expect(elements.get('source-map').title).toBe('Utrecht, KwaZulu-Natal, South Africa');

      const empty = loadPage({ app: withPlaces([]) });
      empty.elements.get('place-input').value = 'Nowhereville';
      await submit(empty.elements);
      expect(empty.elements.get('place-note').textContent).toBe('No town found by that name.');
      expect(empty.record.fetches.filter(url => url.includes('/api/window'))).toEqual([]);
    });

    it('asks for at least 2 letters before sending anything', async () => {
      const { elements, record } = loadPage({ app: withPlaces([UTRECHT]) });
      elements.get('place-input').value = 'U';
      await submit(elements);
      expect(elements.get('place-note').textContent).toBe('Type at least 2 letters.');
      expect(record.fetches).toEqual([]);
    });
  });

  describe('a recheck link from a calendar event', () => {
    const search = '?run=45&pace=5:30&hours=07-09%2C17-21&dark=ok&prefer=wind&rain=30&date=2026-11-03';

    it('sets the run and its day, leaves the address bar, and checks at once when location is allowed', async () => {
      const permissions = { query: async () => ({ state: 'granted' }) };
      const { sandbox, elements, record, store } = loadPage({ navigator: { geolocation, permissions }, search });
      await answered(elements);
      expect(rejections).toEqual([]);
      expect(record.history).toEqual(['/']);
      const sent = new URL(record.fetches[0]).searchParams;
      expect(['avail', 'dark', 'prefer', 'rain'].map(key => sent.get(key))).toEqual([
        '07-09,17-21',
        'ok',
        'wind',
        '30'
      ]);
      const saved = JSON.parse(store.get(sandbox.RunSettings.STORAGE_KEY));
      expect(saved).toMatchObject({ durationMin: 45, paceSec: 330, allowDark: true, prefer: 'wind', rain: 30 });
      expect(elements.get('day-tomorrow').attributes['aria-pressed']).toBe('true');

      // The calendar event links back the same way, and never with the location
      const details = new URL(elements.get('calendar-google').href).searchParams.get('details');
      const link = new URL(details.match(/Check again on the day: (\S+)/)[1]);
      expect(link.origin).toBe(ORIGIN);
      expect(Object.fromEntries(link.searchParams)).toEqual({
        run: '45',
        pace: '5:30',
        hours: '07-09,17-21',
        dark: 'ok',
        prefer: 'wind',
        rain: '30',
        date: '2026-11-03'
      });
      expect(details).not.toMatch(/52\.3|4\.8|4\.9/);
    });

    it('without location allowed, sets the run and asks, with nothing sent', async () => {
      const { elements, record } = loadPage({ navigator: { geolocation }, search });
      for (let i = 0; i < 20; i++) await flush();
      expect(record.fetches).toEqual([]);
      expect(record.history).toEqual(['/']);
      expect(elements.get('status').textContent).toBe(
        'Your run is set. Use your location or a route to check it again.'
      );
      expect(elements.get('duration-value').textContent).toBe('45 min');
    });
  });

  it('shows the route distance and the run minutes in the same Run row with a route', async () => {
    const { sandbox, elements } = loadPage({ stored: JSON.stringify({ paceSec: 390 }) });
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    const summary = sandbox.RouteFile.summarizeRoute(
      sandbox.RouteFile.parseRoute(GPX, FILE_NAME, QuietDOMParser).route
    );
    expect(elements.get('duration-group').hidden).toBe(true);
    expect(elements.get('pace-group').hidden).toBe(false);
    expect(elements.get('run-distance').hidden).toBe(false);
    expect(elements.get('run-distance').textContent).toBe(`${summary.distanceKm.toFixed(1)} km`);
    const minutes = Math.max(1, sandbox.RunPlan.runMinutes(summary.distanceKm, 390));
    expect(elements.get('run-minutes').textContent).toBe(`= ${minutes} min`);
    const pace = elements.get('pace-input');
    pace.value = '7:30';
    pace.listeners.change();
    const slower = Math.max(1, sandbox.RunPlan.runMinutes(summary.distanceKm, 450));
    expect(elements.get('run-minutes').textContent).toBe(`= ${slower} min`);
  });

  it('links "Near you" to the map at the rounded location, and says when the location is rough', async () => {
    const { elements } = loadPage({ navigator: { geolocation } });
    elements.get('use-location').listeners.click();
    await answered(elements);
    expect(rejections).toEqual([]);
    expect(elements.get('source').hidden).toBe(true);
    expect(elements.get('source-map').hidden).toBe(false);
    expect(elements.get('source-map').getAttribute('href')).toBe(
      'https://www.openstreetmap.org/?mlat=52.37&mlon=4.9#map=12/52.37/4.9'
    );
    expect(elements.get('source-rough').hidden).toBe(true); // the fake gives no accuracy

    const guessed = {
      getCurrentPosition: onOk => onOk({ coords: { latitude: 52.3702, longitude: 4.8952, accuracy: 70000 } })
    };
    const rough = loadPage({ navigator: { geolocation: guessed } });
    rough.elements.get('use-location').listeners.click();
    await answered(rough.elements);
    expect(rough.elements.get('source-rough').hidden).toBe(false);
    expect(rough.elements.get('source-rough').textContent).toBe('· rough, ±70 km');
    expect(rough.record.fetches[0]).not.toContain('70000'); // the accuracy stays in the page
    expect(
      rough.record.storage
        .filter(entry => entry.op === 'set')
        .map(entry => entry.value)
        .join()
    ).not.toMatch(/accuracy|70000/);

    rough.elements.get('clear-source').listeners.click();
    expect(rough.elements.get('source-map').hidden).toBe(true);
    expect(rough.elements.get('source-rough').hidden).toBe(true);
  });

  it('says the location is off and asks nothing when location is denied', async () => {
    const denied = { getCurrentPosition: (onOk, onError) => onError({ code: 1 }) };
    const { elements, record } = loadPage({ navigator: { geolocation: denied } });
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
    expect(label('End of hours 2').attributes['aria-valuetext']).toBe('14:00');
    focusLog.length = 0;
    label('Remove hours 2').listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    expect(focusLog.pop()).toBe(label('Start of hours 1'));
  });
  it('raises the start handle when the end handle cannot move right, so both stay reachable', () => {
    const raised = node => node.className.split(' ').includes('z-10');
    const last = loadPage({ stored: JSON.stringify({ hours: '23-24' }) }).created;
    const label = (nodes, name) => nodes.filter(node => node.attributes['aria-label'] === name).pop();
    expect(raised(label(last, 'Start of hours 1'))).toBe(true);
    expect(raised(label(last, 'End of hours 1'))).toBe(false);

    const touching = loadPage({ stored: JSON.stringify({ hours: '10-12,12-14' }) }).created;
    expect(raised(label(touching, 'Start of hours 1'))).toBe(true); // its end meets the next row's start
    expect(raised(label(touching, 'Start of hours 2'))).toBe(false);

    const normal = loadPage().created;
    expect(raised(label(normal, 'Start of hours 1'))).toBe(false);
    const end = label(normal, 'End of hours 1');
    end.value = '24';
    end.listeners.input();
    expect(raised(label(normal, 'Start of hours 1'))).toBe(true);
  });

  it('disables + add hours when no hour is free and enables it again after a move or removal', async () => {
    const full = loadPage({ stored: JSON.stringify({ hours: '00-24' }) });
    const addHours = full.elements.get('add-hours');
    expect(addHours.disabled).toBe(true);
    const end = full.created.filter(node => node.attributes['aria-label'] === 'End of hours 1').pop();
    end.value = '20';
    end.listeners.input();
    expect(addHours.disabled).toBe(false);

    const split = loadPage({ stored: JSON.stringify({ hours: '00-12,12-24' }) });
    expect(split.elements.get('add-hours').disabled).toBe(true);
    split.created
      .filter(node => node.attributes['aria-label'] === 'Remove hours 2')
      .pop()
      .listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    expect(split.elements.get('add-hours').disabled).toBe(false);
    expect(loadPage().elements.get('add-hours').disabled).toBe(false);
  });

  it('puts the round add button at the end of the last hours row and keeps focus on it after adding', async () => {
    const { sandbox, elements } = loadPage();
    const rows = () => elements.get('hours-rows').children;
    const addHours = elements.get('add-hours');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].children.at(-1)).toBe(addHours);
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    focusLog.length = 0;
    addHours.listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    expect(rows()).toHaveLength(2);
    expect(rows()[0].children).not.toContain(addHours);
    const spacer = rows()[0].children.at(-1); // keeps the sliders lined up with the row that has the +
    expect(spacer.tagName).toBe('span');
    expect(spacer.attributes['aria-hidden']).toBe('true');
    expect(spacer.className.split(' ')).toEqual(expect.arrayContaining(['w-6', 'flex-none'])); // the + is w-6 too
    const last = rows()[1].children;
    expect(last.at(-1)).toBe(addHours);
    expect(last.at(-2).attributes['aria-label']).toBe('Remove hours 2'); // after the value and the ✕
    expect(focusLog.pop()).toBe(addHours);
  });

  it('focuses the new row when adding hours fills the last free hour', async () => {
    const { created, elements } = loadPage({ stored: JSON.stringify({ hours: '00-23' }) });
    focusLog.length = 0;
    elements.get('add-hours').listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    expect(elements.get('add-hours').disabled).toBe(true);
    const start = created.filter(node => node.attributes['aria-label'] === 'Start of hours 2').pop();
    expect(focusLog.pop()).toBe(start);
  });

  it('shows the dark times in the Dark row once the weather is in, without the word dark', async () => {
    const { sandbox, elements } = loadPage();
    expect(elements.get('dark-times').hidden).toBe(true);
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    expect(elements.get('dark-times').hidden).toBe(false);
    expect(elements.get('dark-times').textContent).toBe('▨ 17:09–07:38');
  });

  it('turns the compass arrow to where the wind blows, and says it in words', async () => {
    const app = apiWith(() => ({ wind_speed_10m: 16, wind_direction_10m: 90 }));
    const { elements } = loadPage({ navigator: { geolocation }, app });
    elements.get('use-location').listeners.click();
    await answered(elements);
    expect(rejections).toEqual([]);
    expect(elements.get('wind-line').hidden).toBe(false);
    expect(elements.get('wind-text').textContent).toBe('Wind from the east · start east, into it');
    expect(elements.get('answer-time').className.split(' ')).toContain('whitespace-nowrap'); // app.js sets the class
    expect(isHidden(elements.get('wind-compass'))).toBe(false);
    expect(elements.get('wind-arrow').attributes.transform).toBe('rotate(270 14 14)');
    const wind = elements.get('key-numbers').children.find(item => item.children[0].textContent === 'Wind');
    expect(wind.children[1].children.map(part => part.textContent).join('')).toBe('16 km/h E');
    expect(wind.children[1].children[1].className).toContain('text-xs'); // the unit is set smaller
    expect(wind.children[2].textContent).toBe('light'); // a small word under the value
    const item = label => elements.get('key-numbers').children.find(node => node.children[0].textContent === label);
    expect(item('Feels').children[2].textContent).toBe('ideal'); // 10 °C
    expect(item('Sky').children).toHaveLength(2); // no word with Sky or Plan
    expect(item('Plan').children).toHaveLength(2);
    expect(
      item('Plan')
        .children[1].children.map(part => part.textContent)
        .join('')
    ).toBe('10.0 km'); // 60 min at 6:00
  });

  it('names the arrow keys under the timeline only where the screen is not touch-only', async () => {
    const desktop = loadPage({ navigator: { geolocation } });
    desktop.elements.get('use-location').listeners.click();
    await answered(desktop.elements);
    expect(desktop.elements.get('tap-line').textContent).toBe('Tap a slot or use the arrow keys.');
    expect(desktop.elements.get('chart-legend').hidden).toBe(false);

    const phone = loadPage({
      navigator: { geolocation },
      matchMedia: query => ({ matches: query === '(hover: none)' })
    });
    phone.elements.get('use-location').listeners.click();
    await answered(phone.elements);
    expect(rejections).toEqual([]);
    expect(phone.elements.get('tap-line').textContent).toBe('Tap a slot.');
  });

  it('swaps the chart legend for the slot line while a slot is selected', async () => {
    const { elements } = loadPage({ navigator: { geolocation } });
    elements.get('use-location').listeners.click();
    await answered(elements);
    elements.get('timeline').listeners.keydown({ key: 'Home', preventDefault() {} });
    expect(elements.get('chart-legend').hidden).toBe(true);
    expect(elements.get('tap-line').textContent).toMatch(/feels .* °C · wind .* km\/h/);
  });

  it('asks /api/capacity without parameters and draws the bar from it', async () => {
    const { elements, record } = loadPage({ navigator: { geolocation } });
    // Bounded in real time, like answered(): the fake fetch's HTTP call can take many rounds on a busy runner.
    const deadline = performance.now() + ANSWER_TIMEOUT_MS;
    while (isHidden(elements.get('quota-bar')) && performance.now() < deadline) await flush();
    expect(record.capacity).toEqual([`${ORIGIN}/api/capacity`]);
    expect(isHidden(elements.get('quota-bar'))).toBe(false);
    expect(elements.get('quota-fill').attributes.width).toBe('85%');
    expect(elements.get('quota-bar').attributes['aria-label']).toBe("About 85 % of today's new places left");
  });

  it('tints the page by the answer, and by the hour before one', async () => {
    const { elements, sandbox } = loadPage({ navigator: { geolocation } });
    const body = sandbox.document.body;
    expect(['morning', 'evening']).toContain(body.attributes['data-sky']);
    expect(elements.get('sky-a').attributes).toMatchObject({
      'data-sky': body.attributes['data-sky'],
      'data-shown': ''
    });
    elements.get('use-location').listeners.click();
    await answered(elements);
    expect(body.attributes['data-sky']).toBe('mild'); // dry, 10 °C, calm
    // The new tint fades in on the other layer while the old one fades out
    expect(elements.get('sky-b').attributes).toMatchObject({ 'data-sky': 'mild', 'data-shown': '' });
    expect('data-shown' in elements.get('sky-a').attributes).toBe(false);
  });

  it('says so in little wind, without a compass', async () => {
    const { elements } = loadPage({ navigator: { geolocation } });
    elements.get('use-location').listeners.click();
    await answered(elements);
    expect(rejections).toEqual([]);
    expect(elements.get('wind-line').hidden).toBe(false);
    expect(elements.get('wind-text').textContent).toBe('Little wind: any direction will do');
    expect(elements.get('wind-compass').attributes.hidden).toBeDefined();
  });

  it('offers Try tomorrow when today has no window, and switches day without asking again', async () => {
    const app = apiWith(i => (i < 24 ? { precipitation_probability: 90, precipitation: 2 } : {}));
    const { elements, record } = loadPage({ navigator: { geolocation }, app, stored: '{"durationMin":90}' });
    elements.get('use-location').listeners.click();
    await answered(elements);
    expect(rejections).toEqual([]);
    expect(elements.get('answer-time').textContent).toBe('No dry window of 90 min today');
    expect(elements.get('tomorrow-hint').hidden).toBe(false);
    expect(elements.get('tomorrow-text').textContent).toMatch(/^Tomorrow \d\d:\d\d–\d\d:\d\d is dry$/);

    const promised = elements.get('tomorrow-text').textContent.replace(/^Tomorrow (\S+) is dry$/, '$1');
    focusLog.length = 0;
    elements.get('try-tomorrow').listeners.click();
    expect(elements.get('day-tomorrow').attributes['aria-pressed']).toBe('true');
    expect(elements.get('day-today').attributes['aria-pressed']).toBe('false');
    expect(elements.get('tomorrow-hint').hidden).toBe(true);
    expect(elements.get('answer-time').textContent).toBe(promised); // the time the hint promised
    expect(focusLog.pop()).toBe(elements.get('day-tomorrow')); // the button is gone: focus lands on the toggle
    await flush();
    expect(record.fetches).toHaveLength(1);
  });

  it('shows no Try tomorrow when tomorrow has no window either', async () => {
    const app = apiWith(() => ({ precipitation_probability: 90, precipitation: 2 }));
    const { elements } = loadPage({ navigator: { geolocation }, app, stored: '{"durationMin":90}' });
    elements.get('use-location').listeners.click();
    await answered(elements);
    expect(rejections).toEqual([]);
    expect(elements.get('answer-time').textContent).toBe('No dry window of 90 min today');
    expect(elements.get('tomorrow-hint').hidden).toBe(true);
  });

  it('confirms Copy API link on the button itself for 2 s, announced politely, not in the status line', async () => {
    const copied = [];
    const clipboard = { writeText: async text => copied.push(text) };
    const { sandbox, elements } = loadPage({ navigator: { clipboard } });
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    const status = elements.get('status').textContent;
    jest.useFakeTimers();
    try {
      await elements.get('copy-link').listeners.click();
      expect(copied).toHaveLength(1);
      expect(new URL(copied[0]).searchParams.has('slots')).toBe(false);
      expect(elements.get('copy-label').textContent).toBe('Copied');
      expect(isHidden(elements.get('copy-check'))).toBe(false);
      expect(isHidden(elements.get('copy-icon'))).toBe(true);
      expect(elements.get('copy-note').textContent).toBe('Copied');
      expect(elements.get('status').textContent).toBe(status);

      jest.advanceTimersByTime(1500);
      await elements.get('copy-link').listeners.click(); // a second copy restarts the 2 s
      jest.advanceTimersByTime(1500);
      expect(elements.get('copy-label').textContent).toBe('Copied');
      jest.advanceTimersByTime(500);
      expect(elements.get('copy-label').textContent).toBe('Copy API link');
      expect(isHidden(elements.get('copy-check'))).toBe(true);
      expect(isHidden(elements.get('copy-icon'))).toBe(false);
      expect(elements.get('copy-note').textContent).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('builds a first MCP prompt from the settings, and copies it and the link, confirming on the button', async () => {
    const copied = [];
    const clipboard = { writeText: async text => copied.push(text) };
    const stored = JSON.stringify({ durationMin: 45, hours: '07-09', prefer: 'rain' });
    const { elements } = loadPage({ navigator: { clipboard }, stored });
    const prompt = elements.get('mcp-prompt').textContent;
    expect(prompt).toContain('a 45-minute run near [your town]? I can run 07–09. I mind rain most.');
    expect(elements.get('mcp-url').textContent).toBe(`${ORIGIN}/mcp`);

    await elements.get('copy-prompt').listeners.click();
    await elements.get('copy-mcp').listeners.click();
    expect(copied).toEqual([prompt, `${ORIGIN}/mcp`]);
    expect(elements.get('copy-prompt').textContent).toBe('Copied');
    expect(elements.get('mcp-note').textContent).toBe('Copied');
  });

  it('More info under the prompt opens the API dialog, counted as the API dialog', async () => {
    const { elements, sandbox } = loadPage();
    elements.get('open-mcp-info').listeners.click();
    expect(elements.get('api-dialog').open).toBe(true);
    expect((sandbox.plausible.q || []).map(([name, options]) => [name, options.props])).toEqual([
      ['Dialog', { dialog: 'api' }]
    ]);
  });

  it("says Couldn't copy on the button when the clipboard refuses", async () => {
    const clipboard = { writeText: async () => Promise.reject(new Error('denied')) };
    const { sandbox, elements } = loadPage({ navigator: { clipboard } });
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    const status = elements.get('status').textContent;
    jest.useFakeTimers();
    try {
      await elements.get('copy-link').listeners.click();
      expect(elements.get('copy-label').textContent).toBe("Couldn't copy");
      expect(isHidden(elements.get('copy-check'))).toBe(true);
      expect(elements.get('copy-note').textContent).toBe("Couldn't copy");
      expect(elements.get('status').textContent).toBe(status);
      jest.advanceTimersByTime(2000);
      expect(elements.get('copy-label').textContent).toBe('Copy API link');
    } finally {
      jest.useRealTimers();
    }
    expect(rejections).toEqual([]);
  });

  it('Mind most saves a new choice and asks once with it; the same choice again asks nothing', async () => {
    const { elements, record, store, sandbox } = loadPage({ navigator: { geolocation } });
    const pressed = () =>
      ['balanced', 'wind', 'rain', 'temp'].filter(
        v => elements.get(`prefer-${v}`).attributes['aria-pressed'] === 'true'
      );
    elements.get('use-location').listeners.click();
    await flush();
    expect(rejections).toEqual([]);
    expect(pressed()).toEqual(['balanced']);
    expect(elements.get('prefer-hint').textContent).toBe('Wind, rain and temperature count the same.');
    expect(new URL(record.fetches[0]).searchParams.get('prefer')).toBe('balanced');

    elements.get('prefer-wind').listeners.click();
    await flush();
    expect(pressed()).toEqual(['wind']);
    expect(elements.get('prefer-hint').textContent).toMatch(/^Calmer times win/);
    expect(record.fetches).toHaveLength(2);
    expect(new URL(record.fetches[1]).searchParams.get('prefer')).toBe('wind');
    expect(JSON.parse(store.get(sandbox.RunSettings.STORAGE_KEY)).prefer).toBe('wind');

    elements.get('prefer-wind').listeners.click();
    await flush();
    expect(record.fetches).toHaveLength(2);

    const reloaded = loadPage({ stored: store.get(sandbox.RunSettings.STORAGE_KEY) });
    expect(reloaded.elements.get('prefer-wind').attributes['aria-pressed']).toBe('true');
    expect(reloaded.elements.get('prefer-balanced').attributes['aria-pressed']).toBe('false');
  });

  // Plausible never loads here, so its queue (analytics.js's stub of Plausible's snippet) holds every event sent.
  const events = sandbox => (sandbox.plausible.q || []).map(([name, options]) => [name, options.props]);

  it('sends analytics names only, once each, and nothing from the route', async () => {
    const { sandbox, elements } = loadPage();
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await flush();
    const pace = elements.get('pace-input');
    pace.value = '5:55';
    pace.listeners.change();
    pace.value = '6:20';
    pace.listeners.change();
    elements.get('dark-ok').listeners.click();
    elements.get('prefer-wind').listeners.click();
    elements.get('rain-input').value = '55';
    elements.get('rain-input').listeners.change();
    elements.get('day-tomorrow').listeners.click();
    elements.get('open-privacy').listeners.click();
    await flush();

    expect(rejections).toEqual([]);
    expect(events(sandbox)).toEqual([
      ['Source', { source: 'file' }],
      ['Setting', { setting: 'pace' }],
      ['Setting', { setting: 'dark' }],
      ['Setting', { setting: 'prefer' }],
      ['Setting', { setting: 'rain' }],
      ['Setting', { setting: 'day' }],
      ['Dialog', { dialog: 'privacy' }]
    ]);
    expect(leaks(JSON.stringify(sandbox.plausible.q))).toEqual([]);
  });

  it('counts the location as a source without its coordinates', async () => {
    const { sandbox, elements } = loadPage({ navigator: { geolocation } });
    elements.get('use-location').listeners.click();
    await flush(); // counted before the request, so the answer is not needed

    expect(events(sandbox)).toEqual([['Source', { source: 'location' }]]);
    expect(JSON.stringify(sandbox.plausible.q)).not.toMatch(/52\.|4\.89/);
  });

  it('the network icon opens and closes its menu, and counts the opening', () => {
    const { sandbox, elements } = loadPage();
    const button = elements.get('open-network');
    const menu = elements.get('network-menu');
    menu.hidden = true; // as in the markup

    button.listeners.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.listeners.click();
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(events(sandbox)).toEqual([['Dialog', { dialog: 'network' }]]);
  });

  it('Add to calendar opens a menu whose links carry the run, never the route name or coordinates', async () => {
    const { sandbox, elements, record } = loadPage({ app: apiWith(() => ({})) });
    await sandbox.RunApp.openRouteText(GPX, FILE_NAME);
    await answered(elements);
    const button = elements.get('add-calendar');
    const menu = elements.get('calendar-menu');
    menu.hidden = true; // as in the markup
    expect(button.hidden).toBe(false);
    const fetches = record.fetches.length;

    button.listeners.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const google = new URL(elements.get('calendar-google').href);
    const outlook = new URL(elements.get('calendar-outlook').href);
    expect(google.searchParams.get('text')).toMatch(/^\w+ (morning|afternoon|evening) \d+\.\d km run$/);
    expect(outlook.searchParams.get('subject')).toBe(google.searchParams.get('text'));
    for (const href of [google.href, outlook.href]) {
      expect(leaks(decodeURIComponent(href))).toEqual([]);
      expect(decodeURIComponent(href)).not.toMatch(/52\.|4\.89/);
    }

    menu.listeners.click({ target: { closest: () => ({ dataset: { via: 'google' } }) } });
    expect(menu.hidden).toBe(true);
    expect(record.fetches.length).toBe(fetches); // the page itself sends nothing
    expect(events(sandbox)).toEqual(expect.arrayContaining([['Calendar', { via: 'google' }]]));
    expect(events(sandbox)).not.toContainEqual(['Calendar', { via: 'ics' }]);
  });

  it('Calendar file (.ics) downloads a file built in the page', async () => {
    const { sandbox, elements, created, record } = loadPage({
      navigator: { geolocation },
      app: apiWith(() => ({}))
    });
    elements.get('use-location').listeners.click();
    await answered(elements);
    const fetches = record.fetches.length;

    jest.useFakeTimers(); // the page revokes the file's URL after 10 s
    elements.get('add-calendar').listeners.click();
    elements.get('calendar-menu').listeners.click({ target: { closest: () => ({ dataset: { via: 'ics' } }) } });
    const link = created.find(node => node.tagName === 'a' && node.download === 'run.ics');
    expect(link.clicked).toBe(true);
    const text = await resolveObjectURL(link.href).text();
    expect(text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(text).toMatch(/\r\nSUMMARY:\w+ (morning|afternoon|evening) 60 min run\r\n/);
    expect(text).not.toMatch(/52\.|4\.89/);
    expect(record.fetches.length).toBe(fetches);
    expect(events(sandbox)).toContainEqual(['Calendar', { via: 'ics' }]);
    jest.runAllTimers();
    jest.useRealTimers();
    expect(resolveObjectURL(link.href)).toBeUndefined(); // revoked
  });

  it('About opens and closes its menu on a phone, closes when an item is chosen, and counts nothing', () => {
    const { sandbox, elements } = loadPage();
    const button = elements.get('open-about');
    const menu = elements.get('about-menu');
    menu.hidden = true; // as in the markup

    button.listeners.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    menu.listeners.click({ target: { closest: selector => (selector === 'button' ? {} : null) } });
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.listeners.click();
    button.listeners.click();
    expect(menu.hidden).toBe(true);
    expect(events(sandbox)).toEqual([]);
  });

  it('reads the rain slider out as a percentage, while dragging too', () => {
    const { elements } = loadPage();
    const rain = elements.get('rain-input');
    expect(rain.attributes['aria-valuetext']).toBe('40 %');
    rain.value = '65';
    rain.listeners.input();
    expect(rain.attributes['aria-valuetext']).toBe('65 %');
  });
});
