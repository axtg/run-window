const RunPlan = require('../../public/plan');

const {
  DRY_MAX_PROBABILITY,
  parsePace,
  formatPace,
  runMinutes,
  durationKey,
  pickResult,
  formatClock,
  goLine,
  windLine,
  routeLine,
  zoneNote,
  apiUrl,
  errorMessage,
  staleNote,
  keyNumbers,
  answerLabel,
  answerTime,
  noWindowText,
  distanceEstimate,
  windArrowDeg
} = RunPlan;

function win(overrides = {}) {
  return {
    start: '2026-11-04T12:15:00.000Z',
    end: '2026-11-04T13:20:00.000Z',
    score: 1,
    qualifies: true,
    precipProbMax: 5,
    precipSum: 0,
    windAvg: 14,
    gustMax: 25,
    windFrom: 90,
    windFromCardinal: 'E',
    apparentTempAvg: 7.4,
    inDaylight: true,
    label: '',
    ...overrides
  };
}

function emptyWindows() {
  const windows = {};
  for (let m = 15; m <= 180; m += 15) windows[String(m)] = null;
  return windows;
}

describe('DRY_MAX_PROBABILITY', () => {
  test('is 20', () => expect(DRY_MAX_PROBABILITY).toBe(20));
});

describe('parsePace and formatPace', () => {
  test('parses m:ss', () => {
    expect(parsePace('6:20')).toBe(380);
    expect(parsePace('3:00')).toBe(180);
    expect(parsePace('15:00')).toBe(900);
  });

  test.each(['abc', '0:00', '6:75', '25:00', '', '2:59', '15:01', '6:5', '6:20:1', null, undefined])(
    'rejects %p',
    text => {
      expect(parsePace(text)).toBeNull();
    }
  );

  test('formats m:ss', () => {
    expect(formatPace(380)).toBe('6:20');
    expect(formatPace(365)).toBe('6:05');
  });
});

describe('runMinutes', () => {
  test('rounds distance times pace to whole minutes', () => {
    expect(runMinutes(10.2, 380)).toBe(65);
    expect(runMinutes(5, 360)).toBe(30);
  });
});

describe('distanceEstimate', () => {
  test('is the distance the duration covers at the pace, to 1 decimal', () => {
    expect(distanceEstimate(60, 390)).toBe('≈ 9.2 km');
    expect(distanceEstimate(60, 360)).toBe('≈ 10.0 km');
    expect(distanceEstimate(15, 900)).toBe('≈ 1.0 km');
    expect(distanceEstimate(300, 180)).toBe('≈ 100.0 km');
  });
});

describe('durationKey', () => {
  test('rounds up to 15 with a minimum of 15', () => {
    expect(durationKey(1)).toEqual({ key: '15', fits: true });
    expect(durationKey(15)).toEqual({ key: '15', fits: true });
    expect(durationKey(65)).toEqual({ key: '75', fits: true });
  });

  test('caps at 180', () => {
    expect(durationKey(180)).toEqual({ key: '180', fits: true });
    expect(durationKey(181)).toEqual({ key: '180', fits: false });
  });
});

describe('pickResult', () => {
  test('returns the window for the key', () => {
    const w = win();
    const windows = { ...emptyWindows(), 75: w };
    const result = pickResult({ windows, fallback: null }, 65);
    expect(result).toEqual({ kind: 'window', window: w, key: '75', fits: true });
  });

  test('uses the fallback only for the 60 minute key', () => {
    const fallback = win({ qualifies: false, precipProbMax: 60 });
    const day = { windows: emptyWindows(), fallback };
    expect(pickResult(day, 60)).toEqual({ kind: 'fallback', window: fallback, key: '60', fits: true });
    expect(pickResult(day, 55).kind).toBe('fallback');
    expect(pickResult(day, 65).kind).toBe('none');
    expect(pickResult(day, 30).kind).toBe('none');
  });

  test('is none without window and fallback', () => {
    const result = pickResult({ windows: emptyWindows(), fallback: null }, 60);
    expect(result).toEqual({ kind: 'none', window: null, key: '60', fits: true });
  });

  test('does not use the fallback when the 60 minute window exists', () => {
    const w = win();
    const day = { windows: { ...emptyWindows(), 60: w }, fallback: win({ qualifies: false }) };
    expect(pickResult(day, 60).kind).toBe('window');
  });

  test('carries fits false for long runs', () => {
    const w = win();
    const day = { windows: { ...emptyWindows(), 180: w }, fallback: null };
    expect(pickResult(day, 240)).toEqual({ kind: 'window', window: w, key: '180', fits: false });
  });
});

describe('formatClock', () => {
  test('formats in the given zone as HH:mm', () => {
    expect(formatClock('2026-11-04T12:15:00.000Z', 'Europe/Amsterdam')).toBe('13:15');
    expect(formatClock('2026-11-04T12:15:00.000Z', 'Asia/Tokyo')).toBe('21:15');
  });

  test('shows midnight as 00', () => {
    expect(formatClock('2026-11-04T23:05:00.000Z', 'Europe/Amsterdam')).toBe('00:05');
  });
});

describe('goLine', () => {
  const ams = 'Europe/Amsterdam';

  test('window that fits ends after the run', () => {
    const result = { kind: 'window', window: win(), key: '75', fits: true };
    expect(goLine(result, { minutes: 65, dayLabel: 'today', timeZone: ams })).toBe('Go 13:15–14:20 · dry · 7 °C');
  });

  test('shows rain chance when not dry', () => {
    const w = win({ precipProbMax: 35 });
    const result = { kind: 'window', window: w, key: '75', fits: true };
    expect(goLine(result, { minutes: 65, dayLabel: 'today', timeZone: ams })).toBe('Go 13:15–14:20 · rain 35 % · 7 °C');
  });

  test('a window that does not qualify is not dry even at a low chance', () => {
    const w = win({ qualifies: false, precipProbMax: 10 });
    const result = { kind: 'window', window: w, key: '75', fits: true };
    expect(goLine(result, { minutes: 65, dayLabel: 'today', timeZone: ams })).toContain('rain 10 %');
  });

  test('turns -0 into 0', () => {
    const w = win({ apparentTempAvg: -0.4 });
    const result = { kind: 'window', window: w, key: '75', fits: true };
    expect(goLine(result, { minutes: 65, dayLabel: 'today', timeZone: ams })).toBe('Go 13:15–14:20 · dry · 0 °C');
  });

  test('keeps a negative temperature', () => {
    const w = win({ apparentTempAvg: -2.6 });
    const result = { kind: 'window', window: w, key: '75', fits: true };
    expect(goLine(result, { minutes: 65, dayLabel: 'today', timeZone: ams })).toBe('Go 13:15–14:20 · dry · -3 °C');
  });

  test('a window that does not fit shows the whole window', () => {
    const w = win({ start: '2026-11-04T08:00:00.000Z', end: '2026-11-04T11:00:00.000Z' });
    const result = { kind: 'window', window: w, key: '180', fits: false };
    expect(goLine(result, { minutes: 200, dayLabel: 'today', timeZone: ams })).toBe(
      'Best 3 h: 09:00–12:00 · dry · 7 °C'
    );
  });

  test('fallback is least bad', () => {
    const w = win({
      qualifies: false,
      precipProbMax: 60,
      start: '2026-11-04T12:00:00.000Z',
      end: '2026-11-04T13:00:00.000Z'
    });
    const result = { kind: 'fallback', window: w, key: '60', fits: true };
    expect(goLine(result, { minutes: 60, dayLabel: 'today', timeZone: ams })).toBe(
      'Least bad: 13:00–14:00 · 60 % rain'
    );
  });

  test('none names the run length and the day', () => {
    const day = { windows: emptyWindows(), fallback: null };
    const result = pickResult(day, 65);
    expect(goLine(result, { minutes: 65, dayLabel: 'today', timeZone: ams })).toBe('No dry window of 65 min today');
    expect(goLine(result, { minutes: 65, dayLabel: 'tomorrow', timeZone: ams })).toBe(
      'No dry window of 65 min tomorrow'
    );
  });

  test('formats in the location zone, not the device zone', () => {
    const result = { kind: 'window', window: win(), key: '75', fits: true };
    expect(goLine(result, { minutes: 65, dayLabel: 'today', timeZone: 'Asia/Tokyo' })).toBe(
      'Go 21:15–22:20 · dry · 7 °C'
    );
  });
});

describe('windLine', () => {
  const east = win({ windFrom: 90, windFromCardinal: 'E', windAvg: 14 });

  test('little wind under 10 km/h', () => {
    const calm = win({ windAvg: 9 });
    expect(windLine({ shape: 'loop', startBearing: 0, overallBearing: 0 }, calm)).toBe('Little wind');
    expect(windLine(null, calm)).toBe('Little wind');
    expect(windLine(null, win({ windAvg: 10 }))).toBe('Start east, into the wind');
  });

  test('no route or out-and-back: start into the wind', () => {
    expect(windLine(null, east)).toBe('Start east, into the wind');
    expect(windLine({ shape: 'out-and-back', startBearing: 270, overallBearing: 270 }, east)).toBe(
      'Start east, into the wind'
    );
  });

  test('names every cardinal in words', () => {
    const names = {
      N: 'north',
      NE: 'north-east',
      E: 'east',
      SE: 'south-east',
      S: 'south',
      SW: 'south-west',
      W: 'west',
      NW: 'north-west'
    };
    for (const [code, name] of Object.entries(names)) {
      expect(windLine(null, win({ windFromCardinal: code }))).toBe(`Start ${name}, into the wind`);
    }
  });

  test('loop: as drawn when the start heads into the wind', () => {
    const s = { shape: 'loop', startBearing: 0, overallBearing: 0 };
    expect(windLine(s, east)).toBe('As drawn: east into the wind first');
    expect(windLine({ ...s, startBearing: 180 }, east)).toBe('As drawn: east into the wind first');
  });

  test('loop: reverse when the start heads away from the wind', () => {
    const s = { shape: 'loop', startBearing: 270, overallBearing: 0 };
    expect(windLine(s, east)).toBe('Reverse it: east into the wind first');
    expect(windLine({ ...s, startBearing: 181 }, east)).toBe('Reverse it: east into the wind first');
  });

  test('loop: bearings across north', () => {
    const north = win({ windFrom: 350, windFromCardinal: 'N' });
    expect(windLine({ shape: 'loop', startBearing: 20, overallBearing: 0 }, north)).toBe(
      'As drawn: north into the wind first'
    );
  });

  test('point-to-point: headwind or tailwind overall', () => {
    expect(windLine({ shape: 'point-to-point', startBearing: 0, overallBearing: 60 }, east)).toBe(
      'Headwind overall, wind from the east'
    );
    expect(windLine({ shape: 'point-to-point', startBearing: 0, overallBearing: 270 }, east)).toBe(
      'Tailwind overall, wind from the east'
    );
  });
});

describe('windArrowDeg', () => {
  test('points to where the wind comes from, in whole degrees', () => {
    expect(windArrowDeg(win({ windFrom: 90 }))).toBe(90);
    expect(windArrowDeg(win({ windFrom: 247.6 }))).toBe(248);
    expect(windArrowDeg(win({ windFrom: 359.7 }))).toBe(0);
  });

  test('has no arrow in little wind', () => {
    expect(windArrowDeg(win({ windAvg: 9.9 }))).toBeNull();
    expect(windArrowDeg(win({ windAvg: 10 }))).toBe(90);
  });
});

describe('routeLine', () => {
  test('distance and climb', () => {
    expect(routeLine({ distanceKm: 10.2345, climbM: 45 })).toBe('10.2 km · +45 m');
  });

  test('distance only without climb data', () => {
    expect(routeLine({ distanceKm: 10.2345, climbM: null })).toBe('10.2 km');
  });

  test('null without a route', () => {
    expect(routeLine(null)).toBeNull();
  });
});

describe('zoneNote', () => {
  const now = Date.UTC(2026, 10, 4, 12, 0, 0);

  test('names the location zone when offsets differ', () => {
    expect(zoneNote('Asia/Tokyo', 'Europe/Amsterdam', now)).toBe('Asia/Tokyo time');
  });

  test('null when offsets match, even for different zones', () => {
    expect(zoneNote('Europe/Brussels', 'Europe/Amsterdam', now)).toBeNull();
  });

  test('compares offsets at the given moment', () => {
    const summer = Date.UTC(2026, 6, 4, 12, 0, 0);
    expect(zoneNote('Europe/London', 'Europe/Amsterdam', summer)).toBe('Europe/London time');
    expect(zoneNote('America/New_York', 'America/Toronto', now)).toBeNull();
  });
});

describe('apiUrl', () => {
  const origin = 'https://run.xadi.eu';
  const params = { lat: 52.3731, lon: 4.8922, hours: '06-22', allowDark: false, rain: 40 };

  test('builds the query with two decimals', () => {
    expect(apiUrl(origin, params)).toBe(
      'https://run.xadi.eu/api/window?lat=52.37&lon=4.89&avail=06-22&dark=avoid&rain=40'
    );
  });

  test('allows the dark', () => {
    expect(apiUrl(origin, { ...params, allowDark: true })).toContain('&dark=ok&');
  });

  test('adds slots=1 on request', () => {
    expect(apiUrl(origin, params, { slots: true })).toMatch(/&rain=40&slots=1$/);
  });
});

describe('errorMessage', () => {
  test('400 shows the API message', () => {
    expect(errorMessage({ status: 400, message: 'lat must be a number.' })).toBe('lat must be a number.');
  });

  test('503 with retryAfter adds the wait in minutes', () => {
    expect(errorMessage({ status: 503, message: 'Weather source is busy.', retryAfter: 90 })).toBe(
      'Weather source is busy. Try again in 2 min.'
    );
    expect(errorMessage({ status: 503, message: 'Busy.', retryAfter: 60 })).toBe('Busy. Try again in 1 min.');
  });

  test('503 without retryAfter is generic', () => {
    expect(errorMessage({ status: 503, message: 'Busy.' })).toBe('Weather unavailable, try again later.');
  });

  test('500 and network failure are generic', () => {
    expect(errorMessage({ status: 500, message: 'boom' })).toBe('Weather unavailable, try again later.');
    expect(errorMessage({ status: 0 })).toBe('Weather unavailable, try again later.');
  });
});

describe('staleNote', () => {
  test('notes stale data', () => {
    expect(staleNote({ warnings: ['stale_data'] })).toBe('Weather from up to 3 hours ago');
  });

  test('null otherwise', () => {
    expect(staleNote({})).toBeNull();
    expect(staleNote({ warnings: [] })).toBeNull();
    expect(staleNote(null)).toBeNull();
  });
});

describe('answer helpers', () => {
  const timeZone = 'Asia/Tokyo';
  const windowResult = { kind: 'window', window: win(), key: '75', fits: true };
  const fallbackResult = { kind: 'fallback', window: win({ precipProbMax: 35 }), key: '60', fits: true };
  const longResult = { kind: 'window', window: win(), key: '180', fits: false };
  const noneResult = { kind: 'none', window: null, key: '75', fits: true };
  const route = { climbM: 45 };

  test('keyNumbers with a route', () => {
    expect(keyNumbers(windowResult, route, 65)).toEqual([
      { label: 'Sky', value: 'Dry' },
      { label: 'Feels', value: '7 °C' },
      { label: 'Wind', value: '14 km/h E' },
      { label: 'Climb', value: '+45 m' }
    ]);
  });

  test('keyNumbers without a route shows the run time', () => {
    expect(keyNumbers(windowResult, null, 60)[3]).toEqual({ label: 'Run', value: '60 min' });
  });

  test('keyNumbers shows a dash when the file has no climb', () => {
    expect(keyNumbers(windowResult, { climbM: null }, 65)[3]).toEqual({ label: 'Climb', value: '–' });
  });

  test('keyNumbers shows rain for a fallback and a likely-rain window, and turns -0 into 0', () => {
    expect(keyNumbers(fallbackResult, route, 60)[0]).toEqual({ label: 'Sky', value: 'Rain 35 %' });
    const wet = { kind: 'window', window: win({ qualifies: false, precipProbMax: 10 }), key: '60', fits: true };
    expect(keyNumbers(wet, route, 60)[0].value).toBe('Rain 10 %');
    const cold = { ...windowResult, window: win({ apparentTempAvg: -0.4 }) };
    expect(keyNumbers(cold, route, 60)[1].value).toBe('0 °C');
  });

  test('keyNumbers is empty for none', () => {
    expect(keyNumbers(noneResult, route, 65)).toEqual([]);
  });

  test('answerLabel per kind', () => {
    expect(answerLabel(windowResult, 65)).toBe('Best time · 65 min');
    expect(answerLabel(fallbackResult, 60)).toBe('Least bad · 60 min');
    expect(answerLabel(longResult, 200)).toBe('Best 3 h · run is longer');
    expect(answerLabel(noneResult, 65)).toBe('');
  });

  test('answerTime per kind in the location timezone', () => {
    expect(answerTime(windowResult, { minutes: 65, timeZone })).toBe('21:15–22:20');
    expect(answerTime(fallbackResult, { minutes: 60, timeZone })).toBe('21:15–22:20');
    expect(answerTime(longResult, { minutes: 200, timeZone })).toBe('21:15–22:20');
    expect(answerTime(noneResult, { minutes: 65, timeZone })).toBe('');
  });

  test('answerTime ends a fitting run at start + minutes', () => {
    expect(answerTime(windowResult, { minutes: 50, timeZone })).toBe('21:15–22:05');
  });

  test('noWindowText reuses the goLine wording', () => {
    expect(noWindowText(65, 'today')).toBe('No dry window of 65 min today');
    expect(noWindowText(65, 'today')).toBe(goLine(noneResult, { minutes: 65, dayLabel: 'today', timeZone }));
  });
});
