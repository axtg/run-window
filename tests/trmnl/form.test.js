const { FORM_CONSTANTS, formSeries, formChart } = require('../../integrations/trmnl-running-board/src/form');

const effortsWeek = require('../fixtures/tredict/efforts-week.json').trainingEfforts;

// YYYYMMDD keys for `count` days starting at `start` (YYYY-MM-DD)
function dayKeys(start, count) {
  const first = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(first + index * 86400000).toISOString().slice(0, 10).replace(/-/g, '')
  );
}

const pointOn = (series, date) => series.points.find(point => point.date === date);
const PATH = /^[ML0-9. -]*$/;

function coordinates(path) {
  const numbers = path.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number);
  const pairs = [];
  for (let index = 0; index < numbers.length; index += 2) pairs.push([numbers[index], numbers[index + 1]]);
  return pairs;
}

describe('FORM_CONSTANTS', () => {
  it("uses Tredict's model: 14 and 9 days, weights 1.66 and 2", () => {
    expect(FORM_CONSTANTS).toEqual({ fitnessDays: 14, fatigueDays: 9, fitnessWeight: 1.66, fatigueWeight: 2 });
  });
});

describe('formSeries', () => {
  it('settles at L · (1.66 / (1 − e^(−1/14)) − 2 / (1 − e^(−1/9))) for a constant load over 200 days', () => {
    const keys = dayKeys('2026-04-18', 200);
    const efforts = Object.fromEntries(keys.map(key => [key, [[50]]]));
    const series = formSeries({ efforts, today: '2026-11-03', back: 42, ahead: 7 });
    const last = pointOn(series, '2026-11-03');
    expect(keys[keys.length - 1]).toBe('20261103');
    const settled = 50 * (1.66 / (1 - Math.exp(-1 / 14)) - 2 / (1 - Math.exp(-1 / 9)));
    expect(last.form).toBeCloseTo(settled, 2);
    expect(series.today).toBe(last.form);
  });

  it('gives 1.66 · 100 − 2 · 100 on a day of 100 after zeros, then decays both sums', () => {
    const efforts = { 20261001: [[0]], 20261002: [[0]], 20261003: [[100]] };
    const series = formSeries({ efforts, today: '2026-10-10', back: 42, ahead: 7 });
    expect(pointOn(series, '2026-10-03').form).toBeCloseTo(-34, 6);
    expect(pointOn(series, '2026-10-02').form).toBe(0);
    expect(pointOn(series, '2026-10-04').form).toBeCloseTo(166 * Math.exp(-1 / 14) - 200 * Math.exp(-1 / 9), 6);
  });

  it('returns the window from today − back to today + ahead, one point per day', () => {
    const series = formSeries({ efforts: effortsWeek, today: '2026-11-04', back: 42, ahead: 7 });
    expect(series.points).toHaveLength(50);
    expect(series.points[0].date).toBe('2026-09-23');
    expect(series.points[49].date).toBe('2026-11-11');
    expect(series.points.map(point => point.planned)).toEqual(series.points.map(point => point.date > '2026-11-04'));
    expect(series.points.every(point => Number.isFinite(point.form))).toBe(true);
  });

  it('walks every calendar day from the earliest key with load 0 on days without entries', () => {
    const gap = formSeries({ efforts: { 20261001: [[100]], 20261010: [[0]] }, today: '2026-10-10', back: 9, ahead: 0 });
    const walked = formSeries({
      efforts: Object.fromEntries(dayKeys('2026-10-01', 10).map((key, index) => [key, [[index === 0 ? 100 : 0]]])),
      today: '2026-10-10',
      back: 9,
      ahead: 0
    });
    expect(gap.points.map(point => point.form)).toEqual(walked.points.map(point => point.form));
  });

  it('fills days before the first entry with form 0', () => {
    const series = formSeries({ efforts: { 20261101: [[100]] }, today: '2026-11-03', back: 42, ahead: 7 });
    expect(series.points).toHaveLength(50);
    expect(pointOn(series, '2026-10-31').form).toBe(0);
    expect(pointOn(series, '2026-11-01').form).toBeCloseTo(-34, 6);
  });

  it('ignores a past unconfirmed effort', () => {
    const base = { 20261001: [[0]], 20261002: [[100]] };
    const withUnconfirmed = { 20261001: [[0]], 20261002: [[100], [80, { unconfirmed: true }]] };
    const a = formSeries({ efforts: base, today: '2026-10-05', back: 4, ahead: 0 });
    const b = formSeries({ efforts: withUnconfirmed, today: '2026-10-05', back: 4, ahead: 0 });
    expect(b.points).toEqual(a.points);
  });

  it("counts today's confirmed 60 plus unconfirmed 80 as 140", () => {
    const mixed = formSeries({
      efforts: { 20261001: [[0]], 20261002: [[60], [80, { unconfirmed: true }]] },
      today: '2026-10-02',
      back: 1,
      ahead: 0
    });
    const flat = formSeries({
      efforts: { 20261001: [[0]], 20261002: [[140]] },
      today: '2026-10-02',
      back: 1,
      ahead: 0
    });
    expect(mixed.today).toBeCloseTo(-0.34 * 140, 6);
    expect(mixed.today).toBe(flat.today);
  });

  it('counts future unconfirmed efforts and marks future points planned', () => {
    const series = formSeries({
      efforts: { 20261001: [[0]], 20261002: [[0]], 20261003: [[100, { unconfirmed: true }]] },
      today: '2026-10-02',
      back: 1,
      ahead: 1
    });
    expect(series.points.map(point => [point.date, point.planned])).toEqual([
      ['2026-10-01', false],
      ['2026-10-02', false],
      ['2026-10-03', true]
    ]);
    expect(series.points[2].form).toBeCloseTo(-34, 6);
  });

  it('reads the fixture today as 61 + 38', () => {
    const series = formSeries({ efforts: effortsWeek, today: '2026-11-04', back: 1, ahead: 0 });
    const without = formSeries({
      efforts: { ...effortsWeek, 20261104: [[99]] },
      today: '2026-11-04',
      back: 1,
      ahead: 0
    });
    expect(series.today).toBe(without.today);
  });

  it('uses constants passed in, else FORM_CONSTANTS', () => {
    const efforts = { 20261001: [[0]], 20261002: [[100]] };
    const custom = formSeries({
      efforts,
      today: '2026-10-02',
      back: 1,
      ahead: 0,
      constants: { fitnessDays: 10, fatigueDays: 5, fitnessWeight: 1, fatigueWeight: 1 }
    });
    expect(custom.today).toBeCloseTo(0, 6);
    const weighted = formSeries({
      efforts,
      today: '2026-10-02',
      back: 1,
      ahead: 0,
      constants: { fitnessDays: 10, fatigueDays: 5, fitnessWeight: 2, fatigueWeight: 1 }
    });
    expect(weighted.today).toBeCloseTo(100, 6);
  });

  it('returns no points and today null for {} (Review Focus 4)', () => {
    expect(formSeries({ efforts: {}, today: '2026-11-04', back: 42, ahead: 7 })).toEqual({ points: [], today: null });
    expect(formSeries({ efforts: undefined, today: '2026-11-04' })).toEqual({ points: [], today: null });
    expect(formSeries({ efforts: { nonsense: [[5]] }, today: '2026-11-04' })).toEqual({ points: [], today: null });
  });

  it('defaults to 42 back and 7 ahead and skips garbage entries', () => {
    const series = formSeries({ efforts: { 20261001: [['x'], null, 5, [NaN], [20]] }, today: '2026-11-04' });
    expect(series.points).toHaveLength(50);
    expect(series.points.every(point => Number.isFinite(point.form))).toBe(true);
  });
});

describe('formChart', () => {
  it('draws nothing and says so for an empty series (Review Focus 4)', () => {
    const chart = formChart({ points: [], today: null }, 'en');
    expect(chart.pastPath).toBe('');
    expect(chart.futurePath).toBe('');
    expect(chart.empty).toBe('No training data yet');
    expect(chart.today).toBe('');
    expect(chart.heading).toBe('Form');
    expect(Number.isFinite(chart.zeroY)).toBe(true);
    expect(Number.isFinite(chart.todayX)).toBe(true);
    expect(formChart({ points: [], today: null }, 'nl').empty).toBe('Nog geen trainingsgegevens');
  });

  it('draws a normal series inside the 360x150 box', () => {
    const series = formSeries({ efforts: effortsWeek, today: '2026-11-04', back: 42, ahead: 7 });
    const chart = formChart(series, 'en');
    for (const path of [chart.pastPath, chart.futurePath]) {
      expect(path.startsWith('M')).toBe(true);
      expect(path).not.toMatch(/NaN/);
      expect(path).toMatch(PATH);
      expect(path).toMatch(/^M\d+(\.\d)? \d+(\.\d)?( L\d+(\.\d)? \d+(\.\d)?)+$/);
      for (const [x, y] of coordinates(path)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(360);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(150);
      }
    }
    expect(chart.empty).toBe('');
    expect(chart.heading).toBe('Form');
    expect(formChart(series, 'nl').heading).toBe('Vorm');
  });

  it('splits at today: the past path ends where the future path starts, at todayX', () => {
    const series = formSeries({ efforts: effortsWeek, today: '2026-11-04', back: 42, ahead: 7 });
    const chart = formChart(series, 'en');
    const past = coordinates(chart.pastPath);
    const future = coordinates(chart.futurePath);
    expect(past).toHaveLength(43);
    expect(future).toHaveLength(8);
    expect(past[0][0]).toBe(0);
    expect(future[future.length - 1][0]).toBe(360);
    expect(past[past.length - 1]).toEqual(future[0]);
    expect(chart.todayX).toBe(future[0][0]);
  });

  it('keeps 0 inside the y-scale even when every value is positive or zero', () => {
    const points = [
      { date: '2026-11-01', form: 5, planned: false },
      { date: '2026-11-02', form: 10, planned: false },
      { date: '2026-11-03', form: 20, planned: true }
    ];
    const chart = formChart({ points, today: 10 }, 'en');
    expect(chart.zeroY).toBeGreaterThanOrEqual(0);
    expect(chart.zeroY).toBeLessThanOrEqual(150);
    const ys = coordinates(chart.pastPath + ' ' + chart.futurePath).map(([, y]) => y);
    expect(Math.max(...ys)).toBeLessThan(chart.zeroY);

    const flat = formChart({ points: points.map(point => ({ ...point, form: 0 })), today: 0 }, 'en');
    expect(flat.pastPath).not.toMatch(/NaN/);
    expect(Number.isFinite(flat.zeroY)).toBe(true);
  });

  it('prints today as a rounded integer, minus sign only when negative', () => {
    const points = [{ date: '2026-11-04', form: 0, planned: false }];
    expect(formChart({ points, today: 4.4 }, 'en').today).toBe('4');
    expect(formChart({ points, today: 4.6 }, 'en').today).toBe('5');
    expect(formChart({ points, today: -33.6 }, 'en').today).toBe('−34');
    expect(formChart({ points, today: -3.2 }, 'en').today).toBe('−3');
    expect(formChart({ points, today: 0.3 }, 'en').today).toBe('0');
    expect(formChart({ points, today: -0.4 }, 'en').today).toBe('0');
  });

  it('prints the axis labels in the language', () => {
    const series = formSeries({ efforts: effortsWeek, today: '2026-11-04', back: 42, ahead: 7 });
    expect(formChart(series, 'en').labels).toEqual({ back: '6 weeks back', today: 'today', ahead: '7 days ahead' });
    expect(formChart(series, 'nl').labels).toEqual({
      back: '6 weken terug',
      today: 'vandaag',
      ahead: '7 dagen vooruit'
    });
  });

  it('draws a single point without NaN', () => {
    const chart = formChart({ points: [{ date: '2026-11-04', form: 3, planned: false }], today: 3 }, 'en');
    expect(chart.pastPath).toMatch(/^M\d/);
    expect(chart.pastPath).not.toMatch(/NaN/);
    expect(chart.futurePath).toBe('');
  });
});
