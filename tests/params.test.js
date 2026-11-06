const { parseWindowQuery } = require('../lib/params');

const ok = { lat: '52.37', lon: '4.89' };

function catchError(query) {
  try {
    parseWindowQuery(query);
  } catch (error) {
    return error;
  }
  throw new Error('expected parseWindowQuery to throw');
}

test('defaults', () => {
  expect(parseWindowQuery(ok)).toEqual({
    lat: 52.37,
    lon: 4.89,
    avail: [{ startMin: 360, endMin: 1320 }],
    availText: '06-22',
    dark: 'avoid',
    rain: 40,
    prefer: 'balanced',
    lang: 'en',
    slots: false
  });
});

test('empty strings use defaults', () => {
  const result = parseWindowQuery({ ...ok, avail: '', dark: '', rain: '', prefer: '', wind: '', lang: '' });
  expect(result).toMatchObject({ availText: '06-22', dark: 'avoid', rain: 40, prefer: 'balanced', lang: 'en' });
});

test('valid optional values are passed through', () => {
  const result = parseWindowQuery({ ...ok, avail: '07-09,12-14', dark: 'ok', rain: '0', prefer: 'temp', lang: 'nl' });
  expect(result).toMatchObject({ availText: '07-09,12-14', dark: 'ok', rain: 0, prefer: 'temp', lang: 'nl' });
  expect(parseWindowQuery({ ...ok, rain: '100' }).rain).toBe(100);
});

test('rounds and normalises', () => {
  expect(parseWindowQuery({ lat: '52.3731', lon: '-0.001' })).toMatchObject({ lat: 52.37, lon: 0 });
  expect(Object.is(parseWindowQuery({ lat: '-0.001', lon: '1' }).lat, 0)).toBe(true);
  expect(Object.is(parseWindowQuery({ lat: '1', lon: '-0.001' }).lon, 0)).toBe(true);
  expect(Object.is(parseWindowQuery({ lat: '-0', lon: '-0.00' }).lon, 0)).toBe(true);
});

test.each([
  ['90', 90],
  ['-90', -90],
  ['0', 0]
])('lat %s is valid', (value, expected) => {
  expect(parseWindowQuery({ lat: value, lon: '4.89' }).lat).toBe(expected);
});

test.each([
  ['180', 180],
  ['-180', -180]
])('lon %s is valid', (value, expected) => {
  expect(parseWindowQuery({ lat: '1', lon: value }).lon).toBe(expected);
});

test.each(['90.01', '-90.01', '1e1', '0x10', ' 5', '5 ', '', 'abc', '+5', '.5', '5.', 'NaN', 'Infinity', '1000'])(
  'lat %j is a 400',
  value => {
    const error = catchError({ lat: value, lon: '4.89' });
    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/lat/);
  }
);

test.each(['180.01', '-180.01', '1e1', '', 'abc'])('lon %j is a 400', value => {
  const error = catchError({ lat: '52.37', lon: value });
  expect(error.statusCode).toBe(400);
  expect(error.message).toMatch(/lon/);
});

test('missing lat or lon is a 400', () => {
  expect(catchError({ lon: '4.89' })).toMatchObject({ statusCode: 400, message: expect.stringMatching(/lat/) });
  expect(catchError({ lat: '52.37' })).toMatchObject({ statusCode: 400, message: expect.stringMatching(/lon/) });
  expect(catchError({}).statusCode).toBe(400);
});

describe('object and repeated values are a 400', () => {
  const values = {
    lat: '52.37',
    lon: '4.89',
    avail: '06-22',
    dark: 'ok',
    rain: '40',
    prefer: 'wind',
    wind: 'normal',
    lang: 'en'
  };

  test.each(Object.keys(values))('%s', name => {
    for (const bad of [{ x: '1' }, ['1', '2'], [values[name]]]) {
      const error = catchError({ ...values, [name]: bad });
      expect(error.statusCode).toBe(400);
      expect(error.message).toMatch(new RegExp(name));
    }
  });
});

test.each([
  [
    '07-09,12-14',
    [
      [420, 540],
      [720, 840]
    ]
  ],
  ['07:30-09:15', [[450, 555]]],
  ['17-24', [[1020, 1440]]],
  ['17-24:00', [[1020, 1440]]],
  [
    '07-09,09-11',
    [
      [420, 540],
      [540, 660]
    ]
  ],
  ['00-24', [[0, 1440]]],
  [
    '12-14,07-09',
    [
      [420, 540],
      [720, 840]
    ]
  ]
])('avail %s', (text, ranges) => {
  const result = parseWindowQuery({ ...ok, avail: text });
  expect(result.avail).toEqual(ranges.map(([startMin, endMin]) => ({ startMin, endMin })));
  expect(result.availText).toBe(text);
});

test.each([
  '09-07',
  '07-07',
  '24-24',
  '24-25',
  '07-25',
  '07-24:30',
  '07:60-08',
  '7-9',
  '07-09,08-10',
  '08-10,07-09',
  '07-09,',
  ',07-09',
  '07-09,,12-14',
  'x',
  '07:5-08',
  '07-09 ',
  '-07-09',
  '07:00:00-08'
])('avail %j is a 400', text => {
  const error = catchError({ ...ok, avail: text });
  expect(error.statusCode).toBe(400);
  expect(error.message).toMatch(/avail/);
});

test.each(['101', '-1', '4.5', 'a', '1e1', ' 5'])('rain %j is a 400', value => {
  const error = catchError({ ...ok, rain: value });
  expect(error.statusCode).toBe(400);
  expect(error.message).toMatch(/rain/);
});

test.each(['balanced', 'wind', 'rain', 'temp'])('prefer %s is accepted', value => {
  expect(parseWindowQuery({ ...ok, prefer: value }).prefer).toBe(value);
});

test.each(['Wind', 'cold', 'all'])('prefer %s is a 400', value => {
  const error = catchError({ ...ok, prefer: value });
  expect(error.statusCode).toBe(400);
  expect(error.message).toMatch(/prefer/);
});

test('the older wind=matters means prefer=wind, and prefer wins when both are given', () => {
  expect(parseWindowQuery({ ...ok, wind: 'matters' }).prefer).toBe('wind');
  expect(parseWindowQuery({ ...ok, wind: 'normal' }).prefer).toBe('balanced');
  expect(parseWindowQuery({ ...ok, wind: 'matters', prefer: 'rain' }).prefer).toBe('rain');
  expect(parseWindowQuery({ ...ok, wind: 'matters' })).not.toHaveProperty('wind');
});

test.each(['strong', 'Matters', 'high'])('wind %s is a 400', value => {
  const error = catchError({ ...ok, wind: value });
  expect(error.statusCode).toBe(400);
  expect(error.message).toMatch(/wind/);
});

test.each(['maybe', 'OK', 'Avoid'])('dark %s is a 400', value => {
  const error = catchError({ ...ok, dark: value });
  expect(error.statusCode).toBe(400);
  expect(error.message).toMatch(/dark/);
});

test.each(['de', 'EN', 'nl-NL'])('lang %s is a 400', value => {
  const error = catchError({ ...ok, lang: value });
  expect(error.statusCode).toBe(400);
  expect(error.message).toMatch(/lang/);
});

test('errors name the parameter and never echo the value', () => {
  expect(() => parseWindowQuery({ lat: '91.123456', lon: '4.89' })).toThrow(/lat/);
  expect(() => parseWindowQuery({ lat: '91.123456', lon: '4.89' })).not.toThrow(/91\.123456/);
});

test('no error message echoes any invalid value', () => {
  const cases = [
    [{ lat: '91.123456', lon: '4.89' }, '91.123456'],
    [{ lat: 'secret-lat', lon: '4.89' }, 'secret-lat'],
    [{ lat: '52.37', lon: '181.987654' }, '181.987654'],
    [{ ...ok, avail: '09-07xyz' }, 'xyz'],
    [{ ...ok, avail: '09-07' }, '09-07'],
    [{ ...ok, rain: '777' }, '777'],
    [{ ...ok, dark: 'zzz-dark' }, 'zzz-dark'],
    [{ ...ok, lang: 'zzz-lang' }, 'zzz-lang'],
    [{ lat: { x: 'leak-me' }, lon: '4.89' }, 'leak-me'],
    [{ lat: ['leak-me', '2'], lon: '4.89' }, 'leak-me']
  ];
  for (const [query, secret] of cases) {
    expect(catchError(query).message).not.toContain(secret);
  }
});

describe('slots', () => {
  test("'1' is true, absent and empty are false", () => {
    expect(parseWindowQuery({ ...ok, slots: '1' }).slots).toBe(true);
    expect(parseWindowQuery(ok).slots).toBe(false);
    expect(parseWindowQuery({ ...ok, slots: '' }).slots).toBe(false);
  });

  test.each([['true'], ['0'], [['1', '1']], [{ x: '1' }]])('%j is a 400 naming slots, not the value', value => {
    const error = catchError({ ...ok, slots: value });

    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/^Invalid slots: /);
    expect(error.message).not.toContain('true');
  });
});
