const { LAYOUTS, layoutTemplate, renderLayout, renderFull } = require('./harness');
const { board, MINUTE, NOW } = require('./boardCases');
const { EMPTY_ACCOUNT_OVERRIDES, ERROR_OUTPUT, STATE_CASES, longAttributionOutput } = require('./renderCases');

// What TRMNL renders for the full layout: shared.liquid, then full.liquid
const template = layoutTemplate('full');
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
    const labels = [...html.matchAll(/<span class="rb-day__label[^"]*">([^<]*)<\/span>/g)].map(match => match[1]);
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
    expect(text).toContain('Form');
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
    expect(html).toMatch(/<span class="rb-form__today[^"]*" style="left: [\d.]+%">today<\/span>/);
    expect(html).not.toContain('<text');
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

describe('full.liquid: day rows', () => {
  it('keeps the day label apart from its first item whatever the label width', () => {
    const rule = template.match(/\.rb-day__label\s*\{([^}]*)\}/)[1];
    expect(rule).toMatch(/min-width:\s*42px/);
    expect(rule).toMatch(/flex:\s*0 0 auto/);
    expect(rule).toMatch(/padding-right:\s*6px/);
    expect(rule).not.toMatch(/(^|[^-])width:\s*42px/);
  });
});

describe('full.liquid: theme', () => {
  it('marks the board dark only for the dark theme', async () => {
    expect((await rendered({ fields: { theme: 'dark' } })).html).toContain('<div class="rb rb--dark">');
    expect((await rendered()).html).toContain('<div class="rb">');
  });

  it("inverts the board in TRMNL's dark mode, or for the dark theme outside it, never twice", () => {
    expect(template).toMatch(
      /\.screen--dark-mode \.rb, \.screen:not\(\.screen--dark-mode\) \.rb--dark \{ filter: invert\(1\); \}/
    );
  });
});

describe('full.liquid: intensity bar', () => {
  it('draws the bar, its labels and yields the graph height', async () => {
    const { output, html } = await rendered();
    const { intensity } = output;
    expect(intensity).not.toBeNull();
    expect(textOf(html)).toContain(intensity.heading);
    expect(html.match(/<pattern/g)).toHaveLength(1);
    expect(html).toContain('viewBox="0 0 360 22"');
    for (const { x, width } of intensity.segments)
      expect(html).toMatch(new RegExp(`<rect[^>]*x="${x}"[^>]*width="${width}"`));
    const bar = html.slice(html.indexOf('<div class="rb-intensity__heading '));
    const spans = [
      ...bar.slice(bar.indexOf('<div class="rb-intensity__labels"')).matchAll(/<span[^>]*>([^<]*)<\/span>/g)
    ].map(m => m[1]);
    expect(spans.slice(0, 3)).toEqual(intensity.labels);
    expect(html).toContain('rb-form--intensity');
    expect(html).toMatch(/vector-effect="non-scaling-stroke"[^>]*>|<rect[^>]*vector-effect="non-scaling-stroke"/);
  });

  it('stretches the graph to the column width and lets it fill the height the bar leaves, at least 84px', async () => {
    const { html } = await rendered();
    expect(html).toMatch(/<svg class="rb-form__graph" viewBox="0 0 360 150" preserveAspectRatio="none"/);
    expect(template).toMatch(
      /\.rb-form--intensity \.rb-form__graphbox\s*\{[^}]*flex:\s*1 1 84px;[^}]*min-height:\s*84px/
    );
    expect(template).toMatch(
      /\.rb-form--intensity svg\.rb-form__graph\s*\{[^}]*position:\s*absolute;[^}]*height:\s*100%/
    );
  });

  it('centres the 2px stripe in its tile', async () => {
    const { html } = await rendered();
    expect(html).toMatch(/<line x1="1" y1="0" x2="1" y2="4" stroke="#000" stroke-width="2"/);
  });

  it('makes the pattern id unique per render', () => {
    expect(template).toMatch(/append_random/);
  });

  it('draws no bar without intensity', async () => {
    const { output } = await board();
    const html = await renderFull({ ...output, intensity: null });
    const body = html.slice(html.indexOf('</style>'));
    expect(body).not.toContain('rb-intensity');
    expect(body).not.toContain('rb-form--intensity');
    expect(html).not.toContain('<pattern');
  });

  it('escapes the heading and labels', async () => {
    const { output } = await board();
    const intensity = { ...output.intensity, heading: '<b>x</b>', labels: ['<i>a</i>', 'b', 'c'] };
    const html = await renderFull({ ...output, intensity });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('&lt;i&gt;a&lt;/i&gt;');
    expect(html).not.toContain('<b>x');
  });

  it('prints segment geometry as numbers only', async () => {
    const { output } = await board();
    const segments = [{ kind: 'high', x: '"><script>', width: '1" onload="x' }];
    const html = await renderFull({ ...output, intensity: { ...output.intensity, segments } });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('onload');
  });
});

describe('full.liquid: attribution', () => {
  it('prints a long attribution in full and never clips it', async () => {
    const output = await longAttributionOutput();
    const { attribution } = output;
    const html = await renderFull(output);
    expect(textOf(html)).toContain(attribution);
    expect(textOf(html)).toContain('data We 12:00');

    const rule = template.match(/\.rb-foot__source\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).not.toMatch(/nowrap|ellipsis|overflow\s*:\s*hidden/);
  });
});

describe('full.liquid: layout', () => {
  const ruleOf = name => {
    const rule = template.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`));
    return rule ? rule[1] : '';
  };

  it.each(['rb-main', 'rb-right'])('lets .%s shrink and clip, so the footer keeps its space', name => {
    expect(ruleOf(name)).toMatch(/min-height:\s*0\b/);
    expect(ruleOf(name)).toMatch(/overflow:\s*hidden/);
  });

  it('prints a long run heading and five lines in full in the markup', async () => {
    const { output } = await board();
    const heading = 'TOMORROW · 60 min · no session planned · does not fit your hours · and more words';
    const lines = ['07:00–08:00', 'dry · 12 km/h SW · 9°C', 'Wind at the start from SW', 'Dark after 17:05', 'x'];
    const text = textOf(await renderFull({ ...output, run: { kind: 'window', heading, lines } }));
    expect(text).toContain(heading);
    for (const line of lines) expect(text).toContain(line);
    expect(text).toContain('data We 12:00');
  });
});

describe.each(LAYOUTS)('%s.liquid: template rules', layout => {
  const template = layoutTemplate(layout);

  it('escapes every printed value except the validated SVG data', () => {
    const allowed = [
      'form.pastPath',
      'form.futurePath',
      'form.zeroY',
      'form.todayX',
      'form.todayX | divided_by: 3.6',
      'segment.x | plus: 0',
      'segment.width | plus: 0',
      'patternId'
    ];
    const tags = [...template.matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)].map(match => match[1]);
    expect(tags.length).toBeGreaterThan(3);
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
    for (const value of values) expect(['#000', '#fff', 'url', 'none', 'transparent']).toContain(value.toLowerCase());
    expect(template).not.toMatch(/gr[ae]y/i);
  });

  it('stays under 100 KB', () => {
    expect(Buffer.byteLength(template)).toBeLessThanOrEqual(100 * 1024);
  });
});

// The framework's text elements; their size modifiers and the font--* utilities set no colour
const TEXT_ELEMENTS = ['description', 'label', 'title', 'value'];
// The board's classes for elements that print text
const TEXT_PARTS = [
  'rb-title',
  'rb-day__label',
  'rb-item',
  'rb-day__more',
  'rb-total',
  'rb-message',
  'rb-form__heading',
  'rb-form__value',
  'rb-form__label',
  'rb-form__today',
  'rb-intensity__heading',
  'rb-intensity__label',
  'rb-run__heading',
  'rb-run__line',
  'rb-foot__source',
  'rb-foot__time'
];
const markupOf = template => template.slice(template.indexOf('</style>'));
// Class lists with the Liquid tags removed (the text between them stays, so conditional classes count)
const classListsOf = template =>
  [...markupOf(template).matchAll(/class="([^"]*)"/g)].map(match =>
    match[1]
      .replace(/\{[{%][\s\S]*?[}%]\}/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
const elementsUsed = templates =>
  [...new Set(templates.flatMap(t => classListsOf(t).flat()).filter(name => TEXT_ELEMENTS.includes(name)))].sort();
const selectorsOf = (template, body) =>
  [...template.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{\s*([^}]*)\}/g)]
    .filter(match => match[2].trim() === body)
    .flatMap(match => match[1].split(',').map(selector => selector.trim()));

describe('typography', () => {
  const shared = layoutTemplate('full').slice(0, layoutTemplate('full').indexOf('</style>'));
  const templates = LAYOUTS.map(layoutTemplate);

  it('uses no custom font sizes, families or line heights', () => {
    expect(shared).not.toMatch(/font-size|font-family|line-height/);
    for (const template of templates) expect(markupOf(template)).not.toMatch(/font-size|font-family|line-height/);
  });

  it.each(LAYOUTS)('%s: draws every text with a framework element', layout => {
    const lists = classListsOf(layoutTemplate(layout));
    const texts = lists.filter(list => list.some(name => TEXT_PARTS.includes(name)));
    expect(texts.length).toBeGreaterThan(3);
    for (const list of texts)
      expect([list.join(' '), list.some(name => TEXT_ELEMENTS.includes(name))]).toEqual([list.join(' '), true]);
    expect(markupOf(layoutTemplate(layout))).not.toMatch(/<span>/);
  });

  it.each(LAYOUTS)('%s: steps every text up on X', layout => {
    const texts = classListsOf(layoutTemplate(layout)).filter(list => list.some(name => TEXT_ELEMENTS.includes(name)));
    expect(texts.length).toBeGreaterThan(3);
    for (const list of texts) {
      const stepped = list.some(name => /^lg:(title|value|label|description)--[a-z]+$/.test(name));
      expect([list.join(' '), stepped]).toEqual([list.join(' '), true]);
    }
  });

  it('clamps items to one line on OG and two on X', () => {
    const items = markupOf(template).match(/<span class="rb-item[^>]*>/g);
    expect(items).toHaveLength(2);
    for (const item of items) expect(item).toContain('data-clamp="1" data-clamp-lg="2"');
    const rule = template.match(/\.rb-item\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).not.toMatch(/nowrap|ellipsis/);
  });

  it("pins every framework text class to black in dark mode, so TRMNL's dark mode can't recolour them", () => {
    const used = elementsUsed(templates);
    expect(used.length).toBeGreaterThanOrEqual(3);
    const pinned = selectorsOf(shared, 'color: #000;')
      .map(selector => selector.match(/^\.screen \.rb \.([a-z]+)$/))
      .filter(Boolean)
      .map(match => match[1]);
    expect(pinned.sort()).toEqual(used);
  });

  it('keeps the today row white', () => {
    const full = layoutTemplate('full');
    const dayRow = full.slice(full.indexOf('<div class="rb-days">'), full.indexOf('<div class="rb-total'));
    const used = elementsUsed([`</style>${dayRow}`]);
    expect(used.length).toBeGreaterThan(0);
    const white = selectorsOf(shared, 'color: #fff;')
      .map(selector => selector.match(/^\.screen \.rb \.rb-day--today \.([a-z]+)$/))
      .filter(Boolean)
      .map(match => match[1]);
    expect(white.sort()).toEqual(used);
    expect(shared.indexOf('.screen .rb .rb-day--today .')).toBeGreaterThan(shared.indexOf('.screen .rb .'));
  });

  it('keeps the compact run panel smaller than the full one with classes, not CSS', () => {
    expect(shared).not.toMatch(/\.rb-run--compact\s/);
    const runClasses = layout =>
      classListsOf(layoutTemplate(layout))
        .filter(list => list.some(name => /^rb-run__/.test(name)))
        .map(list => list.filter(name => !name.startsWith('rb')).join(' '));
    for (const layout of ['half_horizontal', 'half_vertical', 'quadrant'])
      expect(runClasses(layout)).not.toEqual(runClasses('full'));
  });
});

describe('full.liquid: Tredict states', () => {
  it.each([
    ['paused', /Tredict token paused\. Open the Tredict web app to reactivate it\./],
    ['auth', /Tredict token invalid\. Check it has the activityRead scope\./],
    ['payment', /Tredict says this account can(?:'|&#39;|&#x27;|&apos;)t use the API\./],
    ['unavailable', /Tredict unavailable/]
  ])('%s: shows the message once instead of the week and graph, keeps the run window', async (state, message) => {
    const { output, html } = await rendered({ previous: null }, STATE_CASES[state]);
    expect(output.tredict.state).toBe(state);
    const text = textOf(html);
    expect(text.match(new RegExp(message.source, 'g'))).toHaveLength(1);
    const left = html.slice(html.indexOf('class="rb-left"'), html.indexOf('class="rb-right"'));
    expect(textOf(left)).toMatch(message);
    const graph = html.slice(html.indexOf('class="rb-form"'), html.indexOf('class="rb-run"'));
    expect(graph).not.toContain('rb-message');
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
    expect(text.match(/Tredict data from We 10:00/g)).toHaveLength(1);
    expect(rows(html)).toHaveLength(7);
    expect(html).toContain('<svg');
    expect(text).toContain('WEEK 45');
    expect(text).toContain(output.run.lines[0]);
  });
});

describe('full.liquid: empty and broken outputs (Review Focus 4)', () => {
  it('shows empty states for a new account', async () => {
    const { output, html } = await rendered({ previous: null }, EMPTY_ACCOUNT_OVERRIDES);
    expect(output.form.empty).toBe('No training data yet');
    const text = textOf(html);
    expect(text).toContain('No training data yet');
    expect(html).not.toContain('<svg');
    expect(rows(html)).toHaveLength(7);
    expect(text.match(/—/g).length).toBeGreaterThanOrEqual(7);
    expect(text).not.toMatch(/\b(NaN|undefined|null)\b/);
  });

  it('renders the fixed error output without lang, week, form or data time', async () => {
    const output = ERROR_OUTPUT;
    const html = await renderFull(output);
    const text = textOf(html);
    expect(text.match(/Tredict unavailable/g)).toHaveLength(1);
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
    expect(text).toContain('Vorm');
    expect(text).toContain('MORGEN · 60 min');
    expect(text).toContain('data wo 12:00');
    expect(text).toContain('droog');
    expect(text).toContain('6 weken terug');
  });
});

describe('smaller layouts', () => {
  let output;

  beforeAll(async () => {
    ({ output } = await board());
  });

  const text = async (layout, value) => textOf(await renderLayout(layout, value));

  it.each(LAYOUTS)('%s shows the run window, the attribution and the dark theme', async layout => {
    const shown = await text(layout, output);
    expect(shown).toContain(output.run.heading);
    for (const line of output.run.lines) expect(shown).toContain(line);
    expect(shown).toContain(output.attribution);
    expect(await renderLayout(layout, { ...output, theme: 'dark' })).toContain('<div class="rb rb--dark">');
  });

  it('half vertical shows the form graph and the intensity bar, not the week', async () => {
    const html = await renderLayout('half_vertical', output);
    expect(html).toContain('rb-form__graph');
    expect(textOf(html)).toContain(output.intensity.heading);
    expect(textOf(html)).not.toContain(output.week.title);
  });

  it('half horizontal shows the form graph beside the run window, without the bar or the week', async () => {
    const html = await renderLayout('half_horizontal', output);
    expect(html).toContain('rb-form__graph');
    expect(textOf(html)).toContain(output.form.today);
    expect(textOf(html)).not.toContain(output.intensity.heading);
    expect(textOf(html)).not.toContain(output.week.title);
  });

  it('quadrant shows only the run window', async () => {
    const html = await renderLayout('quadrant', output);
    expect(html.slice(html.indexOf('</style>'))).not.toContain('rb-form');
    expect(textOf(html)).not.toContain(output.week.title);
  });

  it.each(['half_vertical', 'half_horizontal'])('%s shows the Tredict message when there is no data', async layout => {
    const { output: auth } = await board({ previous: null }, STATE_CASES.paused);
    expect(await text(layout, auth)).toContain(auth.tredict.message);
  });

  it.each(LAYOUTS)('%s renders the fixed error output', async layout => {
    expect(await text(layout, ERROR_OUTPUT)).toContain('Weather unavailable');
  });
});
