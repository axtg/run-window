const { STATUS_CODES } = require('http');
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

const OPENAPI_FILE = path.join(__dirname, 'docs', 'openapi.yaml');

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
    res.sendFile(OPENAPI_FILE, error => {
      if (!error || res.headersSent) return undefined; // sent, or the client went away
      if (error.code === 'ENOENT' || error.status === 404) return next(); // the fixed 404 answers
      return next(new Error('Could not send openapi.yaml')); // never forward fs errors: they carry paths
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
    // Only errors this app created (a plain Error with statusCode, or expose: true) explain themselves. Errors from
    // fs, send or http-errors carry paths and URLs, so they get the standard text for their status.
    const own = error.status === undefined && error.syscall === undefined;
    const expose = own && (error.expose === true || (status < 500 && error.statusCode !== undefined));
    const fallback = status < 500 ? STATUS_CODES[status] || 'Bad request' : 'Internal server error';

    // Exposed errors (validation, upstream unavailable, capacity) are already known and reported elsewhere.
    if (status >= 500 && !error.expose) logError(error, req);
    if (error.retryAfter !== undefined) res.set('Retry-After', String(error.retryAfter));

    return res.status(status).json({ status: 'error', message: expose ? error.message : fallback });
  });

  return app;
}

module.exports = { createApp };
