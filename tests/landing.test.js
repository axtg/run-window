const fs = require('fs');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../app');
const { LOGGABLE_PATHS } = require('../middleware/logging');
const { PLAUSIBLE_SCRIPT } = require('../middleware/securityHeaders');

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

const SCRIPTS = ['/analytics.js', '/route.js', '/plan.js', '/strip.js', '/settings.js', '/app.js'];
const allScriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => match[0]);
const scriptPath = tag => (tag.match(/\ssrc="([^"?]*)(\?[^"]*)?"/) || [])[1];
// Plausible's file is the one script from elsewhere; the rest are the page's own.
const plausibleTags = allScriptTags.filter(tag => scriptPath(tag) === PLAUSIBLE_SCRIPT);
const scriptTags = allScriptTags.filter(tag => scriptPath(tag) !== PLAUSIBLE_SCRIPT);

test('the page loads same-origin scripts deferred and in order, Plausible async, and none inline', () => {
  expect(scriptTags.map(scriptPath)).toEqual(SCRIPTS);
  scriptTags.forEach(tag => {
    expect(tag).toMatch(/\ssrc="\/[^/]/);
    expect(tag).toMatch(/\sdefer\b/);
  });
  expect(plausibleTags).toHaveLength(1);
  expect(plausibleTags[0]).toMatch(/\sasync\b/);
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

test('the page loads nothing external but Plausible, and has no inline style', () => {
  const external = [...html.matchAll(/\s(?:src|srcset|data)=["']?((?:https?:)?\/\/[^"'\s>]*)/gi)].map(
    match => match[1]
  );
  expect(external).toEqual([PLAUSIBLE_SCRIPT]);
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
  expect(text).toContain('nothing goes there unless you open the link');
});

test('"Near you" is a map link that opens in a new tab without a referrer and has no address in the HTML', () => {
  const link = html.match(/<a\b[^>]*id="source-map"[^>]*>/)[0];
  expect(link).toContain('target="_blank"');
  expect(link).toContain('rel="noopener noreferrer"');
  expect(link).not.toContain('href='); // app.js sets it once the location is known
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

test('the header opens the Method, API and Privacy dialogs', () => {
  expect(html).toMatch(/<header\b[\s\S]*<button\b[^>]*id="open-method"[\s\S]*<\/header>/);
  expect(html).toMatch(/<header\b[\s\S]*<button\b[^>]*id="open-api"[\s\S]*<\/header>/);
  expect(html).toMatch(/<header\b[\s\S]*<button\b[^>]*id="open-privacy"[\s\S]*<\/header>/);
  expect([...html.matchAll(/<dialog\b/g)]).toHaveLength(3);
});

// The Method dialog restates the scoring in words: these checks fail when a constant changes and the text does not.
test('the Method dialog states the scoring constants the API uses', () => {
  const { SCORING } = require('../lib/windows');
  const { durationKey, windLine } = require('../public/plan');
  const { text } = dialogText('method-dialog');
  const wind = SCORING.wind;
  expect([wind.speedWeight, wind.gustWeight]).toEqual([1, 0.5]);
  expect(text).toContain(`1 point per km/h above ${wind.comfortableSpeed} km/h`);
  expect(text).toContain(`half a point per km/h of gusts above ${wind.comfortableGust}`);
  expect(SCORING.preferWeight).toBe(3);
  expect(text).toContain('count three times');
  expect(SCORING.temperature.weight).toBe(1);
  expect(text).toContain(`outside ${SCORING.temperature.min}–${SCORING.temperature.max} °C`);
  expect(text).toContain(`1 point per ${SCORING.rain.probDivisor} % chance of rain`);
  const middle = (SCORING.temperature.min + SCORING.temperature.max) / 2;
  expect(text).toContain(`closest to ${middle} °C feels-like`);
  expect(text).toContain(`every hour is under ${wind.comfortableSpeed} km/h`);
  expect(SCORING.rain.probDivisor / SCORING.fallbackRain.probDivisor).toBe(10);
  expect(text).toContain('ten times as much');
  expect(text).toContain('0.2 mm');
  expect(text).toContain('up to 3 hours');
  expect([durationKey(180).fits, durationKey(181).fits]).toEqual([true, false]);
  expect(text).toContain('under 10 km/h');
  expect(windLine(null, { windAvg: 9.9 })).toBe('Little wind');
  expect(windLine(null, { windAvg: 10, windFromCardinal: 'E' })).not.toBe('Little wind');
  // At 30 km/h wind alone outweighs a 100 % chance of rain, as the dialog claims.
  expect(30 - wind.comfortableSpeed).toBeGreaterThan(100 / SCORING.rain.probDivisor);
});

test('the API dialog holds the example request, the parameters, the capacity and the contract link', () => {
  const api = dialogText('api-dialog');
  expect(api.raw).toContain('/api/window?');
  expect(api.raw).toContain('lat=52.37&amp;lon=4.89');
  for (const name of ['lat', 'lon', 'avail', 'dark', 'rain', 'prefer', 'lang', 'slots'])
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
  for (const id of ['source-set', 'source-pick', 'duration-group', 'key-numbers']) {
    const tag = html.match(new RegExp(`<[a-z]+\\b[^>]*id="${id}"[^>]*>`));
    expect(tag[0]).toContain('[&[hidden]]:hidden');
  }
});

test('Copy API link carries a hidden SVG icon, not a glyph some fonts lack', () => {
  const button = html.match(/<button\b[^>]*id="copy-link"[^>]*>([\s\S]*?)<\/button>/);
  expect(button).not.toBeNull();
  expect(button[1]).not.toContain('⧉');
  expect(button[1]).toMatch(/<svg\b[^>]*aria-hidden="true"/);
});

test('Copy API link confirms on the button: a label, a hidden check icon and a polite hidden note', () => {
  const button = html.match(/<button\b[^>]*id="copy-link"[^>]*>([\s\S]*?)<\/button>/)[1];
  expect(button).toMatch(/<span\b[^>]*id="copy-label"[^>]*>\s*Copy API link\s*<\/span>/);
  expect(button).toMatch(/<svg\b[^>]*id="copy-icon"[^>]*aria-hidden="true"/);
  expect(button).toMatch(
    /<svg\b[^>]*id="copy-check"[^>]*aria-hidden="true"[^>]*hidden|<svg\b[^>]*id="copy-check"[^>]*hidden/
  );
  const note = html.match(/<span\b[^>]*id="copy-note"[^>]*>/);
  expect(note).not.toBeNull();
  expect(note[0]).toMatch(/class="sr-only"/);
  expect(note[0]).toMatch(/aria-live="polite"/);
});

test("the legend's dark swatch is the graph's dark shade", () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  const shade = app.match(/height: PLOT_HEIGHT, class: 'fill-(gray-\d+)' \}\)\);\n\s*\}\);/);
  expect(shade).not.toBeNull();
  expect(html).toMatch(new RegExp(`<span class="text-${shade[1]}">▮</span> dark`));
});

test('the Run row holds duration, distance and pace, with the run minutes under it', () => {
  expect(html).not.toContain('id="pace-row"');
  expect(html).not.toContain('id="duration-row"');
  expect(html).not.toContain('id="run-estimate"'); // no distance estimate without a route
  const row = html.match(/<div\b[^>]*id="run-row"[^>]*>([\s\S]*?)<p\b[^>]*id="run-minutes"/);
  expect(row).not.toBeNull();
  for (const id of ['duration-group', 'run-distance', 'pace-group', 'pace-down', 'pace-input', 'pace-up'])
    expect(row[1]).toContain(`id="${id}"`);
  // app.js hides the pace group without a route: the class must let [hidden] win over flex.
  expect(html.match(/<div\b[^>]*id="pace-group"[^>]*>/)[0]).toContain('[&[hidden]]:hidden');
});

test('the route name stays on one line, without the distance beside it', () => {
  expect(html).not.toContain('id="source-distance"');
  expect(html.match(/<span\b[^>]*id="source"[^>]*>/)[0]).toContain('truncate');
});

test("the compass arrow's tip stays clear of the N when it points north", () => {
  const north = html.match(/<text\b[^>]*\sy="([\d.]+)"[^>]*>N<\/text>/);
  const tip = html.match(/<g\b[^>]*id="wind-arrow"[^>]*>\s*<path\b[^>]*d="M14 ([\d.]+)/);
  expect(north).not.toBeNull();
  expect(tip).not.toBeNull();
  expect(Number(tip[1])).toBeGreaterThanOrEqual(Number(north[1]) + 1); // the N's baseline is its lowest point
});

test('Dark has its own row with the times and an OK switch; add hours is a round + button', () => {
  expect(text).not.toContain('add hours');
  const dark = html.match(/<div\b[^>]*>\s*<span\b[^>]*>Dark<\/span>([\s\S]*?)<\/button>/);
  expect(dark).not.toBeNull();
  expect(dark[1]).toContain('id="dark-times"');
  const toggle = dark[1].match(/<button\b[^>]*id="dark-ok"[^>]*>([\s\S]*)$/);
  expect(toggle).not.toBeNull();
  expect(toggle[0]).toMatch(/role="switch"/);
  expect(toggle[0]).toMatch(/aria-label="[^"]*dark[^"]*"/);
  expect(toggle[1].replace(/<[^>]+>/g, '').trim()).toBe('OK');
  const add = html.match(/<button\b[^>]*id="add-hours"[^>]*>([^<]*)<\/button>/);
  expect(add).not.toBeNull();
  expect(add[0]).toMatch(/aria-label="Add hours"/);
  expect(add[0]).toMatch(/disabled:/);
  expect(add[0]).toMatch(/\sw-6\s/); // the same width as the spacer that ends the other hours rows
  expect(add[1].trim()).toBe('+');
  expect(html).toMatch(/<div id="hours-rows">\s*<button\b[^>]*id="add-hours"/);
});

test('the answer puts the key numbers beside the time from sm up, and the wind line has a hidden compass', () => {
  const numbers = html.match(/<dl\b[^>]*id="key-numbers"[^>]*>/)[0];
  // Two auto columns: four minmax(0,1fr) ones in this shrink-to-fit list collapsed and overlapped (2026-11-07).
  expect(numbers).toMatch(/sm:grid-cols-\[repeat\(2,auto\)\]/);
  expect(numbers).toMatch(/sm:col-start-2/);
  expect(numbers).toMatch(/sm:justify-self-end/); // beside the time with its own gaps, not spread over the row
  expect(html).toMatch(/id="answer"[^>]*sm:grid-cols-\[auto_1fr\]/); // the left column takes the width it needs
  const time = html.match(/<p\b[^>]*id="answer-time"[^>]*>/)[0];
  expect(time).toMatch(/["\s]whitespace-nowrap["\s]/); // never "14:00–" / "14:45"
  const wind = html.match(/<p\b[^>]*id="wind-line"[^>]*>([\s\S]*?)<\/p>/);
  expect(wind).not.toBeNull();
  expect(wind[1]).toMatch(/<svg\b[^>]*id="wind-compass"[^>]*aria-hidden="true"/);
  expect(wind[1]).toMatch(/<g\b[^>]*id="wind-arrow"[^>]*transform="rotate\(0 14 14\)"/);
  expect(wind[1]).toContain('id="wind-text"');
});

test('the answer has a hidden Try tomorrow button with its hint', () => {
  const hint = html.match(/<div\b[^>]*id="tomorrow-hint"[^>]*>([\s\S]*?)<\/div>/);
  expect(hint).not.toBeNull();
  expect(hint[0]).toMatch(/\shidden\b/);
  const button = hint[1].match(/<button\b[^>]*id="try-tomorrow"[^>]*>([^<]*)<\/button>/);
  expect(button).not.toBeNull();
  expect(button[1].trim()).toBe('Try tomorrow →');
  expect(hint[1]).toContain('id="tomorrow-text"');
});

test('the pace field brings up a keyboard with a colon', () => {
  const pace = html.match(/<input\b[^>]*id="pace-input"[^>]*>/)[0];
  expect(pace).not.toMatch(/inputmode="(numeric|decimal)"/);
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

test('the page is served with a CSP that adds only Plausible and has no inline script hashes', async () => {
  const app = createApp({ weather: { getForecast: jest.fn(), stats: () => ({}) } });
  const response = await request(app).get('/').expect(200);
  const policy = response.headers['content-security-policy'];

  expect(policy).toContain(`script-src 'self' ${PLAUSIBLE_SCRIPT};`);
  expect(policy).toContain("style-src 'self';");
  expect(policy).toContain("connect-src 'self' https://plausible.io;");
  expect(policy).not.toContain('sha256-');
});

// The network menu names the maintainer's sites on purpose (2026-11-06); nothing else on the page does.
test('no names or places tied to the maintainer outside the network menu', () => {
  const menu = html.match(
    /<button\s+id="open-network"[\s\S]*?<\/button>|<div\s+id="network-menu"[\s\S]*?\n {6}<\/div>/g
  );
  expect(menu).toHaveLength(2);
  const rest = menu.reduce((page, part) => page.replace(part, ''), html);
  expect(rest).not.toMatch(/xander|xadi|groesbeek|buymeacoffee/i);
});
