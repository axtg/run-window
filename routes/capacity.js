const express = require('express');

// How much of today's cap for new locations is left: coarse and an hour old on purpose (see weatherCache.capacity).
function createCapacityRouter({ weather }) {
  const router = express.Router();

  router.get('/capacity', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(weather.capacity());
  });

  return router;
}

module.exports = { createCapacityRouter };
