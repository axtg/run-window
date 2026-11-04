const express = require('express');
const { parseWindowQuery } = require('../lib/params');
const { localDates, computeDay } = require('../lib/windows');
const { formatLabel } = require('../lib/labels');

const ATTRIBUTION = 'Weather data by Open-Meteo.com';

function createWindowRouter({ weather, now }) {
  const router = express.Router();

  router.get('/window', async (req, res, next) => {
    try {
      // Validate first, so an invalid request never takes a slot in the weather cache's key budget.
      const query = parseWindowQuery(req.query);
      const { lat, lon, availText, dark, rain, lang } = query;
      const { forecast, stale } = await weather.getForecast(lat, lon);

      const nowMs = now();
      const { timezone } = forecast;
      const label = window => (window ? { ...window, label: formatLabel(window, { timezone, lang }) } : window);
      const days = localDates(nowMs, timezone).map(date => {
        const day = computeDay({ date, forecast, params: query, nowMs, includeSlots: query.slots });
        const windows = Object.fromEntries(Object.entries(day.windows).map(([key, value]) => [key, label(value)]));
        return { ...day, windows, ...('fallback' in day ? { fallback: label(day.fallback) } : {}) };
      });

      const body = {
        location: { lat, lon, timezone },
        generatedAt: new Date(nowMs).toISOString(),
        params: { avail: availText, dark, rain },
        days,
        attribution: ATTRIBUTION
      };
      if (stale) body.warnings = ['stale_data'];
      return res.json(body);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createWindowRouter };
