const RunSettings = require('../../public/settings');

const { STORAGE_KEY, DEFAULTS, validHours, loadSettings, saveSettings } = RunSettings;

function fakeStorage(initial = null) {
  const data = new Map();
  if (initial !== null) data.set(STORAGE_KEY, initial);
  return {
    data,
    getItem: jest.fn(key => (data.has(key) ? data.get(key) : null)),
    setItem: jest.fn((key, value) => data.set(key, String(value)))
  };
}

function throwingStorage(method) {
  const storage = fakeStorage();
  storage[method] = () => {
    throw new Error('blocked');
  };
  return storage;
}

describe('constants', () => {
  test('storage key and defaults', () => {
    expect(STORAGE_KEY).toBe('run-window-settings');
    expect(DEFAULTS).toEqual({ paceSec: 360, durationMin: 60, allowDark: false, rain: 40, hours: '06-22' });
  });
});

describe('validHours', () => {
  test.each(['06-22', '06:30-22:00', '06-22,18-21', '00:00-23:59', '06:30-08,17-19:15'])('accepts %p', text => {
    expect(validHours(text)).toBe(true);
  });

  test.each(['', '6-22', '06-2', '06-22-23', '06-22;18-21', 'abc', '06 - 22', '06-22,', null, undefined, 22])(
    'rejects %p',
    value => {
      expect(validHours(value)).toBe(false);
    }
  );
});

describe('loadSettings', () => {
  test('returns defaults for null storage', () => {
    expect(loadSettings(null)).toEqual(DEFAULTS);
  });

  test('returns defaults when getItem throws', () => {
    expect(loadSettings(throwingStorage('getItem'))).toEqual(DEFAULTS);
  });

  test('returns defaults when nothing is stored', () => {
    expect(loadSettings(fakeStorage())).toEqual(DEFAULTS);
  });

  test('reads the stored value under STORAGE_KEY', () => {
    const storage = fakeStorage();
    loadSettings(storage);
    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  test.each(['{not json', 'null', '5', '"text"', '[1,2]', 'true'])('returns defaults for junk %p', text => {
    expect(loadSettings(fakeStorage(text))).toEqual(DEFAULTS);
  });

  test('returns defaults when getItem returns a non-string', () => {
    const storage = { getItem: () => 42 };
    expect(loadSettings(storage)).toEqual(DEFAULTS);
  });

  test('loads a fully valid stored object', () => {
    const stored = { paceSec: 300, durationMin: 90, allowDark: true, rain: 10, hours: '05:30-21:00,22-23' };
    expect(loadSettings(fakeStorage(JSON.stringify(stored)))).toEqual(stored);
  });

  test('keeps the valid fields of a partly valid object', () => {
    const stored = { paceSec: 'fast', durationMin: 90, allowDark: 'yes', rain: 150, hours: 'nope' };
    expect(loadSettings(fakeStorage(JSON.stringify(stored)))).toEqual({
      ...DEFAULTS,
      durationMin: 90
    });
  });

  test.each([
    ['paceSec', 179],
    ['paceSec', 901],
    ['paceSec', 360.5],
    ['paceSec', '360'],
    ['durationMin', 14],
    ['durationMin', 301],
    ['durationMin', 60.5],
    ['allowDark', 1],
    ['allowDark', 'true'],
    ['rain', -1],
    ['rain', 101],
    ['rain', 40.5],
    ['rain', null],
    ['hours', '6-22'],
    ['hours', 42]
  ])('falls back to the default for invalid %s = %p', (field, value) => {
    const stored = { ...DEFAULTS, [field]: value };
    expect(loadSettings(fakeStorage(JSON.stringify(stored)))[field]).toBe(DEFAULTS[field]);
  });

  test('accepts the range edges', () => {
    const stored = { paceSec: 180, durationMin: 300, allowDark: false, rain: 0, hours: '00-23' };
    expect(loadSettings(fakeStorage(JSON.stringify(stored)))).toEqual(stored);
    const upper = { paceSec: 900, durationMin: 15, allowDark: true, rain: 100, hours: '06:00-22:00' };
    expect(loadSettings(fakeStorage(JSON.stringify(upper)))).toEqual(upper);
  });

  test('ignores keys it does not know', () => {
    const stored = { ...DEFAULTS, route: 'secret.gpx', lat: 52.37 };
    const loaded = loadSettings(fakeStorage(JSON.stringify(stored)));
    expect(loaded).toEqual(DEFAULTS);
  });
});

describe('saveSettings', () => {
  test('returns false for null storage', () => {
    expect(saveSettings(null, DEFAULTS)).toBe(false);
  });

  test('returns false when setItem throws', () => {
    expect(saveSettings(throwingStorage('setItem'), DEFAULTS)).toBe(false);
  });

  test('returns true and writes under STORAGE_KEY', () => {
    const storage = fakeStorage();
    expect(saveSettings(storage, DEFAULTS)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
  });

  test('writes exactly the five settings keys and nothing else', () => {
    const storage = fakeStorage();
    saveSettings(storage, { ...DEFAULTS, route: 'secret.gpx', lat: 52.37, lon: 4.89 });
    const saved = JSON.parse(storage.data.get(STORAGE_KEY));
    expect(Object.keys(saved).sort()).toEqual(['allowDark', 'durationMin', 'hours', 'paceSec', 'rain']);
    expect(saved).toEqual(DEFAULTS);
  });

  test('round-trips through loadSettings', () => {
    const storage = fakeStorage();
    const settings = { paceSec: 330, durationMin: 45, allowDark: true, rain: 20, hours: '07-09,18-21' };
    expect(saveSettings(storage, settings)).toBe(true);
    expect(loadSettings(storage)).toEqual(settings);
  });

  test('stores invalid fields as their defaults', () => {
    const storage = fakeStorage();
    saveSettings(storage, { paceSec: 5, durationMin: 60, allowDark: 'x', rain: 40, hours: 'bad' });
    expect(JSON.parse(storage.data.get(STORAGE_KEY))).toEqual(DEFAULTS);
  });
});
