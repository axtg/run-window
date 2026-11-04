const fs = require('fs');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../app');
const { LOGGABLE_PATHS } = require('../middleware/logging');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('landing page has an example request, the Open-Meteo attribution with a link, and the privacy text', () => {
  expect(html).toContain('/api/window?');
  expect(text).toContain('Open-Meteo.com');
  expect(html).toMatch(/<a\b[^>]*href="https:\/\/open-meteo\.com\/?"[^>]*>\s*Open-Meteo\.com/);
  expect(text).toContain('Authorization');
  expect(text).toContain('3 hours');
  expect(text).toContain('needs no token');
  expect(text).toContain('never read, logged or stored');
});

test('landing page example uses Amsterdam coordinates', () => {
  expect(html).toContain('lat=52.37&amp;lon=4.89');
});

test('landing page states what is received, kept and sent, and the capacity limit', () => {
  expect(text).toMatch(/2 decimals/);
  expect(text).toMatch(/1 decimal/);
  expect(text).toMatch(/salted hash/);
  expect(text).toMatch(/300 locations/);
  expect(text).toMatch(/503/);
  expect(text).toMatch(/Open-Meteo/);
});

test('landing page privacy text says no more than the code does', () => {
  expect(text).toContain('about 3 hours');
  expect(text).toContain('Data older than 3 hours is never served');
  expect(text).toContain('with the key kept only in memory and replaced daily, not written to disk or logs');
  expect(text).toContain('User-Agent');
  expect(text).toContain('Better Stack');
  expect(text).not.toMatch(/at most 3 hours|cannot be read back/);
});

test('landing page has no scripts and makes no external requests', () => {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\s(src|srcset|data)=["']?(https?:)?\/\//i);
  expect(html).not.toMatch(/<(link|img|iframe|object|embed|source|video|audio)\b[^>]*(https?:)?\/\/[^>]*>/i);
  expect(html).not.toMatch(/<style|style=/i);
  expect(html).not.toMatch(/@import|url\(/i);
});

test('the only stylesheet is /tailwind.css, which the logger allows', async () => {
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]);

  expect(stylesheets).toHaveLength(1);
  expect(stylesheets[0]).toContain('href="/tailwind.css"');
  expect(LOGGABLE_PATHS.has('/tailwind.css')).toBe(true);
  expect(fs.existsSync(path.join(PUBLIC, 'tailwind.css'))).toBe(true);

  const app = createApp({ weather: { getForecast: jest.fn(), stats: () => ({}) } });
  await request(app).get('/tailwind.css').expect(200).expect('Content-Type', /css/);
});

test('the page is served with the CSP unchanged and no inline script hashes', async () => {
  const app = createApp({ weather: { getForecast: jest.fn(), stats: () => ({}) } });
  const response = await request(app).get('/').expect(200);
  const policy = response.headers['content-security-policy'];

  expect(policy).toContain("script-src 'self';");
  expect(policy).toContain("style-src 'self';");
  expect(policy).toContain("connect-src 'self';");
});

test('no names or places tied to the maintainer', () => {
  expect(html).not.toMatch(/xander|xadi|xadi\.nl/i);
});
