const express = require('express');
const cors = require('cors');
const path = require('path');

const stripAuth = require('./middleware/stripAuth');
const { loggingMiddleware, logError } = require('./middleware/logging');
const { createRateLimiter, parseRateLimit } = require('./middleware/rateLimit');
const { securityHeaders } = require('./middleware/securityHeaders');
const { createWeatherCache } = require('./lib/weatherCache');
const { fetchForecast } = require('./lib/openMeteo');
const { createWindowRouter } = require('./routes/window');

// `rateLimit` is the allowed requests per second per client; it defaults to RATE_LIMIT_RPS.
function createApp({ weather, now = Date.now, rateLimit } = {}) {
  const forecasts =
    weather || createWeatherCache({ fetchForecast, now, onFailure: reason => logError(new Error(reason)) });
  const limit = rateLimit === undefined ? parseRateLimit(process.env.RATE_LIMIT_RPS) : rateLimit;

  const app = express();

  // nginx runs on the same host, so honour X-Forwarded-For only on loopback connections.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  // Credentials go first, so nothing after this can log or echo them.
  app.use(stripAuth);
  app.use(securityHeaders());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'HEAD']
    })
  );
  app.use(loggingMiddleware);
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  app.get('/health/cache', (req, res) => {
    res.json({ status: 'success', cache: forecasts.stats(), timestamp: new Date().toISOString() });
  });

  app.get('/openapi.yaml', (req, res, next) => {
    res.sendFile(path.join(__dirname, 'docs', 'openapi.yaml'), error => {
      if (error) next(error);
    });
  });

  app.use('/api', createRateLimiter({ limit }), createWindowRouter({ weather: forecasts, now }));

  app.use((req, res) => {
    res.status(404).json({ status: 'error', message: 'Endpoint not found.' });
  });

  // Express only treats a middleware with four arguments as an error handler.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    const status = error.statusCode || error.status || 500;
    const expose = status < 500 || error.expose === true;

    // Exposed errors (validation, upstream unavailable, capacity) are already known and reported elsewhere.
    if (status >= 500 && !error.expose) logError(error, req);
    if (error.retryAfter !== undefined) res.set('Retry-After', String(error.retryAfter));

    return res.status(status).json({ status: 'error', message: expose ? error.message : 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
