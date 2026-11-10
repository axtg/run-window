const { parseWindowQuery } = require('./params');
const { localDates, computeDay } = require('./windows');
const { formatLabel } = require('./labels');

const ATTRIBUTION = 'Weather data by Open-Meteo.com';

// The /api/window body for a query of plain strings, as Express parses it. Shared with the MCP tools, so both validate
// and score the same way. Throws the parser's 400 errors and the weather cache's 503s.
async function buildWindowBody({ query, weather, now }) {
  // Validate first, so an invalid request never takes a slot in the weather cache's key budget.
  const params = parseWindowQuery(query);
  const { lat, lon, availText, dark, rain, prefer, lang } = params;
  const { forecast, stale } = await weather.getForecast(lat, lon);

  const nowMs = now();
  const { timezone } = forecast;
  const label = window => (window ? { ...window, label: formatLabel(window, { timezone, lang }) } : window);
  const days = localDates(nowMs, timezone).map(date => {
    const day = computeDay({ date, forecast, params, nowMs, includeSlots: params.slots });
    const windows = Object.fromEntries(Object.entries(day.windows).map(([key, value]) => [key, label(value)]));
    return { ...day, windows, ...('fallback' in day ? { fallback: label(day.fallback) } : {}) };
  });

  const body = {
    location: { lat, lon, timezone },
    generatedAt: new Date(nowMs).toISOString(),
    params: { avail: availText, dark, rain, prefer },
    days,
    attribution: ATTRIBUTION
  };
  if (stale) body.warnings = ['stale_data'];
  return body;
}

module.exports = { ATTRIBUTION, buildWindowBody };
