const fs = require('fs');
const path = require('path');
const { renderFull } = require('./harness');
const { board, MINUTE, NOW } = require('./boardCases');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'integrations', 'trmnl-running-board', 'full.liquid');
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
const EMPTY_LIST = key => ({ _embedded: { [key]: [] } });
// Ruby Liquid escapes " as &quot;, liquidjs as &#34;
const QUOTE = '(?:&quot;|&#34;)';

const rows = html => html.match(/<div class="rb-day(?: [^"]*)?"/g) || [];
const textOf = html =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

async function rendered(options, overrides, now) {
  const { output } = await board(options, overrides, now);
  return { output, html: await renderFull(output) };
}

describe('full.liquid: normal case', () => {
  let output;
  let html;

  beforeAll(async () => {
    ({ output, html } = await rendered());
  });

  it('shows seven rows, Monday first, with today inverted', () => {
    expect(rows(html)).toHaveLength(7);
    const labels = [...html.matchAll(/<span class="rb-day__label">([^<]*)<\/span>/g)].map(match => match[1]);
    expect(labels).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    const today = rows(html).findIndex(row => row.includes('rb-day--today'));
    expect(today).toBe(2);
    expect(rows(html).filter(row => row.includes('rb-day--today'))).toHaveLength(1);
  });

  it('shows the week, the form and the run window', () => {
    const text = textOf(html);
    expect(text).toContain('WEEK 45');
    expect(text).toContain(output.week.footer);
    expect(text).toContain('+1');
    expect(text).toContain('Form (est.)');
    expect(text).toContain(output.form.today);
    expect(text).toContain('6 weeks back');
    expect(text).toContain('7 days ahead');
    expect(text).toContain('TOMORROW · 60 min');
    for (const line of output.run.lines) expect(text).toContain(line);
  });

  it('prints the attribution and the data time', () => {
    const text = textOf(html);
    expect(text).toContain('Synthetic Garmin attribution text · Weather data by Open-Meteo.com');
    expect(text).toContain('data We 12:00');
  });

  it('draws the form graph from the precomputed paths', () => {
    expect(html).toContain('viewBox="0 0 360 150"');
    expect(html).toContain(`d="${output.form.pastPath}"`);
    expect(html).toContain(`d="${output.form.futurePath}"`);
    expect(html).toMatch(/<path class="rb-past"[^>]*stroke-width="3"/);
    expect(html).toMatch(/<path class="rb-future"[^>]*stroke-dasharray=/);
    expect(html).toContain(`y1="${output.form.zeroY}" x2="360" y2="${output.form.zeroY}"`);
    expect(html).toContain(`x1="${output.form.todayX}"`);
  });

  it('shows "—" for a day with no items', () => {
    const friday = html.slice(html.indexOf('>Fr<'), html.indexOf('>Sa<'));
    expect(friday).toContain('—');
  });

  it('shows hostile titles as plain text (Review Focus 1)', () => {
    expect(html).toContain('&lt;/script&gt;&lt;b&gt;');
    expect(html).toMatch(new RegExp(`&lt;b&gt;${QUOTE}x${QUOTE}&lt;/b&gt;`));
    expect(html).toContain('{{ x }}');
    expect(html).toContain('{% raw %}');
    expect(html).toContain('🏃');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('<b>');
  });

  it('has no NaN, undefined or null text', () => {
    expect(textOf(html)).not.toMatch(/\b(NaN|undefined|null)\b/);
  });
});

describe('full.liquid: attribution', () => {
  it('prints a long attribution in full and never clips it', async () => {
    const { output } = await board();
    const notice = 'Garmin and the Garmin logo are trademarks of Garmin Ltd. or its subsidiaries; via Garmin Connect';
    const garmin = [`${notice} for device A`, `${notice} for device B`];
    const attribution = [...garmin, 'Weather data by Open-Meteo.com'].join(' · ');
    const html = await renderFull({ ...output, week: { ...output.week, garmin }, attribution });
    expect(textOf(html)).toContain(attribution);
    expect(textOf(html)).toContain('data We 12:00');

    const rule = template.match(/\.rb-foot__source\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).not.toMatch(/nowrap|ellipsis|overflow\s*:\s*hidden/);
  });
});

describe('full.liquid: template rules', () => {
  it('escapes every printed value except the validated SVG data', () => {
    const allowed = ['form.pastPath', 'form.futurePath', 'form.zeroY', 'form.todayX'];
    const tags = [...template.matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)].map(match => match[1]);
    expect(tags.length).toBeGreaterThan(10);
    const unescaped = tags.filter(tag => !/\|\s*escape$/.test(tag) && !allowed.includes(tag));
    expect(unescaped).toEqual([]);
  });

  it('has no script and no colour other than black and white', () => {
    expect(template).not.toMatch(/<script/i);
    const hexes = template.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    for (const hex of hexes) expect(['#000', '#fff', '#000000', '#ffffff']).toContain(hex.toLowerCase());
    expect(template).not.toMatch(/\b(rgba?|hsla?)\(/i);
    const values = [...template.matchAll(/(?:color|background|fill|stroke)\s*[:=]\s*"?([#\w]+)/gi)].map(m => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(['#000', '#fff', 'none', 'transparent']).toContain(value.toLowerCase());
    expect(template).not.toMatch(/gr[ae]y/i);
  });

  it('stays under 100 KB', () => {
    expect(Buffer.byteLength(template)).toBeLessThanOrEqual(100 * 1024);
  });
});

describe('full.liquid: Tredict states', () => {
  it.each([
    ['auth', { plan: 401 }, /Tredict token paused or invalid/],
    ['payment', { efforts: 402 }, /Tredict says this account can(?:'|&#39;|&#x27;|&apos;)t use the API\./],
    ['unavailable', { efforts: 503 }, /Tredict unavailable/]
  ])('%s: shows the message instead of the week and graph, keeps the run window', async (state, overrides, message) => {
    const { output, html } = await rendered({ previous: null }, overrides);
    expect(output.tredict.state).toBe(state);
    const text = textOf(html);
    expect(text).toMatch(message);
    expect(html).not.toContain('<svg');
    expect(rows(html)).toHaveLength(0);
    expect(text).toContain(output.run.heading);
    expect(text).toContain(output.run.lines[0]);
    expect(text).toContain('Open-Meteo');
    expect(text).not.toMatch(/\b(NaN|undefined|null)\b/);
  });

  it('stale: shows the panels plus the message', async () => {
    const first = (await board({}, {}, NOW - 2 * 60 * MINUTE)).output;
    const { output, html } = await rendered({ previous: first }, { efforts: 503 });
    expect(output.tredict.state).toBe('stale');
    const text = textOf(html);
    expect(text).toContain('Tredict data from We 10:00');
    expect(rows(html)).toHaveLength(7);
    expect(html).toContain('<svg');
    expect(text).toContain('WEEK 45');
    expect(text).toContain(output.run.lines[0]);
  });
});

describe('full.liquid: empty and broken outputs (Review Focus 4)', () => {
  it('shows empty states for a new account', async () => {
    const { output, html } = await rendered(
      { previous: null },
      {
        plan: EMPTY_LIST('plannedWorkoutList'),
        activities: EMPTY_LIST('activityList'),
        efforts: { trainingEfforts: { x: [] } }
      }
    );
    expect(output.form.empty).toBe('No training data yet');
    const text = textOf(html);
    expect(text).toContain('No training data yet');
    expect(html).not.toContain('<svg');
    expect(rows(html)).toHaveLength(7);
    expect(text.match(/—/g).length).toBeGreaterThanOrEqual(7);
    expect(text).not.toMatch(/\b(NaN|undefined|null)\b/);
  });

  it('renders the fixed error output without lang, week, form or data time', async () => {
    const output = {
      v: 1,
      fetchedAt: '2026-11-04T11:00:00.000Z',
      fetchedAtText: '',
      tredict: { state: 'unavailable', message: 'Tredict unavailable' },
      tredictAt: null,
      tredictAtText: '',
      week: null,
      form: null,
      run: { kind: 'error', heading: 'Weather unavailable', lines: [] },
      weatherRetryAt: null,
      attribution: ''
    };
    const html = await renderFull(output);
    const text = textOf(html);
    expect(text).toContain('Tredict unavailable');
    expect(text).toContain('Weather unavailable');
    expect(text).not.toMatch(/\bdata\b/);
    expect(text).not.toMatch(/\b(NaN|undefined|null)\b/);
  });

  it('renders an empty object without breaking', async () => {
    const text = textOf(await renderFull({}));
    expect(text).not.toMatch(/\b(NaN|undefined|null)\b/);
  });

  it('prints "data" and the time when fetchedAtText is set on an error output', async () => {
    const text = textOf(await renderFull({ fetchedAtText: 'We 11:00', run: { heading: 'Weather unavailable' } }));
    expect(text).toContain('data We 11:00');
  });
});

describe('full.liquid: Dutch', () => {
  it('shows the Dutch text', async () => {
    const { html } = await rendered({ user: { time_zone_iana: 'Europe/Amsterdam', locale: 'nl-NL' } });
    const text = textOf(html);
    expect(text).toContain('Vorm (schatting)');
    expect(text).toContain('MORGEN · 60 min');
    expect(text).toContain('data wo 12:00');
    expect(text).toContain('droog');
    expect(text).toContain('6 weken terug');
  });
});
