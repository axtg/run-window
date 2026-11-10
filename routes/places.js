const express = require('express');
const { ATTRIBUTION, placeLabel } = require('../lib/geocoding');

// Place names to coordinates for the page's place search. The name is not logged (logging keeps the path only).
function createPlacesRouter({ places }) {
  const router = express.Router();

  router.get('/places', async (req, res, next) => {
    try {
      if (Array.isArray(req.query.q)) {
        throw Object.assign(new Error('Invalid place: give it once'), { statusCode: 400 });
      }
      const found = await places.search(req.query.q);
      res.set('Cache-Control', 'public, max-age=86400');
      res.json({ places: found.map(place => ({ ...place, label: placeLabel(place) })), attribution: ATTRIBUTION });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createPlacesRouter };
