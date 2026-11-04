const fs = require('fs');
const path = require('path');
const { parseWindowQuery } = require('../../lib/params');
const { loadSettings, renderPollingUrl } = require('./harness');
const { readSettings, windowUrl } = require('../../integrations/trmnl-running-board/src/settings');

const RAW_YAML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'integrations', 'trmnl-running-board', 'settings.yml'),
  'utf8'
);
const field = key => loadSettings().custom_fields.find(f => f.keyname === key);
const inputWith = values => ({ trmnl: { plugin_settings: { custom_fields_values: values } } });
const queryOf = url => Object.fromEntries(new URL(url).searchParams);

describe('settings.yml', () => {
  it('has a name and a description that the TRMNL import accepts', () => {
    const settings = loadSettings();
    expect(settings.name).toBe('Running Board');
    expect(settings.description.length).toBeLessThanOrEqual(35);
  });

  it('polls every 30 minutes without headers', () => {
    const settings = loadSettings();
    expect(settings.strategy).toBe('polling');
    expect(settings.polling_verb).toBe('get');
    expect(settings.refresh_interval).toBe(30);
    expect(settings.polling_headers || '').toBe('');
    expect(RAW_YAML).not.toMatch(/polling_headers:\s*\S/);
  });

  it('quotes every select option value in the raw YAML', () => {
    const lines = RAW_YAML.split('\n').filter(line => /^ {6}- .+: /.test(line));
    expect(lines).toHaveLength(12);
    for (const line of lines) expect(line).toMatch(/: '[^']+'$/);
  });

  it('has the documented fields and defaults', () => {
    expect(loadSettings().custom_fields.map(f => f.keyname)).toEqual([
      'tredict_token',
      'lat_lon',
      'availability',
      'dark',
      'rain',
      'sport',
      'language',
      'theme'
    ]);
    expect(field('lat_lon').field_type).toBe('lat_lon');
    expect(field('availability').default).toBe('07-09,12-14,17-21');
    expect(field('dark').default).toBe('avoid');
    expect(field('rain').default).toBe('40');
    expect(field('sport').default).toBe('running');
    expect(field('language').default).toBe('device');
    expect(field('theme').default).toBe('light');
    expect(field('rain').options.map(o => Object.values(o)[0])).toEqual(['20', '40', '60']);
  });

  it('makes the token a password field whose help text names the scope and the 10 days', () => {
    const token = field('tredict_token');
    expect(token.field_type).toBe('password');
    expect(token.description).toMatch(/activityRead/);
    expect(token.description).toMatch(/10 days/);
  });
});

describe('polling URL', () => {
  const cases = [
    [
      { lat_lon: '52.373187,4.892241', availability: '07-09, 17-21', dark: 'avoid', rain: '40' },
      'https://run.xadi.eu/api/window?lat=52.37&lon=4.89&avail=07-09%2C17-21&dark=avoid&rain=40'
    ],
    [
      { lat_lon: '-33.8688, 151.2093', availability: '06-22', dark: 'ok', rain: '60' },
      'https://run.xadi.eu/api/window?lat=-33.87&lon=151.21&avail=06-22&dark=ok&rain=60'
    ]
  ];

  it.each(cases)('renders %j and windowUrl agrees', async (values, expected) => {
    const rendered = await renderPollingUrl(values);
    expect(rendered).toBe(expected);
    expect(windowUrl(readSettings(inputWith(values)))).toBe(expected);
  });

  it('is accepted by the API with two avail ranges', async () => {
    const url = await renderPollingUrl(cases[0][0]);
    const parsed = parseWindowQuery(queryOf(url));
    expect(parsed.avail).toHaveLength(2);
    expect(parsed).toMatchObject({ lat: 52.37, lon: 4.89, dark: 'avoid', rain: 40 });
  });

  it('renders the defaults for empty availability, dark and rain', async () => {
    const values = { lat_lon: '52.37,4.89', availability: '', dark: '', rain: '' };
    const expected = 'https://run.xadi.eu/api/window?lat=52.37&lon=4.89&avail=07-09%2C12-14%2C17-21&dark=avoid&rain=40';
    expect(await renderPollingUrl(values)).toBe(expected);
    expect(windowUrl(readSettings(inputWith(values)))).toBe(expected);
    expect(readSettings(inputWith(values))).toMatchObject({
      availability: '07-09,12-14,17-21',
      dark: 'avoid',
      rain: '40'
    });
  });

  it.each([[{}], [{ lat_lon: '' }], [{ lat_lon: 'abc' }]])('has no location for %j', async values => {
    const url = await renderPollingUrl(values);
    expect(url).not.toMatch(/lat=/);
    expect(url).not.toMatch(/lon=/);
    const settings = readSettings(inputWith(values));
    expect(settings.hasLocation).toBe(false);
    expect(settings).toMatchObject({ lat: null, lon: null });
    expect(windowUrl(settings)).toBeNull();
  });
});

describe('readSettings', () => {
  it('applies the defaults and keeps the token', () => {
    expect(readSettings(inputWith({ tredict_token: 'secret', lat_lon: '52.373187,4.892241' }))).toEqual({
      token: 'secret',
      lat: 52.37,
      lon: 4.89,
      availability: '07-09,12-14,17-21',
      dark: 'avoid',
      rain: '40',
      sport: 'running',
      language: 'device',
      theme: 'light',
      hasLocation: true
    });
  });

  it('reads the theme: only dark is dark', () => {
    expect(readSettings(inputWith({ theme: 'dark' })).theme).toBe('dark');
    for (const theme of ['light', 'Dark', '', 5, undefined]) {
      expect(readSettings(inputWith({ theme })).theme).toBe('light');
    }
  });

  it('removes spaces from availability', () => {
    expect(readSettings(inputWith({ availability: ' 07-09, 17-21 ' })).availability).toBe('07-09,17-21');
  });

  it('never throws on malformed input', () => {
    const inputs = [
      undefined,
      null,
      {},
      'text',
      { trmnl: null },
      { trmnl: {} },
      { trmnl: { plugin_settings: null } },
      inputWith(null),
      inputWith('x'),
      inputWith({ tredict_token: 5, lat_lon: 52, availability: ['a'], dark: {}, rain: 40, sport: null, language: true })
    ];
    for (const input of inputs) {
      const settings = readSettings(input);
      expect(settings).toMatchObject({
        token: '',
        hasLocation: false,
        availability: '07-09,12-14,17-21',
        dark: 'avoid',
        rain: '40',
        sport: 'running',
        language: 'device'
      });
      expect(windowUrl(settings)).toBeNull();
    }
  });

  it('rejects out-of-range coordinates', () => {
    expect(readSettings(inputWith({ lat_lon: '91,4' })).hasLocation).toBe(false);
    expect(readSettings(inputWith({ lat_lon: '1,2,3' })).hasLocation).toBe(false);
  });
});
