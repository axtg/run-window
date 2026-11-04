const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { SHARE_PATH, SHARE_FIELD, SHARE_CACHE, SHARE_KEY, handleShare } = require('../../public/sw');

const SW_FILE = path.join(__dirname, '..', '..', 'public', 'sw.js');
const ORIGIN = 'https://run.xadi.eu';
const GPX = '<?xml version="1.0"?><gpx><trk><name>Loop</name><trkseg></trkseg></trk></gpx>';

// A Cache API stand-in: named caches holding Responses by key.
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    open: jest.fn(async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return { put: jest.fn(async (key, response) => store.set(String(key), response)) };
    })
  };
}

// The redirect is an absolute URL on the share request's own origin; this returns its path and query.
const target = response => {
  const url = new URL(response.headers.get('Location'));
  expect(url.origin).toBe(ORIGIN);
  return url.pathname + url.search;
};

function sharePost(file) {
  const form = new FormData();
  if (file) form.append('route', file);
  return new Request(`${ORIGIN}${SHARE_PATH}`, { method: 'POST', body: form });
}

describe('service worker share hand-off', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('uses the fixed path, cache and key', () => {
    expect(SHARE_PATH).toBe('/share-target');
    expect(SHARE_FIELD).toBe('route');
    expect(SHARE_CACHE).toBe('shared-route');
    expect(SHARE_KEY).toBe('/shared-route');
  });

  test('a shared GPX file goes into the cache and the page is opened with ?share=1, without the network', async () => {
    const caches = fakeCaches();
    const response = await handleShare(sharePost(new File([GPX], 'Morning loop.gpx')), caches);

    expect(response.status).toBe(303);
    expect(target(response)).toBe('/?share=1');
    expect(caches.open).toHaveBeenCalledWith(SHARE_CACHE);
    const stored = caches.stores.get(SHARE_CACHE).get(SHARE_KEY);
    expect(await stored.text()).toBe(GPX);
    expect(decodeURIComponent(stored.headers.get('X-File-Name'))).toBe('Morning loop.gpx');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('no file answers ?share=failed and caches nothing', async () => {
    const caches = fakeCaches();
    const response = await handleShare(sharePost(null), caches);

    expect(response.status).toBe(303);
    expect(target(response)).toBe('/?share=failed');
    expect(caches.stores.size).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a 6 MB file answers ?share=too-large and caches nothing', async () => {
    const caches = fakeCaches();
    const file = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.gpx');
    const response = await handleShare(sharePost(file), caches);

    expect(response.status).toBe(303);
    expect(target(response)).toBe('/?share=too-large');
    expect(caches.stores.size).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a text field instead of a file answers ?share=failed', async () => {
    const form = new FormData();
    form.append('route', 'not a file');
    const caches = fakeCaches();
    const response = await handleShare(new Request(`${ORIGIN}${SHARE_PATH}`, { method: 'POST', body: form }), caches);

    expect(target(response)).toBe('/?share=failed');
    expect(caches.stores.size).toBe(0);
  });

  test('a body that is not form data answers ?share=failed instead of rejecting', async () => {
    const caches = fakeCaches();
    const request = new Request(`${ORIGIN}${SHARE_PATH}`, { method: 'POST', body: 'plain text' });
    const response = await handleShare(request, caches);

    expect(target(response)).toBe('/?share=failed');
    expect(caches.stores.size).toBe(0);
  });

  test('a cache that fails answers ?share=failed instead of rejecting', async () => {
    const caches = { open: jest.fn().mockRejectedValue(new Error('quota')) };
    const response = await handleShare(sharePost(new File([GPX], 'loop.gpx')), caches);

    expect(target(response)).toBe('/?share=failed');
  });
});

describe('service worker in a worker scope', () => {
  // Loads sw.js as the browser would: no `module`, a `self` that records its listeners.
  function loadWorker() {
    const listeners = {};
    const caches = fakeCaches();
    const self = {
      location: { origin: ORIGIN },
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
      skipWaiting: jest.fn().mockResolvedValue(undefined),
      clients: { claim: jest.fn().mockResolvedValue(undefined) }
    };
    const fetch = jest.fn();
    const context = { self, caches, fetch, Request, Response, FormData, File, URL, encodeURIComponent };
    vm.runInNewContext(fs.readFileSync(SW_FILE, 'utf8'), context, { filename: SW_FILE });
    return { listeners, self, caches, fetch };
  }

  const fetchEvent = request => ({ request, respondWith: jest.fn(), waitUntil: jest.fn() });

  test('install skips waiting and activate claims the open pages', () => {
    const { listeners, self } = loadWorker();
    const install = { waitUntil: jest.fn() };
    const activate = { waitUntil: jest.fn() };
    listeners.install(install);
    listeners.activate(activate);

    expect(self.skipWaiting).toHaveBeenCalled();
    expect(self.clients.claim).toHaveBeenCalled();
    expect(install.waitUntil).toHaveBeenCalled();
    expect(activate.waitUntil).toHaveBeenCalled();
  });

  test.each([
    ['GET /', new Request(`${ORIGIN}/`)],
    ['GET /api/window', new Request(`${ORIGIN}/api/window?lat=52.37&lon=4.89&slots=1`)],
    ['GET /share-target', new Request(`${ORIGIN}${SHARE_PATH}`)],
    ['POST elsewhere', new Request(`${ORIGIN}/other`, { method: 'POST', body: 'x' })],
    ['POST to another origin', new Request(`https://example.test${SHARE_PATH}`, { method: 'POST', body: 'x' })]
  ])('%s passes through untouched', (_, request) => {
    const { listeners, fetch } = loadWorker();
    const event = fetchEvent(request);
    listeners.fetch(event);

    expect(event.respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a share POST is answered by the worker, without the network', async () => {
    const { listeners, caches, fetch } = loadWorker();
    const event = fetchEvent(sharePost(new File([GPX], 'loop.gpx')));
    listeners.fetch(event);

    expect(event.respondWith).toHaveBeenCalledTimes(1);
    const response = await event.respondWith.mock.calls[0][0];
    expect(response.status).toBe(303);
    expect(target(response)).toBe('/?share=1');
    expect(await caches.stores.get(SHARE_CACHE).get(SHARE_KEY).text()).toBe(GPX);
    expect(fetch).not.toHaveBeenCalled();
  });
});
