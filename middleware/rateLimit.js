const DEFAULT_LIMIT = 20;

function parseRateLimit(raw) {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  if (!/^[1-9]\d*$/.test(raw)) {
    console.warn(`⚠️  Invalid rate limit '${raw}', using ${DEFAULT_LIMIT} requests per second`);
    return DEFAULT_LIMIT;
  }
  return Number(raw);
}

// Fixed-window limiter per client address. Relies on req.ip, so `trust proxy` must match the deployment.
function createRateLimiter({ limit, windowMs = 1000, buckets = new Map() }) {
  let lastSweep = Date.now();

  return function rateLimiter(req, res, next) {
    const ip = req.ip || 'unknown';
    const now = Date.now();

    // Drop expired buckets so the map only holds clients seen in the current window.
    if (now - lastSweep >= windowMs) {
      for (const [key, entry] of buckets) {
        if (now - entry.windowStart >= windowMs) buckets.delete(key);
      }
      lastSweep = now;
    }

    let bucket = buckets.get(ip);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(limit - bucket.count, 0);
    const resetUnixSeconds = Math.ceil((bucket.windowStart + windowMs) / 1000);

    res.set({
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(resetUnixSeconds)
    });

    if (bucket.count > limit) {
      res.set('Retry-After', '1');
      return res.status(429).json({
        status: 'error',
        message: 'Rate limit exceeded. Try again later.',
        limitPerSecond: limit
      });
    }
    return next();
  };
}

module.exports = { createRateLimiter, parseRateLimit };
