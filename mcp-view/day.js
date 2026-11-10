// The MCP view of find_best_run_time: the page's answer and timeline, drawn in the assistant's chat from the tool
// result's `_meta`. It runs in the host's sandboxed frame and talks to it over postMessage (the MCP Apps protocol);
// it loads and fetches nothing. plan.js and strip.js are inlined before it, as on the page. `viewModel` is pure and
// tested in Jest.
(function () {
  const inNode = typeof module !== 'undefined';
  const Plan = inNode ? require('../public/plan') : globalThis.RunPlan;
  const Strip = inNode ? require('../public/strip') : globalThis.DayStrip;

  const VIEW_META_KEY = 'com.besttimetorun/day';
  const PROTOCOL_VERSION = '2026-01-26';
  const SITE = 'https://besttimetorun.com/';
  const BAND_HEIGHT = 24;
  const PLOT_TOP = 30;
  const PLOT_HEIGHT = 90;
  const TIMELINE_HEIGHT = 138;
  const MIN_WIDTH = 200;
  const MINUTE_MS = 60000;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const capitalise = text => text.charAt(0).toUpperCase() + text.slice(1);

  // The window's own slots: its start plus the run's time, or the whole window for a fallback (as on the page).
  function outlineRange(slots, result, minutes) {
    if (result.kind === 'none') return null;
    const { start, end } = result.window;
    const runEnd = result.kind === 'window' && result.fits ? Date.parse(start) + minutes * MINUTE_MS : Date.parse(end);
    return Strip.rangeIndices(slots, start, new Date(runEnd).toISOString());
  }

  // Everything the view shows, as text and numbers. Null when the payload isn't the tool's.
  function viewModel(payload) {
    if (!payload || !payload.day || !payload.timeZone || !payload.minutes) return null;
    const { day, minutes, timeZone } = payload;
    const index = [0, 1, 2].includes(payload.dayIndex) ? payload.dayIndex : 0;
    const dayLabel = Plan.dayLabel(index, payload.date || '');
    const dayName = capitalise(dayLabel.replace(/^on /, '')); // Today, Tomorrow, Thursday
    const result = Plan.pickResult({ windows: day.windows || {}, fallback: day.fallback || null }, minutes);
    const none = result.kind === 'none';
    const slots = Array.isArray(day.slots) ? day.slots : [];
    const range = outlineRange(slots, result, minutes);
    const arrow = none ? null : Plan.windArrowDeg(result.window);
    return {
      label: none ? dayName : `${dayName} · ${Plan.answerLabel(result, minutes)}`,
      time: none
        ? Plan.noWindowText(minutes, dayLabel, Plan.noWindowCause(slots, minutes))
        : Plan.answerTime(result, { minutes, timeZone }),
      none,
      fallback: result.kind === 'fallback',
      numbers: Plan.keyNumbers(result, null, minutes),
      arrow,
      windText: arrow === null ? '' : Plan.windLine(null, result.window),
      outlook: Plan.outlookNote(index),
      // No why line for the least bad hour: it is the dry stretch's sentence, and that hour isn't dry.
      why:
        range && result.kind === 'window' ? Strip.whySentence(slots, range, { timeZone, sunsetIso: day.sunset }) : '',
      slots,
      range,
      timeZone
    };
  }

  const api = { VIEW_META_KEY, PROTOCOL_VERSION, viewModel };
  if (inNode) {
    module.exports = api;
    return;
  }

  // ---- In the host's frame

  const $ = id => document.getElementById(id);
  const state = { model: null, selected: null };

  function svg(name, attributes) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  function el(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---- The host: JSON-RPC 2.0 over postMessage with the parent frame

  let nextId = 1;
  const pending = new Map();
  const post = message => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
  const notify = (method, params) => post({ method, params });
  function request(method, params) {
    const id = nextId++;
    post({ id, method, params });
    return new Promise(resolve => pending.set(id, resolve));
  }

  function applyContext(context) {
    if (!context) return;
    if (context.theme) document.documentElement.setAttribute('data-theme', context.theme);
    const variables = context.styles && context.styles.variables;
    if (variables) {
      for (const [name, value] of Object.entries(variables)) {
        if (/^--[\w-]+$/.test(name) && typeof value === 'string')
          document.documentElement.style.setProperty(name, value);
      }
    }
  }

  let lastHeight = 0;
  function reportSize() {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height === lastHeight) return;
    lastHeight = height;
    notify('ui/notifications/size-changed', { width: Math.ceil(window.innerWidth), height });
  }

  function onMessage(event) {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.method === undefined) {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      if (resolve) resolve(message.result || null);
      return;
    }
    const { method, params, id } = message;
    if (method === 'ui/notifications/tool-result') show(params);
    else if (method === 'ui/notifications/tool-cancelled') showNote('No answer.');
    else if (method === 'ui/notifications/host-context-changed') applyContext(params);
    else if (method === 'ui/resource-teardown' || method === 'ping') post({ id, result: {} });
    else if (id !== undefined) post({ id, error: { code: -32601, message: 'Method not found' } });
  }

  // ---- Drawing

  function showNote(text) {
    $('answer').hidden = true;
    $('note').hidden = false;
    $('note').textContent = text;
    reportSize();
  }

  function show(result) {
    const model = viewModel(result && result._meta && result._meta[VIEW_META_KEY]);
    if (!model) {
      showNote(result && result.isError ? 'No answer: see the reply.' : 'Nothing to show.');
      return;
    }
    state.model = model;
    state.selected = null;
    $('note').hidden = true;
    $('answer').hidden = false;
    $('label').textContent = model.label;
    $('time').textContent = model.time;
    $('time').className = model.none ? 'time none' : 'time';
    renderNumbers(model.numbers);
    $('wind').hidden = model.arrow === null;
    $('wind-text').textContent = model.windText;
    if (model.arrow !== null) $('wind-arrow').setAttribute('transform', `rotate(${model.arrow} 14 14)`);
    $('outlook').hidden = !model.outlook;
    $('outlook').textContent = model.outlook || '';
    $('why').textContent = model.why;
    draw();
  }

  function renderNumbers(numbers) {
    const list = $('numbers');
    list.replaceChildren();
    numbers.forEach(({ label, value, note }) => {
      const item = el('div');
      const dt = el('dt', '', label);
      if (note) dt.appendChild(el('span', 'pill', note));
      const dd = el('dd');
      Plan.valueParts(value).forEach(part => dd.appendChild(el('span', part.unit ? 'unit' : '', part.text)));
      item.append(dt, dd);
      list.appendChild(item);
    });
    list.hidden = numbers.length === 0;
  }

  function drawGaps(target, gaps, step, from, to, className) {
    gaps.forEach(index => {
      const x = (index * step).toFixed(1);
      target.appendChild(svg('line', { x1: x, x2: x, y1: from, y2: to, class: className }));
    });
  }

  function draw() {
    const { slots, range, fallback, timeZone } = state.model;
    const timeline = $('timeline');
    timeline.replaceChildren();
    $('below').hidden = slots.length === 0;
    timeline.toggleAttribute('hidden', slots.length === 0);
    if (slots.length === 0) return reportSize();

    const width = Math.max(MIN_WIDTH, Math.floor($('answer').getBoundingClientRect().width));
    const step = width / slots.length;
    const model = Strip.chartModel(slots, { width, height: PLOT_HEIGHT, range });
    timeline.setAttribute('viewBox', `0 0 ${width} ${TIMELINE_HEIGHT}`);
    Strip.shadeClasses(slots).forEach((className, index) => {
      const cell = { x: (index * step).toFixed(1), y: 0, width: (step + 0.5).toFixed(1), height: BAND_HEIGHT };
      timeline.appendChild(svg('rect', { ...cell, class: className }));
    });
    drawGaps(timeline, model.gaps, step, 0, BAND_HEIGHT, 'g-gap');

    const graph = svg('g', { transform: `translate(0 ${PLOT_TOP})` });
    model.dark.forEach(run => graph.appendChild(svg('rect', { ...run, y: 0, height: PLOT_HEIGHT, class: 'g-dark' })));
    if (model.window) {
      graph.appendChild(svg('rect', { ...model.window, y: 0, height: PLOT_HEIGHT, class: 'g-window' }));
    }
    model.rain.forEach(bar =>
      graph.appendChild(svg('rect', { ...bar, width: Math.max(1, bar.width - 1), class: 'g-rain' }))
    );
    if (model.feels) graph.appendChild(svg('path', { d: model.feels, class: 'g-feels' }));
    if (model.wind) graph.appendChild(svg('path', { d: model.wind, class: 'g-wind' }));
    drawGaps(graph, model.gaps, step, 0, PLOT_HEIGHT, 'g-plot-gap');
    timeline.appendChild(graph);

    if (range) {
      const outline = {
        x: (range.first * step + 1).toFixed(1),
        y: 1,
        width: Math.max(2, (range.last - range.first + 1) * step - 2).toFixed(1),
        height: PLOT_TOP + PLOT_HEIGHT - 2,
        rx: 6,
        class: 'g-outline'
      };
      if (fallback) outline['stroke-dasharray'] = '6 4';
      timeline.appendChild(svg('rect', outline));
    }
    if (state.selected !== null) {
      const x = ((state.selected + 0.5) * step).toFixed(1);
      timeline.appendChild(svg('line', { x1: x, x2: x, y1: 0, y2: PLOT_TOP + PLOT_HEIGHT, class: 'g-cursor' }));
    }
    Strip.ticks(slots, timeZone).forEach(({ index, label }) => {
      const x = Math.min(index * step, step * slots.length - 12);
      const text = svg('text', { x: x.toFixed(1), y: TIMELINE_HEIGHT - 3, class: 'g-tick' });
      text.textContent = label;
      timeline.appendChild(text);
    });

    const idle = state.selected === null;
    const line = idle ? '' : Strip.slotLine(slots[state.selected], timeZone);
    $('legend').hidden = !idle;
    $('tap-line').textContent = idle ? tapHint() : line;
    timeline.setAttribute('aria-label', idle ? `Timeline: ${state.model.label} ${state.model.time}` : line);
    reportSize();
  }

  function tapHint() {
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
    return touch ? 'Tap a slot.' : 'Tap a slot or use the arrow keys.';
  }

  function select(index) {
    if (!state.model || state.model.slots.length === 0) return;
    state.selected = Math.max(0, Math.min(state.model.slots.length - 1, index));
    draw();
  }

  function onTimelineClick(event) {
    if (!state.model || state.model.slots.length === 0) return;
    const box = $('timeline').getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) / box.width) * state.model.slots.length);
    if (index === state.selected) {
      state.selected = null;
      draw();
    } else select(index);
  }

  function onTimelineKey(event) {
    if (!state.model) return;
    const current = state.selected === null ? -1 : state.selected;
    if (event.key === 'ArrowRight') select(current + 1);
    else if (event.key === 'ArrowLeft') select(current === -1 ? state.model.slots.length - 1 : current - 1);
    else if (event.key === 'Escape' && state.selected !== null) {
      state.selected = null;
      draw();
    } else return;
    event.preventDefault();
  }

  // Links open through the host: the sandbox would block a plain one.
  function onSiteClick(event) {
    event.preventDefault();
    request('ui/open-link', { url: SITE });
  }

  window.addEventListener('message', onMessage);
  $('timeline').addEventListener('click', onTimelineClick);
  $('timeline').addEventListener('keydown', onTimelineKey);
  $('site').addEventListener('click', onSiteClick);
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => (state.model ? draw() : reportSize()), 100);
  });

  request('ui/initialize', {
    appInfo: { name: 'best-time-to-run-day', version: '1.0.0' },
    appCapabilities: {},
    protocolVersion: PROTOCOL_VERSION
  }).then(result => {
    if (result) applyContext(result.hostContext);
    notify('ui/notifications/initialized', {});
    reportSize();
  });
})();
