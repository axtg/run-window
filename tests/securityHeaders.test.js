const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../app');
const { buildContentSecurityPolicy } = require('../middleware/securityHeaders');

const sha256 = source => `'sha256-${crypto.createHash('sha256').update(source).digest('base64')}'`;
const directive = (policy, name) => policy.split('; ').find(part => part.startsWith(`${name} `));

describe('buildContentSecurityPolicy', () => {
  test('allows inline scripts by hash, with their exact whitespace', () => {
    const inline = '\n      window.a = 1;\n    ';

    expect(directive(buildContentSecurityPolicy(`<script>${inline}</script>`), 'script-src')).toContain(sha256(inline));
  });

  test('ignores scripts that load a file and data blocks that never run', () => {
    const html = `
      <script src="/app.js" defer></script>
      <script async src="https://plausible.io/js/x.js"></script>
      <script type="application/ld+json">{"a":1}</script>`;

    expect(directive(buildContentSecurityPolicy(html), 'script-src')).not.toContain('sha256-');
  });
});

describe('security headers', () => {
  const app = createApp({ weather: { getForecast: jest.fn(), stats: () => ({}) } });

  test.each(['/', '/api/window', '/health', '/nope'])('%s carries them', async url => {
    const { headers } = await request(app).get(url);

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['permissions-policy']).toBe('geolocation=(self), camera=(), microphone=(), payment=(), usb=()');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('the policy is enforced', async () => {
    const { headers } = await request(app).get('/');

    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['content-security-policy-report-only']).toBeUndefined();
  });

  test('script sources do not allow arbitrary inline scripts', async () => {
    const { headers } = await request(app).get('/');

    expect(directive(headers['content-security-policy'], 'script-src')).not.toContain("'unsafe-inline'");
  });

  test('allows every inline script in the served page', async () => {
    const { headers, text } = await request(app).get('/');
    const inline = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);

    inline.forEach(source =>
      expect(directive(headers['content-security-policy'], 'script-src')).toContain(sha256(source))
    );
  });

  test('allows no inline styles', async () => {
    const { headers } = await request(app).get('/');

    expect(directive(headers['content-security-policy'], 'style-src')).toBe("style-src 'self'");
  });
});

describe('CORS', () => {
  test('a preflight only advertises the methods the API has', async () => {
    const app = createApp({ weather: { getForecast: jest.fn(), stats: () => ({}) } });
    const { headers } = await request(app)
      .options('/api/window')
      .set('Origin', 'https://example.com')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toBe('GET,HEAD');
  });
});
