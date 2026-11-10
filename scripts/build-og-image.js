// Writes public/og.png (1200 × 630), the picture a link to besttimetorun.com shows when shared. It draws the card below
// in a headless Chromium and screenshots it. Playwright is not a dependency of this repo: run it where Playwright and
// its Chromium are installed, with `node scripts/build-og-image.js`. The output is committed.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'public', 'og.png');
const ICON = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg'), 'utf8');

// The page's "dry and mild" tint, a white card with a sample answer, and the strip's greens.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1200px; height: 630px; font-family: Inter, 'Segoe UI', system-ui, sans-serif; color: #111827;
    background: linear-gradient(180deg, #cfe8ff 0%, #e3f6ec 60%, #f3f4f6 100%); display: flex; align-items: center; }
  .wrap { display: flex; align-items: center; gap: 56px; padding: 0 80px; }
  .brand { display: flex; align-items: center; gap: 20px; font-size: 40px; font-weight: 700; }
  .brand svg { width: 72px; height: 72px; }
  .brand b span { color: #6b7280; font-weight: 500; }
  h1 { font-size: 64px; line-height: 1.05; margin: 36px 0 20px; letter-spacing: -0.02em; }
  p { font-size: 28px; color: #374151; margin: 0; max-width: 560px; line-height: 1.35; }
  .card { background: #fff; border-radius: 28px; padding: 36px 40px; width: 400px; flex: none;
    box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 24px 48px rgba(17,24,39,.12); }
  .label { font-size: 20px; color: #6b7280; }
  .time { font-size: 58px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 20px; white-space: nowrap; }
  .nums { display: flex; gap: 28px; font-size: 26px; font-weight: 600; }
  .nums small { display: block; font-size: 16px; font-weight: 400; color: #6b7280; }
  .strip { display: grid; grid-template-columns: repeat(12, 1fr); height: 26px; border-radius: 6px; overflow: hidden;
    margin-top: 28px; }
</style></head><body><div class="wrap">
  <div>
    <div class="brand">${ICON}<b>besttimetorun<span>.com</span></b></div>
    <h1>The best time<br>to run today</h1>
    <p>Your hours, your route or location: the driest, calmest window, and which way to start into the wind.</p>
  </div>
  <div class="card">
    <div class="label">Best time · 60 min</div>
    <div class="time">12:00–13:00</div>
    <div class="nums"><div><small>Sky</small>Dry</div><div><small>Feels</small>9 °C</div>
      <div><small>Wind</small>7 km/h</div></div>
    <div class="strip">${[
      '#dcfce7',
      '#bbf7d0',
      '#86efac',
      '#4ade80',
      '#16a34a',
      '#166534',
      '#166534',
      '#15803d',
      '#22c55e',
      '#86efac',
      '#bbf7d0',
      '#e5e7eb'
    ]
      .map(c => `<div style="background:${c}"></div>`)
      .join('')}</div>
  </div>
</div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(HTML);
  await page.screenshot({ path: OUT });
  await browser.close();
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
})();
