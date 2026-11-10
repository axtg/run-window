// Place search: the lookup's shape, the cache, the qualifiers and the /api/places route. No live upstream.
const request = require('supertest');
const { createApp } = require('../app');
const { createPlaceSearch, parsePlaceQuery, placeLabel } = require('../lib/geocoding');

const BERGEN_NO = { name: 'Bergen', region: 'Vestland', country: 'Norway', countryCode: 'NO', lat: 60.39, lon: 5.32 };
const BERGEN_NL = {
  name: 'Bergen',
  region: 'North Holland',
  country: 'Netherlands',
  countryCode: 'NL',
  lat: 52.67,
  lon: 4.7
};

describe('createPlaceSearch', () => {
  test('looks a name up once, then answers from the cache, whatever its case or spacing', async () => {
    const fetch = jest.fn().mockResolvedValue([BERGEN_NO, BERGEN_NL]);
    const { search } = createPlaceSearch({ fetch });
    expect(await search('Bergen')).toEqual([BERGEN_NO, BERGEN_NL]);
    expect(await search('  bergen ')).toEqual([BERGEN_NO, BERGEN_NL]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('bergen');
  });

  test('narrows "Bergen, Norway" down by country, country code or region', async () => {
    const { search } = createPlaceSearch({ fetch: jest.fn().mockResolvedValue([BERGEN_NO, BERGEN_NL]) });
    expect(await search('Bergen, Norway')).toEqual([BERGEN_NO]);
    expect(await search('Bergen, NL')).toEqual([BERGEN_NL]);
    expect(await search('Bergen, north holland')).toEqual([BERGEN_NL]);
    expect(await search('Bergen, Peru')).toEqual([]);
  });

  test('an expired entry is looked up again', async () => {
    const clock = { t: 0 };
    const fetch = jest.fn().mockResolvedValue([BERGEN_NO]);
    const { search } = createPlaceSearch({ fetch, now: () => clock.t });
    await search('Bergen');
    clock.t = 8 * 24 * 60 * 60 * 1000;
    await search('Bergen');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('an upstream failure is a plain 503, reported without the name', async () => {
    const onFailure = jest.fn();
    const { search } = createPlaceSearch({
      fetch: jest.fn().mockRejectedValue(new Error('Request failed')),
      onFailure
    });
    await expect(search('Bergen')).rejects.toMatchObject({
      statusCode: 503,
      expose: true,
      message: 'Place search unavailable, try again later.'
    });
    expect(onFailure).toHaveBeenCalledWith('Request failed');
  });

  test('a name must be 2 to 80 characters', () => {
    expect(() => parsePlaceQuery('a')).toThrow('Invalid place: give 2 to 80 characters');
    expect(() => parsePlaceQuery('x'.repeat(81))).toThrow('Invalid place');
    expect(() => parsePlaceQuery(undefined)).toThrow('Invalid place');
    expect(parsePlaceQuery(' Den   Haag ')).toBe('Den Haag');
  });

  test('labels skip repeats and gaps', () => {
    expect(placeLabel({ name: 'Utrecht', region: 'Utrecht', country: 'Netherlands' })).toBe('Utrecht, Netherlands');
    expect(placeLabel({ name: 'Monaco', region: null, country: 'Monaco' })).toBe('Monaco');
  });
});

describe('GET /api/places', () => {
  const build = places => createApp({ weather: { getForecast: jest.fn() }, places, rateLimit: 1000 });

  test('answers the matches with a label and the attribution', async () => {
    const places = { search: jest.fn().mockResolvedValue([BERGEN_NO]) };
    const { body, headers } = await request(build(places)).get('/api/places?q=Bergen').expect(200);
    expect(body).toEqual({
      places: [{ ...BERGEN_NO, label: 'Bergen, Vestland, Norway' }],
      attribution: 'Place search by Open-Meteo.com, with data from GeoNames'
    });
    expect(headers['cache-control']).toBe('public, max-age=86400');
  });

  test('a bad or repeated name is 400 with the reason', async () => {
    const places = createPlaceSearch({ fetch: jest.fn() });
    expect((await request(build(places)).get('/api/places?q=a').expect(400)).body.message).toMatch(/^Invalid place/);
    await request(build(places)).get('/api/places').expect(400);
    await request(build(places)).get('/api/places?q=ab&q=cd').expect(400);
  });

  test('an upstream failure is 503 with a plain message', async () => {
    const places = createPlaceSearch({ fetch: jest.fn().mockRejectedValue(new Error('x')) });
    const { body } = await request(build(places)).get('/api/places?q=Bergen').expect(503);
    expect(body.message).toBe('Place search unavailable, try again later.');
  });
});

describe('fetchPlaces', () => {
  const { fetchPlaces } = require('../lib/geocoding');
  afterEach(() => jest.restoreAllMocks());

  test('asks Open-Meteo for 5 matches in English and keeps only what the page needs', async () => {
    const results = [
      {
        id: 1,
        name: 'Bergen',
        latitude: 60.39299,
        longitude: 5.32415,
        admin1: 'Vestland',
        country: 'Norway',
        country_code: 'NO',
        population: 285601
      },
      { name: 'Broken', latitude: 'x', longitude: 1 }
    ];
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results })));
    expect(await fetchPlaces('bergen')).toEqual([
      { name: 'Bergen', region: 'Vestland', country: 'Norway', countryCode: 'NO', lat: 60.39, lon: 5.32 }
    ]);
    const url = new URL(spy.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: 'bergen',
      count: '5',
      language: 'en',
      format: 'json'
    });
  });

  test('no match is an empty list; a bad status is an error without the name', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('{"generationtime_ms":0.1}'));
    expect(await fetchPlaces('nowhere')).toEqual([]);
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(fetchPlaces('nowhere')).rejects.toThrow('Geocoding responded with status 500');
  });
});
