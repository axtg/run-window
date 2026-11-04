// The page's DOM glue: reads the controls, calls /api/window and draws the strip, overview and chart. The logic
// lives in route.js, plan.js, strip.js and settings.js. The route, its file name and the coordinates stay in memory.
(function () {
  const { parseRoute, summarizeRoute } = globalThis.RouteFile;
  const Plan = globalThis.RunPlan;
  const Strip = globalThis.DayStrip;
  const { loadSettings, saveSettings, validHours } = globalThis.RunSettings;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const STRIP_HEIGHT = 52;
  const CELL_TOP = 4;
  const CELL_HEIGHT = 32;
  const CHART_HEIGHT = 112;
  const PLOT_HEIGHT = 94;
  const MIN_WIDTH = 200;

  const MESSAGES = {
    'too-large': 'That file is too large for a route.',
    unreadable: 'That file has no route in it.',
    'too-few-points': 'That file has fewer than 2 points.',
    locationOff: 'Location is off. Open a route file instead.',
    noLocation: 'Open a route file or use your location.',
    loading: 'Checking the weather…',
    locating: 'Finding your location…',
    copied: 'Copied',
    pace: 'Pace is m:ss per km, from 3:00 to 15:00.',
    duration: 'Duration is 15 to 300 minutes.',
    rain: 'Rain is 0 to 100 %.',
    hours: 'Hours look like 06-22 or 07-09,17-21.'
  };

  const $ = id => document.getElementById(id);
  const el = {
    source: $('source'),
    dayToday: $('day-today'),
    dayTomorrow: $('day-tomorrow'),
    zoneNote: $('zone-note'),
    routeInput: $('route-input'),
    useLocation: $('use-location'),
    chipDuration: $('chip-duration'),
    chipDark: $('chip-dark'),
    chipRain: $('chip-rain'),
    chipHours: $('chip-hours'),
    editorDuration: $('editor-duration'),
    editorRain: $('editor-rain'),
    editorHours: $('editor-hours'),
    paceField: $('pace-field'),
    oneoffField: $('oneoff-field'),
    durationField: $('duration-field'),
    paceInput: $('pace-input'),
    oneoffInput: $('oneoff-input'),
    durationInput: $('duration-input'),
    rainInput: $('rain-input'),
    hoursInput: $('hours-input'),
    status: $('status'),
    result: $('result'),
    strip: $('strip'),
    tapLine: $('tap-line'),
    goLine: $('go-line'),
    windLine: $('wind-line'),
    routeLine: $('route-line'),
    staleNote: $('stale-note'),
    why: $('why'),
    chart: $('chart'),
    whySentence: $('why-sentence'),
    copyLink: $('copy-link')
  };

  // Reading the getter itself can throw (blocked site data), so it is wrapped too.
  function deviceStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  const storage = deviceStorage();
  const state = {
    settings: loadSettings(storage),
    summary: null, // the opened route's summary, memory only
    location: null, // { lat, lon }, already rounded to 2 decimals
    oneOffMin: null, // this run only, not remembered
    dayIndex: 0,
    body: null, // the last /api/window response
    selected: null,
    request: 0
  };

  function setStatus(text) {
    el.status.textContent = text || '';
  }

  function svg(name, attributes) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  function round2(value) {
    return Number(value.toFixed(2));
  }

  function runMinutes() {
    if (!state.summary) return state.settings.durationMin;
    if (state.oneOffMin !== null) return state.oneOffMin;
    return Math.max(1, Plan.runMinutes(state.summary.distanceKm, state.settings.paceSec));
  }

  function query() {
    const { hours, allowDark, rain } = state.settings;
    return { lat: state.location.lat, lon: state.location.lon, hours, allowDark, rain };
  }

  // ---- Chips and editors

  function renderChips() {
    const { allowDark, rain, hours } = state.settings;
    const minutes = runMinutes();
    el.chipDuration.textContent = state.summary
      ? `${state.summary.distanceKm.toFixed(1)} km · ${minutes} min`
      : `${minutes} min`;
    el.chipDark.setAttribute('aria-pressed', String(allowDark));
    el.chipRain.textContent = `Rain ≤ ${rain} %`;
    el.chipHours.textContent = `Hours ${hours}`;
  }

  const editors = [
    { chip: el.chipDuration, form: el.editorDuration, fill: fillDurationEditor },
    { chip: el.chipRain, form: el.editorRain, fill: fillRainEditor },
    { chip: el.chipHours, form: el.editorHours, fill: fillHoursEditor }
  ];

  function fillRainEditor() {
    el.rainInput.value = String(state.settings.rain);
  }

  function fillHoursEditor() {
    el.hoursInput.value = state.settings.hours;
  }

  function fillDurationEditor() {
    const withRoute = Boolean(state.summary);
    el.paceField.hidden = !withRoute;
    el.oneoffField.hidden = !withRoute;
    el.durationField.hidden = withRoute;
    el.paceInput.value = Plan.formatPace(state.settings.paceSec);
    el.oneoffInput.value = state.oneOffMin === null ? '' : state.oneOffMin;
    el.durationInput.value = state.settings.durationMin;
  }

  function closeEditors() {
    editors.forEach(({ chip, form }) => {
      form.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleEditor(editor) {
    const opening = editor.form.hidden;
    closeEditors();
    if (!opening) return;
    editor.fill();
    editor.form.hidden = false;
    editor.chip.setAttribute('aria-expanded', 'true');
    const input = [...editor.form.querySelectorAll('input')].find(node => !node.closest('[hidden]'));
    if (input) input.focus();
  }

  function minutesFrom(text) {
    const value = Number(text);
    return Number.isInteger(value) && value >= 15 && value <= 300 ? value : null;
  }

  function save(changes) {
    state.settings = { ...state.settings, ...changes };
    saveSettings(storage, state.settings);
  }

  function onDurationSubmit(event) {
    event.preventDefault();
    if (state.summary) {
      const pace = Plan.parsePace(el.paceInput.value.trim());
      if (pace === null) return setStatus(MESSAGES.pace);
      const oneOffText = el.oneoffInput.value.trim();
      const oneOff = oneOffText === '' ? null : minutesFrom(oneOffText);
      if (oneOffText !== '' && oneOff === null) return setStatus(MESSAGES.duration);
      save({ paceSec: pace });
      state.oneOffMin = oneOff;
    } else {
      const minutes = minutesFrom(el.durationInput.value.trim());
      if (minutes === null) return setStatus(MESSAGES.duration);
      save({ durationMin: minutes });
    }
    closeEditors();
    setStatus('');
    renderChips();
    render();
  }

  function onRainSubmit(event) {
    event.preventDefault();
    const rain = Number(el.rainInput.value);
    if (el.rainInput.value.trim() === '' || !Number.isInteger(rain) || rain < 0 || rain > 100) {
      return setStatus(MESSAGES.rain);
    }
    save({ rain });
    closeEditors();
    renderChips();
    refresh();
  }

  function onHoursSubmit(event) {
    event.preventDefault();
    const hours = el.hoursInput.value.trim();
    if (!validHours(hours)) return setStatus(MESSAGES.hours);
    save({ hours });
    closeEditors();
    renderChips();
    refresh();
  }

  function onDarkToggle() {
    save({ allowDark: !state.settings.allowDark });
    renderChips();
    refresh();
  }

  function setDay(index) {
    state.dayIndex = index;
    state.selected = null;
    el.dayToday.setAttribute('aria-pressed', String(index === 0));
    el.dayTomorrow.setAttribute('aria-pressed', String(index === 1));
    render();
  }

  // ---- Input: a route file or the device's location

  function openRouteText(text, fileName) {
    const parsed = parseRoute(String(text), String(fileName || ''), window.DOMParser);
    if (!parsed.ok) return setStatus(MESSAGES[parsed.reason] || MESSAGES.unreadable);
    state.summary = summarizeRoute(parsed.route);
    state.location = { lat: state.summary.start.lat, lon: state.summary.start.lon };
    state.oneOffMin = null;
    el.source.textContent = state.summary.name || 'Route';
    closeEditors();
    renderChips();
    return refresh();
  }

  async function onFileChosen() {
    const file = el.routeInput.files && el.routeInput.files[0];
    el.routeInput.value = ''; // so the same file can be opened again
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setStatus(MESSAGES['too-large']);
    let text;
    try {
      text = await file.text();
    } catch {
      return setStatus(MESSAGES.unreadable);
    }
    openRouteText(text, file.name);
  }

  function onUseLocation() {
    if (!navigator.geolocation) return setStatus(MESSAGES.locationOff);
    setStatus(MESSAGES.locating);
    navigator.geolocation.getCurrentPosition(
      position => {
        state.summary = null;
        state.oneOffMin = null;
        state.location = { lat: round2(position.coords.latitude), lon: round2(position.coords.longitude) };
        el.source.textContent = 'Near you';
        closeEditors();
        renderChips();
        refresh();
      },
      () => setStatus(MESSAGES.locationOff),
      { maximumAge: 10 * 60 * 1000, timeout: 15000 }
    );
  }

  // ---- The request

  async function refresh() {
    if (!state.location) return setStatus(MESSAGES.noLocation);
    const request = ++state.request;
    setStatus(MESSAGES.loading);
    let message = null;
    let body = null;
    try {
      const response = await fetch(Plan.apiUrl(location.origin, query(), { slots: true }));
      const json = await response.json().catch(() => null);
      if (response.ok && json && Array.isArray(json.days)) {
        body = json;
      } else {
        const retryAfter = Number(response.headers.get('Retry-After')) || null;
        message = Plan.errorMessage({ status: response.status, message: json && json.message, retryAfter });
      }
    } catch {
      message = Plan.errorMessage({ status: 0 });
    }
    if (request !== state.request) return undefined; // a newer request has started
    state.body = body;
    state.selected = null;
    setStatus(message);
    return render();
  }

  // ---- Drawing

  function currentDay() {
    return state.body && state.body.days[state.dayIndex];
  }

  // The window's own slots: its start plus the run's time, or the whole window for a fallback or a capped run.
  function outlineRange(slots, result, minutes) {
    if (result.kind === 'none') return null;
    const { start, end } = result.window;
    const runEnd = result.kind === 'window' && result.fits ? Date.parse(start) + minutes * 60000 : Date.parse(end);
    return Strip.rangeIndices(slots, start, new Date(runEnd).toISOString());
  }

  function widthOf(node) {
    return Math.max(MIN_WIDTH, Math.floor(node.getBoundingClientRect().width));
  }

  function drawTicks(target, slots, step, timeZone, y) {
    Strip.ticks(slots, timeZone).forEach(({ index, label }) => {
      const x = Math.min(index * step, step * slots.length - 12);
      const text = svg('text', { x: x.toFixed(1), y, class: 'fill-secondary text-[10px]' });
      text.textContent = label;
      target.appendChild(text);
    });
  }

  function drawGaps(target, gaps, step, height, className) {
    gaps.forEach(index => {
      const x = (index * step).toFixed(1);
      target.appendChild(svg('line', { x1: x, x2: x, y1: 0, y2: height, class: className, 'stroke-width': 3 }));
    });
  }

  function drawStrip(slots, range, fallback, timeZone, gaps) {
    const width = widthOf(el.strip);
    const step = width / slots.length;
    el.strip.replaceChildren();
    el.strip.setAttribute('viewBox', `0 0 ${width} ${STRIP_HEIGHT}`);
    el.strip.setAttribute('width', width);
    Strip.shadeClasses(slots).forEach((className, index) => {
      el.strip.appendChild(
        svg('rect', {
          x: (index * step).toFixed(1),
          y: CELL_TOP,
          width: (step + 0.5).toFixed(1),
          height: CELL_HEIGHT,
          class: className
        })
      );
    });
    drawGaps(el.strip, gaps, step, CELL_TOP * 2 + CELL_HEIGHT, 'stroke-white');
    if (range) {
      const outline = {
        x: (range.first * step + 1.5).toFixed(1),
        y: 1.5,
        width: Math.max(3, (range.last - range.first + 1) * step - 3).toFixed(1),
        height: CELL_HEIGHT + 2 * CELL_TOP - 3,
        rx: 4,
        class: 'fill-none stroke-primary',
        'stroke-width': 3
      };
      if (fallback) outline['stroke-dasharray'] = '6 4';
      el.strip.appendChild(svg('rect', outline));
    }
    if (state.selected !== null) {
      el.strip.appendChild(
        svg('rect', {
          x: (state.selected * step).toFixed(1),
          y: CELL_TOP + CELL_HEIGHT - 4,
          width: Math.max(2, step).toFixed(1),
          height: 4,
          class: 'fill-primary'
        })
      );
    }
    drawTicks(el.strip, slots, step, timeZone, STRIP_HEIGHT - 2);
  }

  function drawChart(slots, range, timeZone) {
    const width = widthOf(el.chart.parentElement);
    const model = Strip.chartModel(slots, { width, height: PLOT_HEIGHT, range });
    const step = width / slots.length;
    el.chart.replaceChildren();
    el.chart.setAttribute('viewBox', `0 0 ${width} ${CHART_HEIGHT}`);
    el.chart.setAttribute('width', width);
    model.dark.forEach(run => {
      el.chart.appendChild(
        svg('rect', { x: run.x, y: 0, width: run.width, height: PLOT_HEIGHT, class: 'fill-gray-200' })
      );
    });
    if (model.window) {
      const { x, width: w } = model.window;
      el.chart.appendChild(svg('rect', { x, y: 0, width: w, height: PLOT_HEIGHT, class: 'fill-green-100' }));
    }
    model.rain.forEach(bar => {
      const attributes = { x: bar.x, y: bar.y, width: Math.max(1, bar.width - 1), height: bar.height };
      el.chart.appendChild(svg('rect', { ...attributes, class: 'fill-blue-300' }));
    });
    if (model.feels) {
      el.chart.appendChild(svg('path', { d: model.feels, class: 'fill-none stroke-red-600', 'stroke-width': 2 }));
    }
    if (model.wind) {
      el.chart.appendChild(
        svg('path', { d: model.wind, class: 'fill-none stroke-blue-700', 'stroke-width': 2, 'stroke-dasharray': '4 3' })
      );
    }
    drawGaps(el.chart, model.gaps, step, PLOT_HEIGHT, 'stroke-white');
    drawTicks(el.chart, slots, step, timeZone, CHART_HEIGHT - 4);
  }

  function renderTapLine(slots, timeZone) {
    if (state.selected === null || !slots[state.selected]) {
      el.tapLine.textContent = 'Tap the strip, or use the arrow keys, for each slot.';
      return;
    }
    el.tapLine.textContent = Strip.slotLine(slots[state.selected], timeZone);
  }

  function render() {
    const day = currentDay();
    renderChips();
    if (!day) {
      el.result.hidden = true;
      el.zoneNote.hidden = true;
      return;
    }
    const timeZone = state.body.location.timezone;
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zone = Plan.zoneNote(timeZone, deviceZone, Date.now());
    el.zoneNote.hidden = !zone;
    el.zoneNote.textContent = zone ? `· ${zone}` : '';

    const minutes = runMinutes();
    const dayLabel = state.dayIndex === 0 ? 'today' : 'tomorrow';
    const result = Plan.pickResult(day, minutes);
    const slots = day.slots || [];
    const range = outlineRange(slots, result, minutes);

    el.result.hidden = false;
    el.goLine.textContent = Plan.goLine(result, { minutes, dayLabel, timeZone });
    el.windLine.textContent = result.window ? Plan.windLine(state.summary, result.window) : '';
    const routeText = Plan.routeLine(state.summary);
    el.routeLine.hidden = !routeText;
    el.routeLine.textContent = routeText || '';
    const stale = Plan.staleNote(state.body);
    el.staleNote.hidden = !stale;
    el.staleNote.textContent = stale || '';
    el.strip.setAttribute('aria-label', `Day strip, ${dayLabel}: ${el.goLine.textContent}`);

    if (slots.length === 0) {
      el.strip.replaceChildren();
      el.chart.replaceChildren();
      el.whySentence.textContent = '';
      el.tapLine.textContent = 'No hours to show for this day.';
      return;
    }
    const gaps = Strip.chartModel(slots, { width: 1, height: 1, range: null }).gaps;
    drawStrip(slots, range, result.kind === 'fallback', timeZone, gaps);
    drawChart(slots, range, timeZone);
    el.whySentence.textContent = Strip.whySentence(slots, range, { timeZone, sunsetIso: day.sunset });
    renderTapLine(slots, timeZone);
  }

  // ---- Exploring the strip: tap or arrow keys. It never moves the outline.

  function select(index) {
    const day = currentDay();
    if (!day || !day.slots || day.slots.length === 0) return;
    state.selected = Math.max(0, Math.min(day.slots.length - 1, index));
    render();
  }

  function onStripClick(event) {
    const day = currentDay();
    if (!day || !day.slots || day.slots.length === 0) return;
    const box = el.strip.getBoundingClientRect();
    select(Math.floor(((event.clientX - box.left) / box.width) * day.slots.length));
  }

  function onStripKey(event) {
    const day = currentDay();
    if (!day || !day.slots || day.slots.length === 0) return;
    const last = day.slots.length - 1;
    const from = state.selected === null ? -1 : state.selected;
    const moves = {
      ArrowRight: Math.min(last, from + 1),
      ArrowLeft: from <= 0 ? 0 : from - 1,
      Home: 0,
      End: last
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(moves[event.key]);
  }

  // ---- Copy API link: the same answer from the API, without slots=1.

  async function onCopyLink() {
    if (!state.location) return setStatus(MESSAGES.noLocation);
    const url = Plan.apiUrl(location.origin, query());
    try {
      await navigator.clipboard.writeText(url);
      setStatus(MESSAGES.copied);
    } catch {
      setStatus(`Copy failed. The link: ${url}`);
    }
  }

  let resizeFrame = null;
  function onResize() {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      render();
    });
  }

  editors.forEach(editor => editor.chip.addEventListener('click', () => toggleEditor(editor)));
  el.editorDuration.addEventListener('submit', onDurationSubmit);
  el.editorRain.addEventListener('submit', onRainSubmit);
  el.editorHours.addEventListener('submit', onHoursSubmit);
  el.chipDark.addEventListener('click', onDarkToggle);
  el.dayToday.addEventListener('click', () => setDay(0));
  el.dayTomorrow.addEventListener('click', () => setDay(1));
  el.routeInput.addEventListener('change', onFileChosen);
  el.useLocation.addEventListener('click', onUseLocation);
  el.strip.addEventListener('click', onStripClick);
  el.strip.addEventListener('keydown', onStripKey);
  el.copyLink.addEventListener('click', onCopyLink);
  el.why.addEventListener('toggle', render); // the chart has no width while folded
  window.addEventListener('resize', onResize);
  renderChips();

  globalThis.RunApp = { openRouteText };
})();
