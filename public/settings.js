// Remembers the page's chip settings on this device only. Runs in the browser and in the Jest tests.
(function () {
  const STORAGE_KEY = 'run-window-settings';
  const DEFAULTS = Object.freeze({ paceSec: 360, durationMin: 60, allowDark: false, rain: 40, hours: '06-22' });
  const HOURS_PART = /^\d{2}(:\d{2})?-\d{2}(:\d{2})?$/;

  function validHours(text) {
    return typeof text === 'string' && text.split(',').every(part => HOURS_PART.test(part));
  }

  function isInteger(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  const VALIDATORS = {
    paceSec: value => isInteger(value, 180, 900),
    durationMin: value => isInteger(value, 15, 300),
    allowDark: value => typeof value === 'boolean',
    rain: value => isInteger(value, 0, 100),
    hours: validHours
  };

  // Keeps each valid field and replaces each invalid one with its default.
  function sanitize(source) {
    const settings = {};
    for (const key of Object.keys(DEFAULTS)) {
      const value = source && typeof source === 'object' ? source[key] : undefined;
      settings[key] = VALIDATORS[key](value) ? value : DEFAULTS[key];
    }
    return settings;
  }

  function loadSettings(storage) {
    try {
      if (!storage) return sanitize(null);
      const text = storage.getItem(STORAGE_KEY);
      return sanitize(typeof text === 'string' ? JSON.parse(text) : null);
    } catch {
      return sanitize(null);
    }
  }

  function saveSettings(storage, settings) {
    try {
      if (!storage) return false;
      storage.setItem(STORAGE_KEY, JSON.stringify(sanitize(settings)));
      return true;
    } catch {
      return false;
    }
  }

  const api = {
    STORAGE_KEY,
    DEFAULTS,
    validHours,
    loadSettings,
    saveSettings
  };

  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.RunSettings = api;
})();
