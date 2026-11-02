const express = require('express');
const request = require('supertest');

const { createRateLimiter, parseRateLimit } = require('../middleware/rateLimit');

function appWithLimiter(options) {
  const limited = express();
  limited.use(createRateLimiter(options));
  limited.get('/', (req, res) => res.json({ ok: true }));
  return limited;
}

describe('Rate limiter', () => {
  describe('client identification behind nginx', () => {
    // nginx appends the address it saw, so only the rightmost X-Forwarded-For entry is trustworthy.
    function proxiedApp() {
      const app = appWithLimiter({ limit: 20 });
      app.set('trust proxy', 'loopback');
      return app;
    }

    test('changing the client-supplied X-Forwarded-For entries does not give a new allowance', async () => {
      const app = proxiedApp();
      const first = await request(app).get('/').set('X-Forwarded-For', '198.51.100.1, 203.0.113.10');
      const second = await request(app).get('/').set('X-Forwarded-For', '198.51.100.2, 203.0.113.10');

      expect(Number(second.headers['x-ratelimit-remaining'])).toBe(Number(first.headers['x-ratelimit-remaining']) - 1);
    });

    test('clients with different addresses have separate allowances', async () => {
      const app = proxiedApp();
      await request(app).get('/').set('X-Forwarded-For', '203.0.113.20');
      const other = await request(app).get('/').set('X-Forwarded-For', '203.0.113.21');

      expect(other.headers['x-ratelimit-remaining']).toBe('19');
    });
  });

  describe('enforcement', () => {
    let now;

    beforeEach(() => {
      now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('allows requests up to the limit and rejects the next one with 429', async () => {
      const limited = appWithLimiter({ limit: 2 });

      await request(limited).get('/').expect(200);
      const last = await request(limited).get('/').expect(200);
      const rejected = await request(limited).get('/').expect(429);

      expect(last.headers['x-ratelimit-remaining']).toBe('0');
      expect(rejected.headers['retry-after']).toBe('1');
      expect(rejected.body).toMatchObject({ status: 'error', limitPerSecond: 2 });
    });

    test('allows requests again once the window has passed', async () => {
      const limited = appWithLimiter({ limit: 1 });

      await request(limited).get('/').expect(200);
      await request(limited).get('/').expect(429);
      now += 1000;
      await request(limited).get('/').expect(200);
    });

    test('removes buckets of clients whose window has passed', async () => {
      const buckets = new Map();
      const limited = express();
      limited.set('trust proxy', 1);
      limited.use(createRateLimiter({ limit: 5, buckets }));
      limited.get('/', (req, res) => res.json({ ok: true }));

      await request(limited).get('/').set('X-Forwarded-For', '203.0.113.40');
      await request(limited).get('/').set('X-Forwarded-For', '203.0.113.41');
      expect(buckets.size).toBe(2);

      now += 1000;
      await request(limited).get('/').set('X-Forwarded-For', '203.0.113.42');

      expect([...buckets.keys()]).toEqual(['203.0.113.42']);
    });
  });

  describe('parseRateLimit', () => {
    test.each([
      ['25', 25],
      ['1', 1]
    ])('accepts %s', (raw, expected) => {
      expect(parseRateLimit(raw)).toBe(expected);
    });

    test('default limit is 20', () => expect(parseRateLimit(undefined)).toBe(20));

    test.each([undefined, '', 'abc', '10abc', '0', '-5', '1.5'])('falls back to 20 for %s', raw => {
      expect(parseRateLimit(raw)).toBe(20);
    });
  });
});
