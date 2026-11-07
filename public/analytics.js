// Plausible: counts page views and, by name only, which settings, dialogs, starting points, calendar adds and network
// links people use. Never a value, a coordinate or anything from a route. Runs in the browser and in the Jest tests.
//
// Loaded deferred, before app.js. Plausible's own script (async, from plausible.io) picks up the queue whenever it
// arrives; when it never does (an ad blocker), events wait in memory and the page works the same.
(function () {
  // The only events and names that can be sent. Anything else is dropped, so app.js cannot send a value by mistake.
  const EVENTS = Object.freeze({
    Setting: { prop: 'setting', names: ['duration', 'pace', 'hours', 'add-hours', 'dark', 'prefer', 'rain', 'day'] },
    Dialog: { prop: 'dialog', names: ['method', 'api', 'privacy', 'network'] },
    Source: { prop: 'source', names: ['file', 'share', 'location'] },
    Calendar: { prop: 'via', names: ['google', 'outlook', 'ics'] },
    Network: {
      prop: 'site',
      names: ['xadi.nl', 'dap.xadi.eu', 'emailconnect.eu', 'webhooktest.eu', 'stackcheck.eu', 'buymeacoffee.com']
    }
  });

  // Each event and name is sent once per page view: a hint at what gets used, not a count of every step or drag.
  function createTracker(send) {
    const sent = new Set();
    return function track(event, name) {
      const spec = Object.hasOwn(EVENTS, event) ? EVENTS[event] : null; // not an inherited key like `constructor`
      if (!spec || !spec.names.includes(name)) return false;
      const key = `${event}:${name}`;
      if (sent.has(key)) return false;
      sent.add(key);
      try {
        send(event, { props: { [spec.prop]: name } });
      } catch {
        // analytics must never break the page
      }
      return true;
    };
  }

  // Plausible's snippet, moved here from an inline <script>: the CSP allows none. Its init sends the page view.
  function installPlausible(root) {
    const plausible =
      root.plausible ||
      function () {
        (plausible.q = plausible.q || []).push(arguments);
      };
    plausible.init =
      plausible.init ||
      function (options) {
        plausible.o = options || {};
      };
    root.plausible = plausible;
    plausible.init();
    return (event, options) => root.plausible(event, options);
  }

  const api = { EVENTS, createTracker, installPlausible };

  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.Analytics = { track: createTracker(installPlausible(globalThis)) };
})();
