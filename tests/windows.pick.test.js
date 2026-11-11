const { scoreSlot, fallbackScoreSlot, pickWindow, cardinal, DURATIONS } = require('../lib/windows');

const SLOT_MS = 15 * 60 * 1000;
const BASE = Date.parse('2026-11-02T10:00:00.000Z');
const v = o => ({ apparentTemp: 10, windSpeed: 0, windFrom: 0, gust: 0, precipProb: 0, precip: 0, ...o });
const slot = (i, values, extra = {}) => ({
  startMs: BASE + i * SLOT_MS,
  rangeIndex: 0,
  values,
  inDaylight: true,
  ...extra
});
// A slot whose score is exactly `windSpeed - 12` (wind only, no temperature or rain penalty).
const scored = (i, windSpeed, extra) => slot(i, v({ windSpeed }), extra);

test('scoreSlot follows the spec', () => {
  expect(scoreSlot(v({ windSpeed: 18, gust: 31, apparentTemp: 7.5, precipProb: 15 }))).toBeCloseTo(7.25);
  expect(scoreSlot(v({ apparentTemp: 2 }))).toBe(4);
  expect(scoreSlot(v({ apparentTemp: 20 }))).toBe(4);
  expect(scoreSlot(v({ windSpeed: 12, gust: 30, apparentTemp: 6 }))).toBe(0);
});

test('prefer makes its own term count three times and leaves the others alone', () => {
  const values = v({ windSpeed: 18, gust: 31, apparentTemp: 7.5, precipProb: 15 }); // wind 6.5, rain 0.75
  expect(scoreSlot(values, 'balanced')).toBeCloseTo(7.25);
  expect(scoreSlot(values, 'wind')).toBeCloseTo((18 - 8 + 0.5) * 3 + 0.75); // wind counts from 8 km/h
  expect(scoreSlot(values, 'rain')).toBeCloseTo(6.5 + 2.25);
  expect(scoreSlot(values, 'temp')).toBeCloseTo(7.25); // no temperature penalty to multiply
  expect(scoreSlot(v({ apparentTemp: 2 }), 'temp')).toBe(12);
  expect(scoreSlot(v({ apparentTemp: 2 }), 'wind')).toBe(4);
});

test('with prefer=wind, wind counts from 8 km/h: a calm cold hour beats a 12 km/h one at 6 degrees', () => {
  expect(scoreSlot(v({ windSpeed: 8 }), 'wind')).toBe(0);
  expect(scoreSlot(v({ windSpeed: 12 }), 'wind')).toBe(12);
  expect(scoreSlot(v({ windSpeed: 12 }), 'balanced')).toBe(0);
  const midday = v({ windSpeed: 12, apparentTemp: 6 });
  const morning = v({ windSpeed: 3, apparentTemp: 2 });
  expect(scoreSlot(morning, 'wind')).toBeLessThan(scoreSlot(midday, 'wind'));
  expect(scoreSlot(midday, 'balanced')).toBeLessThan(scoreSlot(morning, 'balanced'));
});

test('fallback scoring', () => {
  expect(fallbackScoreSlot(v({ precipProb: 70, precip: 1 }))).toBe(55);
  expect(fallbackScoreSlot(v({ precipProb: 70, precip: 1 }), 'rain')).toBe(165);
  expect(fallbackScoreSlot(v({ windSpeed: 14, precipProb: 70, precip: 1 }), 'wind')).toBe(73); // (14 - 8) × 3 + 55
});

test('DURATIONS lists 15 to 180 minutes', () => {
  expect(DURATIONS).toHaveLength(12);
  expect(DURATIONS[0]).toBe('15');
  expect(DURATIONS[1]).toBe('30');
  expect(DURATIONS[11]).toBe('180');
});

test('picks the lowest mean score, earliest on a tie', () => {
  // Wind speeds 12 + score: scores 5, 1, 1, 5 -> the two middle slots win with mean 1.
  const slots = [scored(0, 17), scored(1, 13), scored(2, 13), scored(3, 17)];
  const w = pickWindow(slots, 2);
  expect(w.start).toBe(new Date(BASE + SLOT_MS).toISOString());
  expect(w.score).toBe(1);

  const tie = [scored(0, 14), scored(1, 14), scored(2, 14), scored(3, 14)];
  expect(pickWindow(tie, 2).start).toBe(new Date(BASE).toISOString());
});

test('float noise does not let a later window beat an earlier tie', () => {
  // 0.1 + 0.2 is 0.30000000000000004: a hair above 0.3 but equal for scoring purposes.
  const slots = [slot(0, v({ windSpeed: 1 })), slot(1, v({ windSpeed: 2 }))];
  const fn = s => (s.windSpeed === 1 ? 0.1 + 0.2 : 0.3);
  expect(pickWindow(slots, 1, { scoreFn: fn }).start).toBe(new Date(BASE).toISOString());
});

test('requires consecutive slots', () => {
  const slots = [scored(0, 12), scored(2, 12)];
  expect(pickWindow(slots, 2)).toBeNull();
  expect(pickWindow(slots, 1)).not.toBeNull();
});

test('does not span two ranges', () => {
  const slots = [scored(0, 12, { rangeIndex: 0 }), scored(1, 12, { rangeIndex: 1 })];
  expect(pickWindow(slots, 2)).toBeNull();
});

test('window ending exactly at the last slot is found', () => {
  const slots = [scored(0, 20), scored(1, 12), scored(2, 12)];
  const w = pickWindow(slots, 2);
  expect(w.start).toBe(new Date(BASE + SLOT_MS).toISOString());
  expect(w.end).toBe(new Date(BASE + 3 * SLOT_MS).toISOString());
});

test('null when nothing fits', () => {
  expect(pickWindow([scored(0, 12), scored(1, 12), scored(2, 12)], 4)).toBeNull();
  expect(pickWindow([], 1)).toBeNull();
});

test('summarises the window', () => {
  const slots = [
    slot(0, v({ precip: 0.4, precipProb: 10, windSpeed: 10, gust: 20, apparentTemp: 7 })),
    slot(1, v({ precip: 0.4, precipProb: 15, windSpeed: 20, gust: 31, apparentTemp: 8 }))
  ];
  const w = pickWindow(slots, 2);
  expect(w).toMatchObject({
    start: new Date(BASE).toISOString(),
    end: new Date(BASE + 2 * SLOT_MS).toISOString(),
    precipSum: 0.2,
    precipProbMax: 15,
    windAvg: 15,
    gustMax: 31,
    apparentTempAvg: 7.5,
    qualifies: true,
    inDaylight: true
  });
  expect(w).not.toHaveProperty('label');
});

test('rounds the summary', () => {
  const slots = [slot(0, v({ windSpeed: 12, apparentTemp: 7.04 })), slot(1, v({ windSpeed: 13, apparentTemp: 7.1 }))];
  const w = pickWindow(slots, 2);
  expect(w.windAvg).toBe(13); // 12.5 rounds up
  expect(w.apparentTempAvg).toBe(7.1);
  expect(w.score).toBe(0.5); // wind penalties 0 and 1, no temperature penalty
});

test('wind around north averages to north', () => {
  const w = pickWindow([slot(0, v({ windFrom: 350 })), slot(1, v({ windFrom: 10 }))], 2);
  expect(w).toMatchObject({ windFrom: 0, windFromCardinal: 'N' });
});

test('wind from the south-west', () => {
  const w = pickWindow([slot(0, v({ windFrom: 220 })), slot(1, v({ windFrom: 230 }))], 2);
  expect(w).toMatchObject({ windFrom: 225, windFromCardinal: 'SW' });
});

test.each([
  [22, 'N'],
  [23, 'NE'],
  [225, 'SW'],
  [337, 'NW'],
  [338, 'N']
])('%i° is %s', (deg, name) => {
  expect(cardinal(deg)).toBe(name);
});

test('inDaylight is false if any slot is dark', () => {
  const slots = [scored(0, 12), scored(1, 12, { inDaylight: false })];
  expect(pickWindow(slots, 2).inDaylight).toBe(false);
  expect(pickWindow(slots, 1).inDaylight).toBe(true);
});

test('qualifies false is passed through for fallbacks', () => {
  const w = pickWindow([scored(0, 12)], 1, { scoreFn: fallbackScoreSlot, qualifies: false });
  expect(w.qualifies).toBe(false);
});

test('a tie in score goes to the lower measure, then the earliest', () => {
  // All four slots score 0 (wind under 12 km/h); the measure is the raw wind speed.
  const slots = [scored(0, 9), scored(1, 9), scored(2, 4), scored(3, 4)];
  const measure = values => values.windSpeed;
  expect(pickWindow(slots, 2).start).toBe(new Date(BASE).toISOString());
  const w = pickWindow(slots, 2, { measure, margin: 10 });
  expect(w.start).toBe(new Date(BASE + 2 * SLOT_MS).toISOString());
  expect(w.score).toBe(0);

  const even = [scored(0, 4), scored(1, 4), scored(2, 4)];
  expect(pickWindow(even, 1, { measure }).start).toBe(new Date(BASE).toISOString());
});

test('Mind most decides first: outside the margin, a lower score loses', () => {
  // The 2026-11-11 morning: 09:00 is calm but the wettest (20 %); the afternoon is dry but windy (25 km/h, 13 points).
  const slots = [
    slot(0, v({ precipProb: 20, apparentTemp: 5 })),
    slot(1, v({ precipProb: 10, windSpeed: 18 })),
    slot(2, v({ precipProb: 0, windSpeed: 25 })),
    slot(3, v({ precipProb: 2, windSpeed: 25 }))
  ];
  const rain = values => values.precipProb;
  expect(pickWindow(slots, 1).start).toBe(new Date(BASE).toISOString()); // by score alone: the wet, calm morning
  const driest = pickWindow(slots, 1, { measure: rain, margin: 5 });
  expect(driest.start).toBe(new Date(BASE + 2 * SLOT_MS).toISOString()); // 0 % and 2 % stay; the earlier wins
  expect(driest.precipProbMax).toBe(0);
});

test('within the margin the score still picks', () => {
  // Slot 0 is the driest (0 %) but windy; slot 1 is 4 % and calm, within the 5-point margin, so it wins on score.
  const slots = [slot(0, v({ precipProb: 0, windSpeed: 30 })), slot(1, v({ precipProb: 4 }))];
  const w = pickWindow(slots, 1, { measure: values => values.precipProb, margin: 5 });
  expect(w.start).toBe(new Date(BASE + SLOT_MS).toISOString());
});

test('PREFER_MEASURES: wind speed, chance of rain, distance from the middle of the temperature band', () => {
  const { PREFER_MEASURES, SCORING } = require('../lib/windows');
  expect(Object.keys(PREFER_MEASURES).sort()).toEqual(['rain', 'temp', 'wind']);
  expect(Object.keys(SCORING.preferMargin).sort()).toEqual(['rain', 'temp', 'wind']);
  expect(PREFER_MEASURES.wind(v({ windSpeed: 7 }))).toBe(7);
  expect(PREFER_MEASURES.rain(v({ precipProb: 25 }))).toBe(25);
  const middle = (SCORING.temperature.min + SCORING.temperature.max) / 2;
  expect(PREFER_MEASURES.temp(v({ apparentTemp: middle }))).toBe(0);
  expect(PREFER_MEASURES.temp(v({ apparentTemp: middle - 3 }))).toBe(3);
});
