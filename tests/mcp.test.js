// The MCP server at /mcp, against the real app with a fake weather cache (no upstream calls).
const request = require('supertest');
const { createApp } = require('../app');
const { parseForecast } = require('../lib/forecast');
const { makeForecastJson } = require('./helpers/forecast');

const LEGACY_VERSION = '2025-06-18';
const MODERN_VERSION = '2026-07-28';
const NOW = Date.UTC(2026, 10, 2, 7, 0); // 08:00 in Amsterdam, Monday 2 November 2026
const START = Date.UTC(2026, 10, 1, 23); // local midnight
const SUN = [
  { sunriseMs: Date.UTC(2026, 10, 2, 6, 38), sunsetMs: Date.UTC(2026, 10, 2, 16, 9) },
  { sunriseMs: Date.UTC(2026, 10, 3, 6, 40), sunsetMs: Date.UTC(2026, 10, 3, 16, 7) }
];
const AMSTERDAM = { latitude: 52.3702, longitude: 4.8952 };

// Hour i from local midnight on 2 November: windy all day (20 km/h from the south-west), except 13:00-15:00 local
// (12:00-14:00 UTC), which is calm and mild; rain all of 3 November.
function values(i) {
  if (i >= 24) return { precipitation_probability: 90, precipitation: 2, wind_speed_10m: 20, wind_direction_10m: 225 };
  if (i === 13 || i === 14) return { wind_speed_10m: 14, wind_direction_10m: 90, apparent_temperature: 11 };
  return { wind_speed_10m: 20, wind_direction_10m: 225, apparent_temperature: 9 };
}

function weatherWith(getForecast) {
  return { getForecast, stats: () => ({}), capacity: () => ({}) };
}

const forecast = parseForecast(makeForecastJson({ startMs: START, hours: 72, sun: SUN, values }));

describe('POST /mcp', () => {
  let weather;
  let app;

  beforeEach(() => {
    weather = weatherWith(jest.fn().mockResolvedValue({ forecast, stale: false }));
    app = createApp({ weather, now: () => NOW, rateLimit: 1000 });
  });

  function textParser(res, callback) {
    res.setEncoding('utf8');
    let body = '';
    res.on('data', chunk => {
      body += chunk;
    });
    res.on('end', () => callback(null, body));
  }

  // 2025-era clients get a short event stream, 2026-era clients plain JSON.
  function parseReply(response) {
    if (!response.headers['content-type']?.includes('text/event-stream')) return JSON.parse(response.body);
    const data = response.body.split('\n').find(line => line.startsWith('data: {'));
    return JSON.parse(data.slice('data: '.length));
  }

  const post = (body, version = LEGACY_VERSION, target = app) =>
    request(target)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', version)
      .send(body)
      .buffer(true)
      .parse(textParser);

  const rpc = (method, params = {}, target = app) => post({ jsonrpc: '2.0', id: 1, method, params }, undefined, target);

  async function callTool(name, args, target = app) {
    const response = await rpc('tools/call', { name, arguments: args }, target).expect(200);
    return parseReply(response).result;
  }

  async function toolData(name, args) {
    const result = await callTool(name, args);
    expect(result.isError).toBeFalsy();
    return JSON.parse(result.content[0].text);
  }

  describe('protocol', () => {
    test('a client can initialize without a session, and is told to ask for the town', async () => {
      const response = await rpc('initialize', {
        protocolVersion: LEGACY_VERSION,
        capabilities: {},
        clientInfo: { name: 'test', version: '1' }
      }).expect(200);

      const { result } = parseReply(response);
      expect(response.headers['mcp-session-id']).toBeUndefined();
      expect(result.serverInfo.name).toBe('best-time-to-run');
      expect(result.instructions).toMatch(/ask for it/);
      expect(result.instructions).toContain('Open-Meteo');
    });

    test('lists the two read-only tools, each taking coordinates or a place name', async () => {
      const { result } = parseReply(await rpc('tools/list').expect(200));
      expect(result.tools.map(tool => tool.name).sort()).toEqual(['find_best_run_time', 'get_run_conditions']);
      for (const tool of result.tools) {
        expect(tool.annotations).toMatchObject({ readOnlyHint: true });
        expect(Object.keys(tool.inputSchema.properties)).toEqual(
          expect.arrayContaining(['latitude', 'longitude', 'place'])
        );
      }
    });

    test('find_best_run_time names its view, for hosts that show MCP Apps', async () => {
      const { result } = parseReply(await rpc('tools/list').expect(200));
      const byName = Object.fromEntries(result.tools.map(tool => [tool.name, tool]));
      expect(byName.find_best_run_time._meta).toEqual({
        ui: { resourceUri: 'ui://besttimetorun/day.html' },
        'ui/resourceUri': 'ui://besttimetorun/day.html'
      });
      expect(byName.get_run_conditions._meta).toBeUndefined();
    });

    test('serves the view as one HTML file that may load nothing', async () => {
      const { result } = parseReply(await rpc('resources/read', { uri: 'ui://besttimetorun/day.html' }).expect(200));
      const [view] = result.contents;
      expect(view.mimeType).toBe('text/html;profile=mcp-app');
      expect(view.text).toMatch(/^<!doctype html>/i);
      expect(view._meta).toEqual({ ui: { csp: {}, prefersBorder: true } });
      expect(weather.getForecast).not.toHaveBeenCalled();
    });

    test('a current client gets plain JSON', async () => {
      const response = await post(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
              'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': {}
            }
          }
        },
        MODERN_VERSION
      )
        .set('MCP-Method', 'tools/list')
        .expect(200);

      expect(response.headers['content-type']).toContain('application/json');
      expect(parseReply(response).result.tools).toHaveLength(2);
    });

    test('GET is not supported', async () => {
      await request(app).get('/mcp').set('MCP-Protocol-Version', LEGACY_VERSION).expect(405);
    });

    test('rejects an oversized request', async () => {
      await rpc('tools/list', { padding: 'x'.repeat(70 * 1024) }).expect(413);
    });

    test('refuses a batch, which would get past the rate limit', async () => {
      const call = id => ({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'find_best_run_time', arguments: AMSTERDAM }
      });
      const response = await post([call(1), call(2)]);
      expect(response.status).toBe(400);
      expect(weather.getForecast).not.toHaveBeenCalled();
    });

    test('rejects malformed JSON', async () => {
      await request(app).post('/mcp').set('Content-Type', 'application/json').send('{not json').expect(400);
    });

    test('shares the API rate limiter', async () => {
      const limited = createApp({ weather, now: () => NOW, rateLimit: 1 });
      await request(limited).get('/api/capacity').expect(200);
      const response = await rpc('tools/list', {}, limited);
      expect(response.status).toBe(429);
    });
  });

  describe('find_best_run_time', () => {
    test('finds the calm hour in local time, with the way to start', async () => {
      const data = await toolData('find_best_run_time', { ...AMSTERDAM, minutes: 60 });
      expect(data).toMatchObject({
        available: true,
        day: 'today',
        minutes: 60,
        location: { latitude: 52.37, longitude: 4.9, timezone: 'Europe/Amsterdam' },
        date: '2026-11-02',
        sunrise: '07:38',
        sunset: '17:09',
        hours: '06-22',
        attribution: 'Weather data by Open-Meteo.com'
      });
      expect(data.window).toMatchObject({
        start: '2026-11-02T13:00+01:00',
        end: '2026-11-02T14:00+01:00',
        dry: true,
        windKmh: 14,
        windFrom: 'east',
        feelsLikeC: 11,
        inDaylight: true
      });
      expect(data.window.startDirection).toBe(
        'Wind from the east: start east, into it, so it is behind you on the way back.'
      );
    });

    test("gives the view the day's slots and the window in _meta, outside the model's text", async () => {
      const result = await callTool('find_best_run_time', { ...AMSTERDAM, minutes: 60, hours: '12-16' });
      const view = result._meta['com.besttimetorun/day'];
      expect(view).toMatchObject({ dayIndex: 0, date: '2026-11-02', minutes: 60, timeZone: 'Europe/Amsterdam' });
      expect(Object.keys(view.day.windows)).toEqual(['60']);
      expect(view.day.windows['60'].start).toBe('2026-11-02T12:00:00.000Z');
      expect(view.day.slots).toHaveLength(16);
      expect(view.day.slots[0]).toMatchObject({ start: '2026-11-02T11:00:00.000Z', status: 'ok' });
      expect(result.content[0].text).not.toContain('slots');
    });

    test('rounds the length up to 15 minutes, and sends the settings as the API takes them', async () => {
      const data = await toolData('find_best_run_time', {
        ...AMSTERDAM,
        minutes: 50,
        hours: '07-09, 12-15',
        darkOk: true,
        maxRainChance: 30,
        mindMost: 'wind'
      });
      expect(data.minutes).toBe(60);
      expect(data.hours).toBe('07-09,12-15');
      expect(weather.getForecast).toHaveBeenCalledWith(52.37, 4.9); // rounded to 2 decimals, as for the API
    });

    test('says why nothing fits, with the least bad hour, on a wet day', async () => {
      const data = await toolData('find_best_run_time', { ...AMSTERDAM, day: 'tomorrow' });
      expect(data.available).toBe(false);
      expect(data.reason).toBe(
        'Every 60-minute stretch within 06-22 tomorrow is too wet: part of it has over 40 % chance of rain, ' +
          'or rain expected.'
      );
      expect(data.tryNext).toMatch(/higher maxRainChance/);
      expect(data.leastBadHour).toMatchObject({ dry: false, rainChanceMax: 90 });
      const { _meta } = await callTool('find_best_run_time', { ...AMSTERDAM, day: 'tomorrow' });
      expect(_meta['com.besttimetorun/day'].day).toMatchObject({ windows: {}, fallback: expect.any(Object) });
    });

    test('hours already gone by are the reason, not rain', async () => {
      const data = await toolData('find_best_run_time', { ...AMSTERDAM, hours: '06-08' }); // it is 08:00
      expect(data).toMatchObject({
        available: false,
        reason: 'All of 06-08 has already passed today.',
        tryNext: 'Tomorrow, or later hours today.'
      });
    });

    test('too little time left is the reason, not rain', async () => {
      const data = await toolData('find_best_run_time', { ...AMSTERDAM, hours: '07-08:30' });
      expect(data.reason).toBe(
        'Not enough time: the longest stretch that is still ahead within 07-08:30 today is 30 minutes.'
      );
      expect(data.tryNext).toBe('Tomorrow, more hours, a shorter run.');
    });

    test('too little daylight is the reason, not rain', async () => {
      const data = await toolData('find_best_run_time', { ...AMSTERDAM, minutes: 90, hours: '16-19' });
      expect(data.reason).toBe(
        'Not enough time: the longest stretch that is in daylight within 16-19 today is 60 minutes.'
      );
      expect(data.tryNext).toBe('More hours, a shorter run, darkOk.');
    });

    test('a best time in the dark comes with the best one in daylight', async () => {
      // Calm only at 19:00-20:00 local, after dark; windy otherwise
      const evening = i => ({ wind_speed_10m: i === 19 ? 3 : 25, wind_direction_10m: 225, apparent_temperature: 10 });
      const calmAfterDark = parseForecast(makeForecastJson({ startMs: START, hours: 72, sun: SUN, values: evening }));
      const target = createApp({
        weather: weatherWith(jest.fn().mockResolvedValue({ forecast: calmAfterDark, stale: false })),
        now: () => NOW,
        rateLimit: 1000
      });
      const args = { name: 'find_best_run_time', arguments: { ...AMSTERDAM, hours: '12-21', darkOk: true } };
      const result = await callTool(args.name, args.arguments, target);
      const data = JSON.parse(result.content[0].text);
      expect(data.window).toMatchObject({ start: '2026-11-02T19:00+01:00', inDaylight: false });
      expect(data.bestInDaylight).toMatchObject({ start: '2026-11-02T12:00+01:00', inDaylight: true });

      const daylightOnly = JSON.parse(
        (await callTool(args.name, { ...args.arguments, darkOk: false }, target)).content[0].text
      );
      expect(daylightOnly.bestInDaylight).toBeUndefined();
      const noDaylightLeft = { ...args.arguments, hours: '18-21' };
      const late = JSON.parse((await callTool(args.name, noDaylightLeft, target)).content[0].text);
      expect(late.bestInDaylight).toBeNull();
    });

    test('looks at the day after tomorrow by its date, with a note that the forecast can shift', async () => {
      const data = await toolData('find_best_run_time', { ...AMSTERDAM, day: '2026-11-04', darkOk: true });
      expect(data).toMatchObject({ day: '2026-11-04', date: '2026-11-04' });
      expect(data.forecastNote).toMatch(/can still shift/);
      const today = await toolData('find_best_run_time', AMSTERDAM);
      expect(today.forecastNote).toBeUndefined();
    });

    test('a date without a forecast here is a tool error naming the days there are', async () => {
      const result = await callTool('find_best_run_time', { ...AMSTERDAM, day: '2026-11-09' });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toBe(
        'Invalid day: 2026-11-09 is not one of the days with a forecast here (2026-11-02, 2026-11-03, 2026-11-04)'
      );
      const wrong = await callTool('find_best_run_time', { ...AMSTERDAM, day: 'Thursday' });
      expect(wrong.isError).toBe(true);
    });

    test('a bad hours value is a tool error with the reason', async () => {
      const result = await callTool('find_best_run_time', { ...AMSTERDAM, hours: '9 to 5' });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/^Invalid avail/);
      expect(weather.getForecast).not.toHaveBeenCalled(); // validated before it takes a place in the day's cap
    });

    test('a latitude out of range is refused before the tool runs', async () => {
      const result = await callTool('find_best_run_time', { latitude: 95, longitude: 4.9 });
      expect(result.isError).toBe(true);
      expect(weather.getForecast).not.toHaveBeenCalled();
    });

    test("the day's cap reaches the user as it is", async () => {
      const full = Object.assign(new Error('The service is at capacity for new locations today.'), {
        statusCode: 503,
        expose: true
      });
      const capped = createApp({ weather: weatherWith(jest.fn().mockRejectedValue(full)), now: () => NOW });
      const result = await callTool('find_best_run_time', AMSTERDAM, capped);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toBe('The service is at capacity for new locations today.');
    });

    test('an unexpected failure is a tool error without internal details', async () => {
      const broken = createApp({
        weather: weatherWith(jest.fn().mockRejectedValue(new Error('ECONNRESET at /srv/secret/path'))),
        now: () => NOW
      });
      const result = await callTool('find_best_run_time', AMSTERDAM, broken);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(JSON.stringify({ error: 'Internal server error' }));
    });
  });

  describe('a place by name', () => {
    const UTRECHT = {
      name: 'Utrecht',
      region: 'Utrecht',
      country: 'Netherlands',
      countryCode: 'NL',
      lat: 52.09,
      lon: 5.12
    };
    const OTHER = {
      name: 'Utrecht',
      region: 'KwaZulu-Natal',
      country: 'South Africa',
      countryCode: 'ZA',
      lat: -27.66,
      lon: 30.32
    };
    const placesWith = found => ({ search: jest.fn().mockResolvedValue(found) });
    const appWith = places => createApp({ weather, places, now: () => NOW, rateLimit: 1000 });

    test('is looked up, named in the answer with the other matches, and its coordinates used', async () => {
      const places = placesWith([UTRECHT, OTHER]);
      const result = await callTool('find_best_run_time', { place: 'Utrecht' }, appWith(places));
      const data = JSON.parse(result.content[0].text);
      expect(places.search).toHaveBeenCalledWith('Utrecht');
      expect(data.location).toMatchObject({
        name: 'Utrecht, Netherlands',
        otherMatches: ['Utrecht, KwaZulu-Natal, South Africa'],
        latitude: 52.09,
        longitude: 5.12
      });
      expect(weather.getForecast).toHaveBeenCalledWith(52.09, 5.12);
    });

    test('coordinates win over a place, which is then not looked up', async () => {
      const places = placesWith([UTRECHT]);
      const data = JSON.parse(
        (await callTool('get_run_conditions', { ...AMSTERDAM, place: 'Utrecht' }, appWith(places))).content[0].text
      );
      expect(places.search).not.toHaveBeenCalled();
      expect(data.location.name).toBeUndefined();
    });

    test('nothing found, or nothing given, is a tool error that says what to do', async () => {
      const none = await callTool('find_best_run_time', { place: 'Nowhereville' }, appWith(placesWith([])));
      expect(JSON.parse(none.content[0].text).error).toBe(
        'No place found for "Nowhereville": try a larger town nearby, or give coordinates.'
      );
      const empty = await callTool('find_best_run_time', {}, appWith(placesWith([])));
      expect(JSON.parse(empty.content[0].text).error).toBe('Give latitude and longitude, or a place.');
      expect(weather.getForecast).not.toHaveBeenCalled();
    });
  });

  describe('get_run_conditions', () => {
    test("gives the day's slots within the hours, in local time", async () => {
      const data = await toolData('get_run_conditions', { ...AMSTERDAM, hours: '13-14' });
      expect(data.slots.map(slot => slot.time)).toEqual(['13:00', '13:15', '13:30', '13:45']);
      expect(data.slots[0]).toMatchObject({
        status: 'ok',
        feelsLikeC: 11,
        windKmh: 14,
        windFrom: 'east',
        rainChance: 0,
        rainMm: 0
      });
      expect(data.statuses).toContain('rain: over maxRainChance');
      expect((await callTool('get_run_conditions', AMSTERDAM))._meta).toBeUndefined();
    });

    test('marks slots already past and the dark', async () => {
      const data = await toolData('get_run_conditions', { ...AMSTERDAM, hours: '07-08,17-18' });
      expect(data.slots.map(slot => slot.status)).toEqual([
        'past',
        'past',
        'past',
        'past',
        'dark',
        'dark',
        'dark',
        'dark'
      ]);
    });
  });
});
