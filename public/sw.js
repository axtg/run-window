// The service worker's only job: catch a route file shared from Android's share sheet (POST /share-target), put it in
// the Cache API for the page to read once, and redirect to the page. Without it that POST would upload the file. It
// never calls fetch and leaves every other request to the browser: no API caching, no offline copy.
(function () {
  const SHARE_PATH = '/share-target';
  const SHARE_FIELD = 'route'; // the manifest's share_target files param name
  const SHARE_CACHE = 'shared-route';
  const SHARE_KEY = '/shared-route';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  // An absolute Location on the share request's own origin.
  function redirect(request, location) {
    return new Response(null, { status: 303, headers: { Location: new URL(location, request.url).href } });
  }

  // Resolves to a redirect whatever happens: a rejection inside respondWith would show the browser's error page.
  async function handleShare(request, caches) {
    try {
      const form = await request.formData();
      const file = form.get(SHARE_FIELD);
      if (!file || typeof file === 'string' || typeof file.size !== 'number') {
        return redirect(request, '/?share=failed');
      }
      if (file.size > MAX_FILE_BYTES) return redirect(request, '/?share=too-large');
      const cache = await caches.open(SHARE_CACHE);
      const headers = { 'X-File-Name': encodeURIComponent(String(file.name || '')) };
      await cache.put(SHARE_KEY, new Response(file, { headers }));
      return redirect(request, '/?share=1');
    } catch {
      return redirect(request, '/?share=failed');
    }
  }

  const api = { SHARE_PATH, SHARE_FIELD, SHARE_CACHE, SHARE_KEY, handleShare };

  if (typeof module !== 'undefined') {
    module.exports = api;
  } else {
    self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => {
      const { request } = event;
      if (request.method !== 'POST') return;
      const url = new URL(request.url);
      if (url.origin !== self.location.origin || url.pathname !== SHARE_PATH) return;
      event.respondWith(handleShare(request, caches));
    });
  }
})();
