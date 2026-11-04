// Remembers the page's chip settings on this device only. Runs in the browser and in the Jest tests.
(function () {
  const STORAGE_KEY = 'run-window-settings';
  const DEFAULTS = Object.freeze({ paceSec: 360, durationMin: 60, allowDark: false, rain: 40, hours: '06-22' });
  const CLOCK = /^(\d{2})(?::(\d{2}))?$/;

  // Mirrors lib/params.js: 'HH' or 'HH:MM' → minutes since midnight. 24:00 is only valid as an end.
  function parseClock(text, isEnd) {
    const match = CLOCK.exec(text);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = match[2] === undefined ? 0 : Number(match[2]);
    if (minutes > 59) return null;
    if (hours > 24 || (hours === 24 && (!isEnd || minutes !== 0))) return null;
    return hours * 60 + minutes;
  }

  // Mirrors lib/params.js parseAvail: each part is start-end with end after start; parts may come in any order
  // but must not overlap once sorted (touching is fine).
  function validHours(text) {
    if (typeof text !== 'string') return false;
    const ranges = [];
    for (const part of text.split(',')) {
      const bounds = part.split('-');
      if (bounds.length !== 2) return false;
      const startMin = parseClock(bounds[0], false);
      const endMin = parseClock(bounds[1], true);
      if (startMin === null || endMin === null || endMin <= startMin) return false;
      ranges.push({ startMin, endMin });
    }
    ranges.sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].startMin < ranges[i - 1].endMin) return false;
    }
    return true;
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
