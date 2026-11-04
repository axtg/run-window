const fs = require('fs');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../app');
const { LOGGABLE_PATHS } = require('../middleware/logging');
const { SHARE_PATH, SHARE_FIELD } = require('../public/sw');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const app = createApp({ weather: { getForecast: jest.fn(), stats: jest.fn() } });

// Width and height from a PNG's IHDR chunk, after checking the signature.
function pngSize(buffer) {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(buffer.toString('latin1', 12, 16)).toBe('IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('web app manifest', () => {
  let manifest;

  beforeAll(async () => {
    const response = await request(app)
      .get('/manifest.webmanifest')
      .expect(200)
      .expect('Content-Type', /^application\/manifest\+json/);
    manifest = JSON.parse(response.text);
  });

  test('installs as a standalone app scoped to the page', () => {
    expect(manifest.name).toBe('Run window');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  test('lists the page in the share sheet for route files, posting to the worker path and form field', () => {
    expect(manifest.share_target).toEqual({
      action: SHARE_PATH,
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        files: [
          {
            name: SHARE_FIELD,
            accept: [
              'application/gpx+xml',
              'application/vnd.google-earth.kml+xml',
              'application/xml',
              'text/xml',
              'application/octet-stream',
              '.gpx',
              '.kml'
            ]
          }
        ]
      }
    });
    expect(manifest.share_target.action).toBe('/share-target');
    expect(manifest.share_target.params.files[0].name).toBe('route');
  });

  test('lists same-origin 192 and 512 PNG icons whose files have those sizes, and the SVG icon', async () => {
    const pngs = manifest.icons.filter(icon => icon.type === 'image/png');
    expect(pngs.map(icon => icon.sizes).sort()).toEqual(['192x192', '512x512']);
    for (const icon of pngs) {
      expect(icon.src).toMatch(/^\/[a-z0-9-]+\.png$/);
      const response = await request(app).get(icon.src).expect(200).expect('Content-Type', 'image/png');
      const size = Number(icon.sizes.split('x')[0]);
      expect(pngSize(response.body)).toEqual({ width: size, height: size });
    }
    expect(manifest.icons.some(icon => icon.src === '/icon.svg' && icon.type === 'image/svg+xml')).toBe(true);
  });

  test('every icon and the manifest are logged by name', () => {
    expect(LOGGABLE_PATHS.has('/manifest.webmanifest')).toBe(true);
    manifest.icons.forEach(icon => expect(LOGGABLE_PATHS.has(icon.src)).toBe(true));
  });
});

describe('the page links the manifest, icon and theme colour', () => {
  test('in its head, same-origin', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
    expect(html).toMatch(/<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml" \/>/);
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-fA-F]{6}" \/>/);
  });

  test('the SVG icon is served as SVG and draws no external resource', async () => {
    const response = await request(app)
      .get('/icon.svg')
      .expect(200)
      .expect('Content-Type', /^image\/svg\+xml/);
    const text = response.body.toString('utf8'); // supertest buffers image types
    expect(text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(text).not.toMatch(/href=|<script|<style/i);
  });

  test('the worker is served as JavaScript from the root, so its scope is the whole page', async () => {
    await request(app)
      .get('/sw.js')
      .expect(200)
      .expect('Content-Type', /javascript/);
    expect(LOGGABLE_PATHS.has('/sw.js')).toBe(true);
  });
});
