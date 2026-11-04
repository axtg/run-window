const RunSettings = require('../../public/settings');

const {
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
} = RunSettings;

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
    expect(DEFAULTS).toEqual({ paceSec: 360, durationMin: 60, allowDark: false, rain: 40, hours: '10-16' });
  });
});

describe('validHours', () => {
  test.each([
    '06-22',
    '06:30-22:00',
    '06-12,18-21',
    '00:00-23:59',
    '06:30-08,17-19:15',
    '06-24',
    '07-09,12-14',
    '12-14,07-09',
    '06:00-22:00'
  ])('accepts %p', text => {
    expect(validHours(text)).toBe(true);
  });

  test.each([
    '',
    '6-22',
    '06-2',
    '06-22-23',
    '06-22;18-21',
    'abc',
    '06 - 22',
    '06-22,',
    '25-30',
    '06:60-22:00',
    '06:5-22',
    '24:00-25:00',
    '24:30-25:00',
    '24-25',
    '22-06',
    '09-09',
    '07-10,09-12',
    '12-14,12-14',
    null,
    undefined,
    22
  ])('rejects %p', value => {
    expect(validHours(value)).toBe(false);
  });
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

test('loadSettings keeps a stored 06-22', () => {
  const storage = fakeStorage(JSON.stringify({ hours: '06-22' }));
  expect(loadSettings(storage).hours).toBe('06-22');
});

describe('hour rows', () => {
  const texts = rows => rows.map(row => `${row.start}-${row.end}`);

  test('splitHours sorts and keeps the text of each bound', () => {
    expect(splitHours('12-14,07:30-09')).toEqual([
      { start: '07:30', end: '09', startMin: 450, endMin: 540 },
      { start: '12', end: '14', startMin: 720, endMin: 840 }
    ]);
  });

  test('splitHours gives [] for invalid text', () => {
    expect(splitHours('nope')).toEqual([]);
    expect(splitHours('10-12,11-13')).toEqual([]);
  });

  test('joinHours round-trips a stored value', () => {
    expect(joinHours(splitHours('07:30-09,12-14'))).toBe('07:30-09,12-14');
  });

  test('hourText pads whole hours and maps 1440 to 24', () => {
    expect(hourText(0)).toBe('00');
    expect(hourText(600)).toBe('10');
    expect(hourText(1440)).toBe('24');
  });

  test('moveHandle stops at a neighbour', () => {
    const rows = splitHours('10-12,14-16');
    expect(joinHours(moveHandle(rows, 0, 'end', 15))).toBe('10-14,14-16');
    expect(joinHours(moveHandle(rows, 1, 'start', 9))).toBe('10-12,12-16');
  });

  test('moveHandle keeps at least one hour', () => {
    const rows = splitHours('10-16');
    expect(joinHours(moveHandle(rows, 0, 'start', 20))).toBe('15-16');
    expect(joinHours(moveHandle(rows, 0, 'end', 3))).toBe('10-11');
  });

  test('moveHandle clamps to 0..24', () => {
    const rows = splitHours('10-16');
    expect(joinHours(moveHandle(rows, 0, 'start', -4))).toBe('00-16');
    expect(joinHours(moveHandle(rows, 0, 'end', 30))).toBe('10-24');
  });

  test('moveHandle snaps a moved 07:30 and leaves other bounds alone', () => {
    const rows = splitHours('07:30-09,12-14');
    expect(joinHours(moveHandle(rows, 0, 'start', 7))).toBe('07-09,12-14');
    expect(joinHours(moveHandle(rows, 0, 'end', 10))).toBe('07:30-10,12-14');
  });

  test('moveHandle never lets a whole hour overlap a half-hour neighbour', () => {
    const rows = splitHours('07:30-09,12-14');
    expect(joinHours(moveHandle(rows, 1, 'start', 5))).toBe('07:30-09,09-14');
  });

  test('moveHandle does not mutate its input', () => {
    const rows = splitHours('10-12,14-16');
    const copy = JSON.parse(JSON.stringify(rows));
    moveHandle(rows, 0, 'end', 11);
    expect(rows).toEqual(copy);
  });

  test('addRow appends a one-hour row after the last row', () => {
    expect(joinHours(addRow(splitHours('10-16')))).toBe('10-16,16-17');
    expect(joinHours(addRow(splitHours('07:30-09')))).toBe('07:30-09,09-10');
  });

  test('addRow falls back to the first free hour from 00', () => {
    expect(joinHours(addRow(splitHours('00-02,20-24')))).toBe('00-02,02-03,20-24');
    expect(joinHours(addRow(splitHours('01-24')))).toBe('00-01,01-24');
  });

  test('addRow leaves a full day unchanged', () => {
    const rows = splitHours('00-24');
    expect(addRow(rows)).toEqual(rows);
  });

  test('removeRow removes a row but keeps the last one', () => {
    const rows = splitHours('10-12,14-16');
    expect(texts(removeRow(rows, 0))).toEqual(['14-16']);
    expect(texts(removeRow(removeRow(rows, 0), 0))).toEqual(['14-16']);
  });
  test('every sequence of moves, adds and removes joins to hours the API accepts', () => {
    // A small deterministic generator, so a failure can be replayed.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (const start of ['10-16', '07:30-09,12-14', '00-02,20-24', '06-22', '05:30-06:30,18-24']) {
      let rows = splitHours(start);
      for (let step = 0; step < 200; step++) {
        const pick = next();
        const index = Math.floor(next() * rows.length);
        if (pick < 0.7) rows = moveHandle(rows, index, next() < 0.5 ? 'start' : 'end', Math.floor(next() * 27) - 1);
        else if (pick < 0.85) rows = addRow(rows);
        else rows = removeRow(rows, index);
        expect(rows.length).toBeGreaterThan(0);
        expect(validHours(joinHours(rows))).toBe(true);
      }
    }
  });
});
