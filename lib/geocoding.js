// Place names to coordinates, for the page's place search and the MCP's `place`, through Open-Meteo's geocoding API
// (GeoNames data, CC BY 4.0). The name goes to Open-Meteo and nowhere else: it is never logged or kept, and errors
// never carry it. Results are cached in memory by name, so a common town is looked up once.
const { fetchText } = require('../utils/httpClient');

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 5000;
const MAX_RESULTS = 5;
const CACHE_SIZE = 1000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_LENGTH = 2;
const MAX_LENGTH = 80;
const ATTRIBUTION = 'Place search by Open-Meteo.com, with data from GeoNames';

const round2 = value => Math.round(value * 100) / 100 + 0;

// The name as typed, trimmed and with runs of spaces made one. Throws a 400 the client may see.
function parsePlaceQuery(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) {
    throw Object.assign(new Error(`Invalid place: give ${MIN_LENGTH} to ${MAX_LENGTH} characters`), {
      statusCode: 400
    });
  }
  return text;
}

async function fetchPlaces(name) {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ name, count: String(MAX_RESULTS), language: 'en', format: 'json' }).toString();
  const { status, body } = await fetchText(url.toString(), { timeoutMs: TIMEOUT_MS, maxBytes: 256 * 1024 });
  if (status !== 200) throw new Error(`Geocoding responded with status ${status}`);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('Geocoding returned invalid JSON');
  }
  const results = Array.isArray(json && json.results) ? json.results : [];
  return results
    .filter(r => r && typeof r.name === 'string' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .slice(0, MAX_RESULTS)
    .map(r => ({
      name: r.name,
      region: typeof r.admin1 === 'string' ? r.admin1 : null,
      country: typeof r.country === 'string' ? r.country : null,
      countryCode: typeof r.country_code === 'string' ? r.country_code : null,
      lat: round2(r.latitude),
      lon: round2(r.longitude)
    }));
}

// "Utrecht, Utrecht, Netherlands" without repeats or gaps
function placeLabel(place) {
  const parts = [place.name, place.region, place.country].filter(Boolean);
  return parts.filter((part, index) => parts.indexOf(part) === index).join(', ');
}

function createPlaceSearch({ fetch = fetchPlaces, now = Date.now, onFailure = () => {} } = {}) {
  const cache = new Map();

  // "Bergen, Norway": the name before the first comma is looked up, the rest narrows the results down by country,
  // country code or region.
  async function search(query) {
    const [name, ...qualifiers] = parsePlaceQuery(query)
      .split(',')
      .map(part => part.trim().toLowerCase())
      .filter(Boolean);
    if (!name) return [];
    const places = await lookUp(name);
    const fits = place =>
      qualifiers.every(q =>
        [place.country, place.region, place.countryCode].some(field => field && field.toLowerCase().startsWith(q))
      );
    return places.filter(fits);
  }

  async function lookUp(name) {
    const key = name;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) {
      cache.delete(key); // most recently used goes last
      cache.set(key, hit);
      return hit.places;
    }
    let places;
    try {
      places = await fetch(name);
    } catch (error) {
      onFailure(error.message); // the message never holds the name: fetchText keeps the URL out
      throw Object.assign(new Error('Place search unavailable, try again later.'), { statusCode: 503, expose: true });
    }
    cache.delete(key);
    cache.set(key, { at: now(), places });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return places;
  }

  return { search };
}

module.exports = { ATTRIBUTION, createPlaceSearch, fetchPlaces, parsePlaceQuery, placeLabel };
