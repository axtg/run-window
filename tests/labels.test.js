const { formatLabel } = require('../lib/labels');

const w = {
  start: '2026-11-02T11:15:00.000Z',
  end: '2026-11-02T12:30:00.000Z',
  qualifies: true,
  precipProbMax: 15,
  windAvg: 18,
  windFromCardinal: 'SW',
  apparentTempAvg: 7.5
};
const ams = { timezone: 'Europe/Amsterdam' };

describe('formatLabel', () => {
  test('en', () => {
    expect(formatLabel(w, { ...ams, lang: 'en' })).toBe('12:15–13:30 · dry · 18 km/h SW · 8°C');
  });

  test('nl', () => {
    expect(formatLabel(w, { ...ams, lang: 'nl' })).toBe('12:15–13:30 · droog · 18 km/u ZW · 8°C');
  });

  test('fallback shows the rain chance', () => {
    expect(formatLabel({ ...w, qualifies: false, precipProbMax: 70 }, { ...ams, lang: 'en' })).toBe(
      '12:15–13:30 · rain 70% · 18 km/h SW · 8°C'
    );
  });

  test('nl fallback says regen', () => {
    expect(formatLabel({ ...w, qualifies: false, precipProbMax: 70 }, { ...ams, lang: 'nl' })).toBe(
      '12:15–13:30 · regen 70% · 18 km/u ZW · 8°C'
    );
  });

  describe('dry only for a qualifying window at up to a 20% rain chance', () => {
    test.each([
      ['en', true, 20, 'dry'],
      ['nl', true, 20, 'droog'],
      ['en', false, 20, 'rain 20%'],
      ['en', false, 10, 'rain 10%'],
      ['nl', false, 10, 'regen 10%'],
      ['en', true, 21, 'rain 21%'],
      ['en', false, 21, 'rain 21%'],
      ['nl', true, 21, 'regen 21%'],
      ['en', true, 95, 'rain 95%'],
      ['nl', true, 40, 'regen 40%']
    ])('%s, qualifies %s, %i%%', (lang, qualifies, precipProbMax, sky) => {
      expect(formatLabel({ ...w, qualifies, precipProbMax }, { ...ams, lang })).toContain(` · ${sky} · `);
    });
  });

  test('nl cardinals', () => {
    const map = { NE: 'NO', E: 'O', SE: 'ZO', S: 'Z', SW: 'ZW', W: 'W', NW: 'NW', N: 'N' };
    Object.entries(map).forEach(([en, nl]) => {
      expect(formatLabel({ ...w, windFromCardinal: en }, { ...ams, lang: 'nl' })).toContain(` km/u ${nl} · `);
      expect(formatLabel({ ...w, windFromCardinal: en }, { ...ams, lang: 'en' })).toContain(` km/h ${en} · `);
    });
  });

  test('-0.4° shows as 0°C, not -0°C', () => {
    const label = formatLabel({ ...w, apparentTempAvg: -0.4 }, { ...ams, lang: 'en' });
    expect(label).toMatch(/ · 0°C$/);
  });

  test('negative temperatures keep their sign', () => {
    expect(formatLabel({ ...w, apparentTempAvg: -3.2 }, { ...ams, lang: 'en' })).toMatch(/ · -3°C$/);
  });

  test('uses the given timezone, not the host one', () => {
    expect(formatLabel(w, { timezone: 'Asia/Kolkata', lang: 'en' })).toMatch(/^16:45–18:00 · /);
  });
});
