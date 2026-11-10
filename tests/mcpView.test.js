// The MCP view of find_best_run_time: its pure model, and the single HTML file the server hands out.
const { VIEW_META_KEY, viewModel } = require('../mcp-view/day');
const { VIEW_MIME_TYPE, VIEW_URI, viewHtml } = require('../lib/mcpView');

const ZONE = 'Europe/Amsterdam';

// 12:00-14:00 local on 2 November 2026 (11:00-13:00 UTC), in 15-minute slots, dry and calm
function slots(count = 8, firstUtcHour = 11) {
  return Array.from({ length: count }, (_, i) => ({
    start: new Date(Date.UTC(2026, 10, 2, firstUtcHour, i * 15)).toISOString(),
    status: 'ok',
    score: i,
    apparentTemp: 10 + i,
    windSpeed: 8,
    windFrom: 90,
    precipProb: 0,
    inDaylight: true
  }));
}

const window = {
  start: '2026-11-02T11:00:00.000Z',
  end: '2026-11-02T12:00:00.000Z',
  qualifies: true,
  precipProbMax: 0,
  apparentTempAvg: 11,
  windAvg: 14,
  windFrom: 90,
  windFromCardinal: 'E'
};

const payload = (day, extra = {}) => ({ dayLabel: 'today', minutes: 60, timeZone: ZONE, day, ...extra });

describe('viewModel', () => {
  test('the answer as on the page: label, time, numbers, wind line and the outlined slots', () => {
    const model = viewModel(payload({ windows: { 60: window }, slots: slots(), sunset: '2026-11-02T16:09:00.000Z' }));
    expect(model).toMatchObject({
      label: 'Today · Best time · 60 min',
      time: '12:00–13:00',
      none: false,
      fallback: false,
      arrow: 270,
      windText: 'Wind from the east · start east, into it',
      range: { first: 0, last: 3 }
    });
    expect(model.numbers.map(n => n.label)).toEqual(['Sky', 'Feels', 'Wind', 'Run']);
    expect(model.numbers[3].value).toBe('60 min');
  });

  test('no window: says so, still with the day to draw', () => {
    const model = viewModel(payload({ windows: {}, slots: slots() }, { dayLabel: 'tomorrow', minutes: 45 }));
    expect(model).toMatchObject({ label: 'Tomorrow', time: 'No dry window of 45 min tomorrow', none: true });
    expect(model.range).toBeNull();
    expect(model.numbers).toEqual([]);
    expect(model.slots).toHaveLength(8);
  });

  test('the least bad hour is outlined, without the dry stretch sentence', () => {
    const wet = { ...window, qualifies: false, precipProbMax: 90 };
    const model = viewModel(payload({ windows: {}, fallback: wet, slots: slots() }));
    expect(model).toMatchObject({ label: 'Today · Least bad · 60 min', fallback: true, why: '' });
    expect(model.range).toEqual({ first: 0, last: 3 });
  });

  test('in little wind there is no direction to start into', () => {
    const model = viewModel(payload({ windows: { 60: { ...window, windAvg: 6 } }, slots: slots() }));
    expect(model.arrow).toBeNull();
    expect(model.windText).toBe('');
  });

  test('anything else is not drawn', () => {
    expect(viewModel(undefined)).toBeNull();
    expect(viewModel({ day: {} })).toBeNull();
  });
});

describe('the view file', () => {
  const html = viewHtml();
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];

  test('is one self-contained HTML document of the MCP Apps type', () => {
    expect(VIEW_URI).toBe('ui://besttimetorun/day.html');
    expect(VIEW_MIME_TYPE).toBe('text/html;profile=mcp-app');
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import|url\(/);
    expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
    expect(html).not.toContain('/* day.css */');
    expect(html).not.toContain('/* day.js */');
  });

  test('inlines plan.js, strip.js and the view, in that order, as code that parses', () => {
    expect(scripts).toHaveLength(1);
    const code = scripts[0][1];
    const order = ['globalThis.RunPlan = api', 'globalThis.DayStrip = api', VIEW_META_KEY].map(s => code.indexOf(s));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(() => new Function(code)).not.toThrow();
  });

  test('names Open-Meteo, as its licence asks', () => {
    expect(html).toContain('Open-Meteo.com (CC BY 4.0)');
  });
});
