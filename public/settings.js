// Remembers the page's chip settings on this device only. Runs in the browser and in the Jest tests.
(function () {
  const STORAGE_KEY = 'run-window-settings';
  const DEFAULTS = Object.freeze({ paceSec: 360, durationMin: 60, allowDark: false, rain: 40, hours: '10-16' });
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

  const MIN_ROW_MIN = 60;
  const DAY_MIN = 1440;

  function hourText(min) {
    return String(Math.round(min / 60)).padStart(2, '0');
  }

  // Valid hours text → rows sorted by start, each keeping the original text of its bounds. [] when invalid.
  function splitHours(text) {
    if (!validHours(text)) return [];
    const rows = text.split(',').map(part => {
      const [start, end] = part.split('-');
      return { start, end, startMin: parseClock(start, false), endMin: parseClock(end, true) };
    });
    return rows.sort((a, b) => a.startMin - b.startMin);
  }

  function joinHours(rows) {
    return rows.map(row => `${row.start}-${row.end}`).join(',');
  }

  function wholeRow(startMin, endMin) {
    return { start: hourText(startMin), end: hourText(endMin), startMin, endMin };
  }

  // Sets one bound to a whole hour, clamped to keep the row at least 1 h and clear of its neighbours.
  function moveHandle(rows, index, which, hour) {
    const row = rows[index];
    if (!row || !Number.isFinite(hour)) return rows.slice();
    const wanted = Math.min(24, Math.max(0, Math.round(hour)));
    const prevEnd = index > 0 ? rows[index - 1].endMin : 0;
    const nextStart = index < rows.length - 1 ? rows[index + 1].startMin : DAY_MIN;
    let startMin = row.startMin;
    let endMin = row.endMin;
    if (which === 'start') {
      const lo = Math.ceil(prevEnd / 60);
      const hi = Math.floor((endMin - MIN_ROW_MIN) / 60);
      if (lo > hi) return rows.slice();
      startMin = Math.min(hi, Math.max(lo, wanted)) * 60;
    } else {
      const lo = Math.ceil((startMin + MIN_ROW_MIN) / 60);
      const hi = Math.floor(nextStart / 60);
      if (lo > hi) return rows.slice();
      endMin = Math.min(hi, Math.max(lo, wanted)) * 60;
    }
    const moved =
      which === 'start' ? { ...row, start: hourText(startMin), startMin } : { ...row, end: hourText(endMin), endMin };
    return rows.map((existing, i) => (i === index ? moved : existing));
  }

  // Appends a 1 h row in the first free whole hour at or after the last row's end, else the first free hour.
  function addRow(rows) {
    const isFree = hour => rows.every(row => row.endMin <= hour * 60 || row.startMin >= (hour + 1) * 60);
    const last = rows.length ? rows[rows.length - 1].endMin : 0;
    const from = Math.ceil(last / 60);
    const candidates = [];
    for (let hour = from; hour < 24; hour++) candidates.push(hour);
    for (let hour = 0; hour < from && hour < 24; hour++) candidates.push(hour);
    const hour = candidates.find(isFree);
    if (hour === undefined) return rows.slice();
    return [...rows, wholeRow(hour * 60, (hour + 1) * 60)].sort((a, b) => a.startMin - b.startMin);
  }

  function removeRow(rows, index) {
    return rows.length <= 1 ? rows.slice() : rows.filter((row, i) => i !== index);
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
    splitHours,
    joinHours,
    hourText,
    moveHandle,
    addRow,
    removeRow,
    loadSettings,
    saveSettings
  };

  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.RunSettings = api;
})();
