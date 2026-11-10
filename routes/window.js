const express = require('express');
const { buildWindowBody } = require('../lib/windowResponse');

function createWindowRouter({ weather, now }) {
  const router = express.Router();

  router.get('/window', async (req, res, next) => {
    try {
      return res.json(await buildWindowBody({ query: req.query, weather, now }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createWindowRouter };
