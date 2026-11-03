const {
  STRINGS,
  resolveLanguage,
  fill,
  conditionsText,
  formatKm,
  formatDuration,
  formatPace
} = require('../../integrations/trmnl-running-board/src/strings');

const REQUIRED_KEYS = [
  'week',
  'days',
  'formLabel',
  'headingToday',
  'headingTomorrow',
  'tokenInvalid',
  'tredictPayment',
  'tredictUnavailable',
  'tredictDataFrom',
  'weatherUnavailable',
  'checkHours',
  'setLocation',
  'noTrainingData',
  'noSession',
  'noDuration',
  'doesntFit',
  'onlyFits',
  'noDryFallback',
  'noDryWindow',
  'windStart',
  'darkAfter',
  'weatherStale',
  'dataAt',
  'minutes'
];

const flatten = value => (Array.isArray(value) ? value : [value]);

describe('STRINGS', () => {
  it('has identical keys in en and nl', () => {
    expect(Object.keys(STRINGS.nl).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it('covers the spec strings and has no empty value', () => {
    for (const lang of ['en', 'nl']) {
      for (const key of REQUIRED_KEYS) {
        expect(STRINGS[lang]).toHaveProperty(key);
      }
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        for (const item of flatten(value)) {
          expect(`${lang}.${key}:${typeof item === 'string' && item.trim() !== ''}`).toBe(`${lang}.${key}:true`);
        }
      }
    }
  });

  it('has the day abbreviations Monday first and the WEEK label', () => {
    expect(STRINGS.en.days).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    expect(STRINGS.nl.days).toEqual(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']);
    expect(STRINGS.en.week).toBe('WEEK');
    expect(STRINGS.nl.week).toBe('WEEK');
  });

  it('has the agreed headings and form label', () => {
    expect(STRINGS.en.headingToday).toBe('BEST TIME TODAY');
    expect(STRINGS.nl.headingToday).toBe('BESTE TIJD VANDAAG');
    expect(STRINGS.en.headingTomorrow).toBe('TOMORROW');
    expect(STRINGS.nl.headingTomorrow).toBe('MORGEN');
    expect(STRINGS.en.formLabel).toBe('Form (est.)');
    expect(STRINGS.nl.formLabel).toBe('Vorm (schatting)');
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = text => (text.match(/\{\w+\}/g) || []).sort();
    for (const key of Object.keys(STRINGS.en)) {
      if (typeof STRINGS.en[key] === 'string') {
        expect(`${key}:${placeholders(STRINGS.nl[key])}`).toBe(`${key}:${placeholders(STRINGS.en[key])}`);
      }
    }
  });
});

describe('resolveLanguage', () => {
  it('follows the same rules as eu-dayahead', () => {
    expect(resolveLanguage('device', 'nl-NL')).toBe('nl');
    expect(resolveLanguage('device', 'fr')).toBe('en');
    expect(resolveLanguage('EN', 'nl')).toBe('en');
    expect(resolveLanguage(' NL ', 'en-US')).toBe('nl');
    expect(resolveLanguage(null, null)).toBe('en');
    expect(resolveLanguage('', 'nl')).toBe('nl');
    expect(resolveLanguage('xx', 'nl')).toBe('en');
    expect(resolveLanguage(undefined, undefined)).toBe('en');
  });
});

describe('fill', () => {
  it('replaces placeholders and leaves unknown ones empty', () => {
    expect(fill('Only {n} min fits', { n: 45 })).toBe('Only 45 min fits');
    expect(fill('{a}-{b}', { a: 'x' })).toBe('x-');
  });
});

describe('conditionsText', () => {
  const base = { qualifies: true, precipProbMax: 20, windAvg: 18, windFromCardinal: 'SW', apparentTempAvg: 7.6 };

  it('mirrors the API wording', () => {
    expect(conditionsText(base, 'en')).toEqual({ sky: 'dry', wind: '18 km/h SW', temp: '8°C' });
    expect(conditionsText(base, 'nl')).toEqual({ sky: 'droog', wind: '18 km/u ZW', temp: '8°C' });
  });

  it('says rain above 20% or when not qualifying', () => {
    expect(conditionsText({ ...base, precipProbMax: 30 }, 'en').sky).toBe('rain 30%');
    expect(conditionsText({ ...base, precipProbMax: 30 }, 'nl').sky).toBe('regen 30%');
    expect(conditionsText({ ...base, qualifies: false, precipProbMax: 10 }, 'en').sky).toBe('rain 10%');
    expect(conditionsText({ ...base, qualifies: false, precipProbMax: 10 }, 'nl').sky).toBe('regen 10%');
  });

  it('translates only the nl cardinals that differ', () => {
    const nl = cardinal => conditionsText({ ...base, windFromCardinal: cardinal }, 'nl').wind;
    expect([nl('NE'), nl('E'), nl('SE'), nl('S'), nl('SW'), nl('W'), nl('NW'), nl('N')]).toEqual([
      '18 km/u NO',
      '18 km/u O',
      '18 km/u ZO',
      '18 km/u Z',
      '18 km/u ZW',
      '18 km/u W',
      '18 km/u NW',
      '18 km/u N'
    ]);
    expect(conditionsText({ ...base, windFromCardinal: 'SE' }, 'en').wind).toBe('18 km/h SE');
  });

  it('never prints -0', () => {
    expect(conditionsText({ ...base, apparentTempAvg: -0.4 }, 'en').temp).toBe('0°C');
    expect(conditionsText({ ...base, apparentTempAvg: -2.6 }, 'en').temp).toBe('-3°C');
  });
});

describe('number formats', () => {
  it('formats kilometres with the language decimal separator', () => {
    expect(formatKm(8150, 'nl')).toBe('8,2');
    expect(formatKm(8150, 'en')).toBe('8.2');
    expect(formatKm(0, 'nl')).toBe('0,0');
    expect(formatKm(NaN, 'en')).toBe('0.0');
  });

  it('formats durations as h:mm', () => {
    expect(formatDuration(6120)).toBe('1:42');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(3599)).toBe('1:00');
    expect(formatDuration(undefined)).toBe('0:00');
  });

  it('formats pace as m:ss', () => {
    expect(formatPace(341)).toBe('5:41');
    expect(formatPace(299.6)).toBe('5:00');
    expect(formatPace(null)).toBe('0:00');
  });
});
