const crypto = require('crypto');
const { isCoordinate } = require('../lib/params');

const logtailToken = process.env.LOGTAIL_TOKEN;
const logtailEndpoint = process.env.LOGTAIL_ENDPOINT;
const LOGTAIL_TIMEOUT_MS = 5000;
const MAX_USER_AGENT_LENGTH = 200;

if (!logtailToken || !logtailEndpoint) {
  console.warn('⚠️  LOGTAIL_TOKEN or LOGTAIL_ENDPOINT not set, logs are not sent');
} else {
  console.log('✅ Logtail configured');
}

// Salt is kept in memory only and replaced each UTC day, so client IDs can't be linked across days
// or reversed once the salt is gone. A restart also replaces it, splitting that day's unique counts.
let clientIdSalt = null;
let clientIdSaltDate = null;

// Per-day client ID, used instead of logging the IP
const getClientId = ip => {
  if (!ip) return null;

  const today = new Date().toISOString().slice(0, 10);
  if (clientIdSaltDate !== today) {
    clientIdSalt = crypto.randomBytes(32);
    clientIdSaltDate = today;
  }

  return crypto.createHmac('sha256', clientIdSalt).update(ip).digest('hex').slice(0, 16);
};

// Only these paths are logged by name. Anything else may carry coordinates (`/api/window%3Flat%3D...`,
// `;lat=...`, `/52.37/4.89`), so it is logged as the fixed string 'other'.
const LOGGABLE_PATHS = new Set([
  '/',
  '/api/window',
  '/api/capacity',
  '/health',
  '/health/cache',
  '/openapi.yaml',
  '/tailwind.css',
  '/favicon.ico',
  '/route.js',
  '/plan.js',
  '/strip.js',
  '/settings.js',
  '/analytics.js',
  '/app.js',
  '/manifest.webmanifest',
  '/sw.js',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/share-target',
  '/network/xadi.png',
  '/network/dap.svg',
  '/network/emailconnect.png',
  '/network/webhooktest.png',
  '/network/stackcheck.png',
  '/og.png',
  '/apple-touch-icon.png',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt'
]);
// Express routes case-insensitively and accepts one trailing slash, so `/API/Window/` is served as `/api/window`.
// Compare that canonical form; what is logged still only ever comes from the list above.
const canonicalPath = path =>
  String(path)
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .replace(/(.)\/$/, '$1');
const safePath = path => {
  const canonical = canonicalPath(path);
  return LOGGABLE_PATHS.has(canonical) ? canonical : 'other';
};

const round1 = value => Math.round(value * 10) / 10 || 0; // `|| 0` turns -0 into 0

// The only location ever logged: lat/lon rounded to 1 decimal, on /api/window, when both are valid.
const roundedLocation = (req, path) => {
  if (path !== '/api/window') return {};
  const { lat, lon } = req.query || {};
  if (!isCoordinate(lat, 90) || !isCoordinate(lon, 180)) return {};
  return { lat: round1(Number(lat)), lon: round1(Number(lon)) };
};

// Send log via HTTP endpoint
const sendToLogtail = async logData => {
  if (!logtailToken || !logtailEndpoint) return;

  const payload = JSON.stringify(logData);

  try {
    const response = await fetch(logtailEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${logtailToken}`,
        'Content-Type': 'application/json'
      },
      body: payload,
      signal: AbortSignal.timeout(LOGTAIL_TIMEOUT_MS)
    });

    if (!response.ok) {
      console.error('Failed to send log to Logtail:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Error sending to Logtail:', error.message);
  }
};

// Logs an allowlisted path only, never the query string or referrer: both can carry coordinates.
const loggingMiddleware = (req, res, next) => {
  // Read now: inside res.end Express has stripped the prefix of any router or middleware mount.
  const path = safePath(req.path);
  const location = roundedLocation(req, path);
  req.loggablePath = path;
  const startTime = Date.now();

  // Capture original end function
  const originalEnd = res.end;

  // Override res.end to capture response data
  res.end = function (chunk, encoding) {
    const responseTime = Date.now() - startTime;

    // Logging must never prevent the response from being delivered
    try {
      const logData = {
        dt: new Date().toISOString(), // Better Stack expects 'dt' for timestamp
        level: res.statusCode >= 400 ? 'error' : 'info',
        message: `${req.method} ${path} - ${res.statusCode}`,
        method: req.method,
        path,
        statusCode: res.statusCode,
        responseTime: responseTime,
        userAgent: (req.get('User-Agent') || 'Unknown').slice(0, MAX_USER_AGENT_LENGTH),
        clientId: getClientId(req.ip || req.socket?.remoteAddress),
        ...location,
        contentLength: res.get('Content-Length') || 0,
        service: 'run-window-api',
        environment: process.env.NODE_ENV || 'development'
      };

      // Send to Better Stack asynchronously
      if (logtailToken) {
        sendToLogtail(logData).catch(err => {
          console.error('Logtail logging failed:', err.message);
        });
      }

      // Also log to console for local development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`${req.method} ${path} - ${res.statusCode} - ${responseTime}ms`);
      }
    } catch (err) {
      console.error('Request logging failed:', err.message);
    }

    // Call original end function
    return originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Error logging function. Callers pass errors whose messages carry no coordinates.
const logError = (error, req = null) => {
  const errorData = {
    dt: new Date().toISOString(),
    level: 'error',
    message: `Application Error: ${error.message}`,
    error: error.message,
    stack: error.stack,
    path: req ? req.loggablePath || safePath(req.path) : 'Unknown',
    method: req?.method || 'Unknown',
    clientId: getClientId(req?.ip || req?.socket?.remoteAddress),
    service: 'run-window-api',
    environment: process.env.NODE_ENV || 'development'
  };

  if (logtailToken) {
    sendToLogtail(errorData).catch(err => {
      console.error('Logtail error logging failed:', err.message);
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error('Error:', error);
  }
};

module.exports = {
  LOGGABLE_PATHS,
  loggingMiddleware,
  logError,
  sendToLogtail,
  getClientId
};
