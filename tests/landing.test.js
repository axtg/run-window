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

const SCRIPTS = ['/route.js', '/plan.js', '/strip.js', '/settings.js', '/app.js'];
const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => match[0]);
const scriptPath = tag => (tag.match(/\ssrc="([^"?]*)(\?[^"]*)?"/) || [])[1];

test('the page loads only same-origin external scripts, deferred, in order, and none inline', () => {
  expect(scriptTags.map(scriptPath)).toEqual(SCRIPTS);
  scriptTags.forEach(tag => {
    expect(tag).toMatch(/\ssrc="\/[^/]/);
    expect(tag).toMatch(/\sdefer\b/);
  });
  expect(html).not.toMatch(/<script\b(?![^>]*\ssrc=)[^>]*>/i);
  expect(html).not.toMatch(/<script\b[^>]*>[^<]+<\/script>/i);
});

test('every script path is logged by name and served as JavaScript', async () => {
  const app = createApp({ weather: { getForecast: jest.fn(), stats: () => ({}) } });
  for (const script of SCRIPTS) {
    expect(LOGGABLE_PATHS.has(script)).toBe(true);
    await request(app)
      .get(script)
      .expect(200)
      .expect('Content-Type', /javascript/);
  }
});

test('the page makes no external requests and has no inline style', () => {
  expect(html).not.toMatch(/\s(src|srcset|data)=["']?(https?:)?\/\//i);
  expect(html).not.toMatch(/<(link|img|iframe|object|embed|source|video|audio)\b[^>]*(https?:)?\/\/[^>]*>/i);
  expect(html).not.toMatch(/<style|style=/i);
  expect(html).not.toMatch(/@import|url\(/i);
});

test('privacy text says the route file stays in the browser and the location is rounded', () => {
  expect(text).toContain('read in your browser');
  expect(text).toContain('never sent');
  expect(text).toContain('waits briefly in your browser');
  expect(text).toContain('deleted as soon as the page opens it');
  expect(text).toContain('rounded to 2 decimals before');
});

test('the page has a route file input for GPX and KML and a polite status line', () => {
  const input = html.match(/<input\b[^>]*id="route-input"[^>]*>/);
  expect(input).not.toBeNull();
  expect(input[0]).toMatch(/type="file"/);
  const accept = input[0].match(/accept="([^"]*)"/)[1];
  expect(accept).toContain('.gpx');
  expect(accept).toContain('.kml');
  expect(html).toMatch(/<[^>]*id="status"[^>]*aria-live="polite"|<[^>]*aria-live="polite"[^>]*id="status"/);
  const tapLine = html.match(/<p\b[^>]*id="tap-line"[^>]*>/);
  expect(tapLine).not.toBeNull();
  expect(tapLine[0]).toMatch(/aria-live="polite"/);
});

// The API example and the privacy text live in two <dialog>s opened from the header.
function dialogText(id) {
  const match = html.match(new RegExp(`<dialog\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</dialog>`));
  expect(match).not.toBeNull();
  return { raw: match[1], text: match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
}

test('the header opens the API and Privacy dialogs', () => {
  expect(html).toMatch(/<header\b[\s\S]*<button\b[^>]*id="open-api"[\s\S]*<\/header>/);
  expect(html).toMatch(/<header\b[\s\S]*<button\b[^>]*id="open-privacy"[\s\S]*<\/header>/);
  expect([...html.matchAll(/<dialog\b/g)]).toHaveLength(2);
});

test('the API dialog holds the example request, the parameters, the capacity and the contract link', () => {
  const api = dialogText('api-dialog');
  expect(api.raw).toContain('/api/window?');
  expect(api.raw).toContain('lat=52.37&amp;lon=4.89');
  for (const name of ['lat', 'lon', 'avail', 'dark', 'rain', 'lang', 'slots'])
    expect(api.raw).toContain(`<code>${name}</code>`);
  expect(api.text).toMatch(/300 locations/);
  expect(api.text).toMatch(/503/);
  expect(api.raw).toMatch(/href="\/openapi\.yaml"/);
});

test('the privacy dialog holds every privacy statement', () => {
  const privacy = dialogText('privacy-dialog').text;
  for (const phrase of [
    'read in your browser',
    'never sent',
    'waits briefly in your browser',
    'deleted as soon as the page opens it',
    'rounded to 2 decimals before',
    'Authorization',
    'about 3 hours',
    'Data older than 3 hours is never served',
    'needs no token',
    'never read, logged or stored',
    'with the key kept only in memory and replaced daily, not written to disk or logs',
    'salted hash',
    '1 decimal',
    'User-Agent',
    'Better Stack'
  ]) {
    expect(privacy).toContain(phrase);
  }
});

test('the settings are in place, each control labelled', () => {
  for (const id of ['pace-input', 'pace-up', 'pace-down', 'hours-rows', 'add-hours', 'clear-source', 'use-location']) {
    expect(html).toContain(`id="${id}"`);
  }
  const dark = html.match(/<button\b[^>]*id="dark-ok"[^>]*>/);
  expect(dark).not.toBeNull();
  expect(dark[0]).toMatch(/role="switch"/);
  expect(dark[0]).toMatch(/aria-checked="false"/);
  const rain = html.match(/<input\b[^>]*id="rain-input"[^>]*>/);
  expect(rain).not.toBeNull();
  expect(rain[0]).toMatch(/type="range"/);
  expect(html).toMatch(/<label\b[^>]*for="rain-input"/);
  expect(html).toMatch(/<label\b[^>]*for="pace-input"/);
  expect(html).toMatch(/<svg\b[^>]*id="timeline"[^>]*>/);
});

test('an element with a display class still hides with the hidden attribute', () => {
  // Tailwind's display classes outrank the browser's [hidden] rule, so they need the [&[hidden]]:hidden variant.
  const tags = [...html.matchAll(/<[a-z]+\b[^>]*\shidden\b[^>]*>/g)].map(match => match[0]);
  for (const tag of tags) {
    const classes = (tag.match(/class="([^"]*)"/) || [])[1] || '';
    if (/(^|\s)(flex|inline-flex|grid|block|inline-block)(\s|$)/.test(classes))
      expect(classes).toContain('[&[hidden]]:hidden');
  }
  for (const id of ['source-set', 'source-pick', 'pace-row', 'duration-row', 'key-numbers']) {
    const tag = html.match(new RegExp(`<[a-z]+\\b[^>]*id="${id}"[^>]*>`));
    expect(tag[0]).toContain('[&[hidden]]:hidden');
  }
});

test('the one-off duration and the chips are gone', () => {
  expect(html).not.toContain('oneoff-input');
  expect(html).not.toMatch(/id="chip-/);
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
