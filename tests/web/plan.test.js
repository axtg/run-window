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
  apiUrl,
  errorMessage,
  staleNote,
  keyNumbers,
  mapUrl,
  roughNote,
  valueParts,
  answerLabel,
  answerTime,
  noWindowText,
  noWindowCause,
  windArrowDeg,
  tomorrowHint,
  windWord,
  feelsWord,
  calendarEvent,
  googleCalendarUrl,
  outlookCalendarUrl,
  icsText
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
    expect(windLine(null, win({ windAvg: 10 }))).toBe('Wind from the east · start east, into it');
  });

  test('no route or out-and-back: start into the wind', () => {
    expect(windLine(null, east)).toBe('Wind from the east · start east, into it');
    expect(windLine({ shape: 'out-and-back', startBearing: 270, overallBearing: 270 }, east)).toBe(
      'Wind from the east · start east, into it'
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
      expect(windLine(null, win({ windFromCardinal: code }))).toBe(`Wind from the ${name} · start ${name}, into it`);
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
  test('points to where the wind blows to, in whole degrees', () => {
    expect(windArrowDeg(win({ windFrom: 90 }))).toBe(270);
    expect(windArrowDeg(win({ windFrom: 247.6 }))).toBe(68);
    expect(windArrowDeg(win({ windFrom: 359.7 }))).toBe(180);
    expect(windArrowDeg(win({ windFrom: 0 }))).toBe(180);
  });

  test('has no arrow in little wind', () => {
    expect(windArrowDeg(win({ windAvg: 9.9 }))).toBeNull();
    expect(windArrowDeg(win({ windAvg: 10 }))).toBe(270);
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

describe('apiUrl', () => {
  const origin = 'https://besttimetorun.com';
  const params = { lat: 52.3731, lon: 4.8922, hours: '06-22', allowDark: false, prefer: 'balanced', rain: 40 };

  test('builds the query with two decimals', () => {
    expect(apiUrl(origin, params)).toBe(
      'https://besttimetorun.com/api/window?lat=52.37&lon=4.89&avail=06-22&dark=avoid&rain=40&prefer=balanced'
    );
  });

  test('sends what to mind most', () => {
    expect(apiUrl(origin, { ...params, prefer: 'wind' })).toMatch(/&prefer=wind$/);
  });

  test('allows the dark', () => {
    expect(apiUrl(origin, { ...params, allowDark: true })).toContain('&dark=ok&');
  });

  test('adds slots=1 on request', () => {
    expect(apiUrl(origin, params, { slots: true })).toMatch(/&rain=40&prefer=balanced&slots=1$/);
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
      { label: 'Feels', value: '7 °C', note: 'ideal' },
      { label: 'Wind', value: '14 km/h E', note: 'light' },
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
    expect(keyNumbers(cold, route, 60)[1]).toEqual({ label: 'Feels', value: '0 °C', note: 'freezing' });
  });

  test('valueParts marks the units so they can be set smaller', () => {
    expect(valueParts('16 km/h E')).toEqual([
      { text: '16', unit: false },
      { text: ' km/h', unit: true },
      { text: ' E', unit: false }
    ]);
    expect(valueParts('6 °C')).toEqual([
      { text: '6', unit: false },
      { text: ' °C', unit: true }
    ]);
    expect(valueParts('45 min')).toEqual([
      { text: '45', unit: false },
      { text: ' min', unit: true }
    ]);
    expect(valueParts('+45 m')).toEqual([
      { text: '+45', unit: false },
      { text: ' m', unit: true }
    ]);
    expect(valueParts('Rain 35 %')).toEqual([
      { text: 'Rain 35', unit: false },
      { text: ' %', unit: true }
    ]);
    expect(valueParts('Dry')).toEqual([{ text: 'Dry', unit: false }]);
    expect(valueParts('–')).toEqual([{ text: '–', unit: false }]);
  });

  test('mapUrl pins the rounded location on OpenStreetMap', () => {
    expect(mapUrl(52.37, 4.89)).toBe('https://www.openstreetmap.org/?mlat=52.37&mlon=4.89#map=12/52.37/4.89');
  });

  test('roughNote speaks up only past 5 km of accuracy', () => {
    expect(roughNote(undefined)).toBe('');
    expect(roughNote(null)).toBe('');
    expect(roughNote(30)).toBe('');
    expect(roughNote(5000)).toBe('');
    expect(roughNote(5400)).toBe('· rough, ±5 km');
    expect(roughNote(70000)).toBe('· rough, ±70 km');
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

  describe('why nothing fits', () => {
    const at = (hour, minute) => new Date(Date.UTC(2026, 10, 2, hour, minute)).toISOString();
    const slot = (hour, minute, status) => ({ start: at(hour, minute), status });
    const run = (statuses, hour = 10) =>
      statuses.map((status, i) => slot(hour + Math.floor(i / 4), (i % 4) * 15, status));

    test('all hours past: the hours have gone by, whatever the rain', () => {
      const cause = noWindowCause(run(['past', 'past', 'past', 'past']), 60);
      expect(cause).toMatchObject({ cause: 'past', minutesLeft: 0 });
      expect(noWindowText(60, 'today', cause)).toBe('Your hours today have passed');
    });

    test('too little left: names how much, still ahead', () => {
      const cause = noWindowCause(run(['past', 'past', 'ok', 'ok']), 60);
      expect(cause).toMatchObject({ cause: 'time', minutesLeft: 30, past: true, dark: false });
      expect(noWindowText(60, 'today', cause)).toBe('Only 30 min left in your hours today');
    });

    test('too little daylight, or none', () => {
      const short = noWindowCause(run(['ok', 'rain', 'dark', 'dark']), 60);
      expect(noWindowText(60, 'tomorrow', short)).toBe('Only 30 min of daylight in your hours tomorrow');
      const none = noWindowCause(run(['dark', 'dark']), 60);
      expect(noWindowText(60, 'tomorrow', none)).toBe('No daylight in your hours tomorrow');
      const both = noWindowCause(run(['past', 'ok', 'dark', 'dark']), 60);
      expect(noWindowText(60, 'today', both)).toBe('Only 15 min left in daylight in your hours today');
    });

    test('a gap between hour ranges breaks a stretch', () => {
      const slots = [...run(['ok', 'ok'], 10), ...run(['ok', 'ok'], 14)];
      expect(noWindowCause(slots, 60)).toMatchObject({ cause: 'time', minutesLeft: 30 });
    });

    test('enough time: rain is the cause, with the dry-window line', () => {
      const cause = noWindowCause(run(['rain', 'rain', 'rain', 'rain', 'ok']), 60);
      expect(cause.cause).toBe('rain');
      expect(noWindowText(60, 'today', cause)).toBe('No dry window of 60 min today');
    });
  });

  test('noWindowText reuses the goLine wording', () => {
    expect(noWindowText(65, 'today')).toBe('No dry window of 65 min today');
    expect(noWindowText(65, 'today')).toBe(goLine(noneResult, { minutes: 65, dayLabel: 'today', timeZone }));
  });
});

describe('tomorrowHint', () => {
  const timeZone = 'Asia/Tokyo';

  test('says tomorrow is dry for a dry window, with the run time', () => {
    const result = { kind: 'window', window: win(), key: '60', fits: true };
    expect(tomorrowHint(result, { minutes: 60, timeZone })).toBe('Tomorrow 21:15–22:15 is dry');
  });

  test('gives the rain chance when the window is not dry by the dry rule', () => {
    const wet = { kind: 'window', window: win({ precipProbMax: 45 }), key: '60', fits: true };
    expect(tomorrowHint(wet, { minutes: 60, timeZone })).toBe('Tomorrow 21:15–22:15, rain 45 %');
    const unqualified = { kind: 'window', window: win({ qualifies: false, precipProbMax: 10 }), key: '60', fits: true };
    expect(tomorrowHint(unqualified, { minutes: 60, timeZone })).toBe('Tomorrow 21:15–22:15, rain 10 %');
  });

  test('shows the whole window when the run is longer than 3 h', () => {
    const long = { kind: 'window', window: win(), key: '180', fits: false };
    expect(tomorrowHint(long, { minutes: 200, timeZone })).toBe('Tomorrow 21:15–22:20 is dry');
  });

  test('names a fallback as least bad', () => {
    const fallback = { kind: 'fallback', window: win({ precipProbMax: 70 }), key: '60', fits: true };
    expect(tomorrowHint(fallback, { minutes: 60, timeZone })).toBe('Tomorrow: least bad 21:15–22:20');
  });

  test('is null when tomorrow has no window either', () => {
    expect(tomorrowHint({ kind: 'none', window: null, key: '60', fits: true }, { minutes: 60, timeZone })).toBeNull();
  });
});

describe('windWord and feelsWord', () => {
  test.each([
    [0, 'calm'],
    [5, 'calm'],
    [5.4, 'calm'],
    [5.6, 'light'],
    [6, 'light'],
    [19, 'light'],
    [20, 'moderate'],
    [28, 'moderate'],
    [29, 'fresh'],
    [38, 'fresh'],
    [39, 'strong'],
    [49, 'strong'],
    [50, 'very strong'],
    [80, 'very strong']
  ])('wind %p km/h is %p', (kmh, word) => expect(windWord(kmh)).toBe(word));

  test.each([
    [-12, 'freezing'],
    [-0, 'freezing'],
    [0, 'freezing'],
    [0.4, 'freezing'],
    [0.6, 'cold'],
    [1, 'cold'],
    [5, 'cold'],
    [6, 'ideal'],
    [16, 'ideal'],
    [17, 'warm'],
    [22, 'warm'],
    [23, 'hot'],
    [27, 'hot'],
    [28, 'very hot'],
    [35, 'very hot']
  ])('feels %p °C is %p', (celsius, word) => expect(feelsWord(celsius)).toBe(word));

  test('the key numbers use the rounded values they show', () => {
    const result = { kind: 'window', window: win({ windAvg: 19.6, apparentTempAvg: 16.5 }), key: '60', fits: true };
    const [, feels, wind] = keyNumbers(result, null, 60);
    expect(feels).toEqual({ label: 'Feels', value: '17 °C', note: 'warm' });
    expect(wind).toEqual({ label: 'Wind', value: '20 km/h E', note: 'moderate' });
  });
});

describe('preferHint', () => {
  const { preferHint } = require('../../public/plan');

  test('says what each choice trades, and falls back to balanced', () => {
    expect(preferHint('balanced')).toBe('Wind, rain and temperature count the same.');
    expect(preferHint('wind')).toMatch(/^Calmer times win/);
    expect(preferHint('rain')).toMatch(/^Drier times win/);
    expect(preferHint('temp')).toMatch(/6–16 °C/);
    expect(preferHint('nope')).toBe(preferHint('balanced'));
  });
});

describe('add to calendar', () => {
  const AMS = 'Europe/Amsterdam';
  // Sunday 8 Nov 2026, 15:00 in Amsterdam (UTC+1).
  const sunday = win({
    start: '2026-11-08T14:00:00.000Z',
    end: '2026-11-08T15:30:00.000Z',
    precipProbMax: 41,
    qualifies: true,
    windAvg: 11.2,
    windFrom: 180,
    windFromCardinal: 'S',
    apparentTempAvg: 4.6
  });
  const result = { kind: 'window', window: sunday, key: '60', fits: true };
  const loop = {
    shape: 'loop',
    startBearing: 180,
    overallBearing: 0,
    distanceKm: 10.43,
    climbM: 40,
    name: 'Secret loop'
  };

  test('names the day, part of day and run length in the location time zone', () => {
    const event = calendarEvent(result, null, { minutes: 60, timeZone: AMS });
    expect(event.title).toBe('Sunday afternoon 60 min run');
    expect(event.startMs).toBe(Date.parse('2026-11-08T14:00:00Z'));
    expect(event.endMs).toBe(Date.parse('2026-11-08T15:00:00Z'));
    expect(event.description).toBe(
      'Rain 41 % · Feels 5 °C, cold · Wind 11 km/h S, light\n' +
        'Wind from the south · start south, into it\n' +
        'Forecast from besttimetorun.com'
    );
    const linked = calendarEvent(result, null, { minutes: 60, timeZone: AMS, checkUrl: 'https://x.test/?run=60' });
    expect(linked.description.split('\n').at(-1)).toBe('Check again on the day: https://x.test/?run=60');
    expect(calendarEvent(result, null, { minutes: 60, timeZone: 'Asia/Tokyo' }).title).toBe(
      'Sunday evening 60 min run'
    );
    const early = { ...result, window: { ...sunday, start: '2026-11-09T06:30:00.000Z' } };
    expect(calendarEvent(early, null, { minutes: 60, timeZone: AMS }).title).toBe('Monday morning 60 min run');
  });

  test('with a route: its distance, never its name', () => {
    const event = calendarEvent(result, loop, { minutes: 62, timeZone: AMS });
    expect(event.title).toBe('Sunday afternoon 10.4 km run');
    expect(JSON.stringify(event)).not.toMatch(/Secret/);
  });

  test('a run longer than the window, or a fallback, spans the window shown', () => {
    const long = calendarEvent({ ...result, fits: false }, null, { minutes: 200, timeZone: AMS });
    expect(long.endMs).toBe(Date.parse('2026-11-08T15:30:00Z'));
    const least = calendarEvent({ ...result, kind: 'fallback' }, null, { minutes: 60, timeZone: AMS });
    expect(least.endMs).toBe(Date.parse('2026-11-08T15:30:00Z'));
    expect(calendarEvent({ kind: 'none', window: null }, null, { minutes: 60, timeZone: AMS })).toBeNull();
  });

  test('the Google Calendar and Outlook.com links carry a filled-in event, in UTC', () => {
    const event = calendarEvent(result, null, { minutes: 60, timeZone: AMS });
    const google = new URL(googleCalendarUrl(event));
    expect(google.origin + google.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(Object.fromEntries(google.searchParams)).toEqual({
      action: 'TEMPLATE',
      text: 'Sunday afternoon 60 min run',
      dates: '20261108T140000Z/20261108T150000Z',
      details: event.description
    });
    expect(googleCalendarUrl(event)).toContain('text=Sunday%20afternoon%2060%20min%20run&');
    expect(googleCalendarUrl(event)).not.toContain('+');
    const outlook = new URL(outlookCalendarUrl(event));
    expect(outlook.origin + outlook.pathname).toBe('https://outlook.live.com/calendar/0/deeplink/compose');
    expect(Object.fromEntries(outlook.searchParams)).toEqual({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: 'Sunday afternoon 60 min run',
      startdt: '2026-11-08T14:00:00.000Z',
      enddt: '2026-11-08T15:00:00.000Z',
      body: event.description
    });
  });

  test('the .ics file: UTC times, escaped text, CRLF and folded lines', () => {
    const text = icsText(calendarEvent(result, null, { minutes: 60, timeZone: AMS }), { uid: 'abc', nowMs: 0 });
    const lines = text.split('\r\n');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(lines).toContain('DTSTART:20261108T140000Z');
    expect(lines).toContain('DTEND:20261108T150000Z');
    expect(lines).toContain('DTSTAMP:19700101T000000Z');
    expect(lines).toContain('UID:abc@besttimetorun.com');
    expect(lines).toContain('SUMMARY:Sunday afternoon 60 min run');
    lines.forEach(line => expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75));
    const unfolded = text.replace(/\r\n /g, '');
    expect(unfolded).toContain('DESCRIPTION:Rain 41 % · Feels 5 °C\\, cold · Wind 11 km/h S\\, light\\nWind from');
  });
});

describe('skyTheme', () => {
  const { skyTheme } = RunPlan;
  const day = { sunrise: '2026-11-04T06:42:00.000Z', sunset: '2026-11-04T16:05:00.000Z' };
  const shown = (overrides, kind = 'window') => ({ kind, window: win(overrides) });

  it('follows the time of day before there is a window', () => {
    expect(skyTheme(null, null, 8)).toBe('morning');
    expect(skyTheme({ kind: 'none', window: null }, day, 11)).toBe('morning');
    expect(skyTheme(null, null, 12)).toBe('evening');
    expect(skyTheme(null, null, 23)).toBe('evening');
  });

  it('picks wet, then dark, windy, cold, warm, else mild', () => {
    expect(skyTheme(shown({}), day, 9)).toBe('mild'); // 7 °C, 14 km/h, dry, in daylight
    expect(skyTheme(shown({ qualifies: false, precipProbMax: 60 }, 'fallback'), day, 9)).toBe('wet');
    expect(skyTheme(shown({ precipProbMax: 35 }), day, 9)).toBe('wet');
    expect(skyTheme(shown({ start: '2026-11-04T15:30:00.000Z', end: '2026-11-04T16:30:00.000Z' }), day, 9)).toBe(
      'dark'
    );
    expect(skyTheme(shown({ windAvg: 29 }), day, 9)).toBe('windy');
    expect(skyTheme(shown({ windAvg: 28 }), day, 9)).toBe('mild');
    expect(skyTheme(shown({ apparentTempAvg: 5 }), day, 9)).toBe('cold');
    expect(skyTheme(shown({ apparentTempAvg: -3 }), day, 9)).toBe('cold');
    expect(skyTheme(shown({ apparentTempAvg: 17 }), day, 9)).toBe('warm');
    expect(skyTheme(shown({ apparentTempAvg: 16 }), day, 9)).toBe('mild');
  });

  it('has a body variant in index.html for every theme it can return', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '../../public/index.html'), 'utf8');
    for (const theme of RunPlan.SKY_THEMES) expect(html).toContain(`data-[sky=${theme}]:bg-[linear-gradient(`);
  });
});

describe('quotaBar', () => {
  const { quotaBar } = RunPlan;
  const capacity = (remainingShare, full = false) => ({ perDay: 300, remainingShare, full, asOf: 'a', resetsAt: 'b' });

  it('is a full, bright rainbow with all places left', () => {
    expect(quotaBar(capacity(1))).toEqual({
      width: '100%',
      amber: false,
      opacity: '1.00',
      saturate: '1.00',
      label: "About 100 % of today's new places left"
    });
  });

  it('shortens and fades as places are used, and turns amber under 10 %', () => {
    expect(quotaBar(capacity(0.5))).toMatchObject({ width: '50%', amber: false, opacity: '0.68', saturate: '0.57' });
    expect(quotaBar(capacity(0.05))).toMatchObject({ width: '5%', amber: true, opacity: '1', saturate: '1' });
  });

  it('is empty when full, and null for a missing or malformed answer', () => {
    expect(quotaBar(capacity(0.2, true))).toMatchObject({ width: '0%', label: 'No new places left today' });
    expect(quotaBar(null)).toBeNull();
    expect(quotaBar({ remainingShare: '0.5', full: false })).toBeNull();
    expect(quotaBar({ remainingShare: 0.5 })).toBeNull();
  });
});

describe('firstPrompt', () => {
  const { firstPrompt } = RunPlan;
  const base = { minutes: 45, hours: '10-16', prefer: 'balanced', allowDark: false, rain: 40 };

  it('asks for the run with a town placeholder, never a location', () => {
    expect(firstPrompt(base)).toBe(
      'Using Best time to run, when is the best time today for a 45-minute run near [your town]? I can run 10–16.'
    );
  });

  it('adds only the settings that differ from the defaults', () => {
    expect(firstPrompt({ ...base, hours: '07-09,17:30-21', prefer: 'wind', allowDark: true, rain: 20 })).toBe(
      'Using Best time to run, when is the best time today for a 45-minute run near [your town]? ' +
        'I can run 07–09 or 17:30–21. I mind the wind most. Running in the dark is fine. ' +
        'Keep the chance of rain at or under 20 %.'
    );
    expect(firstPrompt({ ...base, prefer: 'temp' })).toContain('I mind the temperature most.');
  });
});

test('outlookNote: only the day after, one line on the page, what to do in the MCP text', () => {
  const { outlookNote } = RunPlan;
  expect(outlookNote(1)).toBeNull();
  expect(outlookNote(2, { short: true })).toBe('💡 The forecast can still shift.');
  expect(outlookNote(2)).toBe('The forecast can still shift: check again on the day.');
});
