// The page's DOM glue: reads the settings rows, calls /api/window and draws the answer and the timeline. The logic
// lives in route.js, plan.js, strip.js and settings.js. The route, its file name and the coordinates stay in memory.
(function () {
  const { parseRoute, summarizeRoute } = globalThis.RouteFile;
  const Plan = globalThis.RunPlan;
  const Strip = globalThis.DayStrip;
  const { loadSettings, saveSettings, splitHours, joinHours, moveHandle, addRow, removeRow } = globalThis.RunSettings;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const BAND_HEIGHT = 24;
  const PLOT_TOP = 30;
  const PLOT_HEIGHT = 90;
  const TIMELINE_HEIGHT = 138;
  const MIN_WIDTH = 200;
  const DAY_MIN = 1440;
  const PACE_STEP = 5;
  const PACE_RANGE = [180, 900];
  const DURATION_STEP = 15;
  const DURATION_RANGE = [15, 300];
  const TAP_HINT = 'Tap the timeline, or use the arrow keys, for each slot.';

  // Hour sliders: two overlaid native range inputs per row. Only their thumbs take the pointer.
  const HANDLE_CLASS =
    'pointer-events-none absolute inset-0 h-6 w-full appearance-none bg-transparent focus:outline-none ' +
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 ' +
    '[&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 ' +
    '[&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_0_0_2px_#111827,0_1px_3px_rgba(0,0,0,0.2)] ' +
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 ' +
    '[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none ' +
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white ' +
    '[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_#111827,0_1px_3px_rgba(0,0,0,0.2)] ' +
    '[&:focus-visible::-moz-range-thumb]:shadow-[0_0_0_4px_#111827] ' +
    '[&:focus-visible::-webkit-slider-thumb]:shadow-[0_0_0_4px_#111827]';
  const ROW_LABEL_CLASS = 'w-14 flex-none text-[11px] font-medium uppercase tracking-wide text-secondary';

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
    shareFailed: "The shared route didn't arrive. Open it again."
  };
  // Where sw.js leaves a shared route file for the page to read once.
  const SHARE_CACHE = 'shared-route';
  const SHARE_KEY = '/shared-route';

  // Every element app.js uses, by id; el.sourceSet is #source-set.
  const IDS = (
    'source source-distance source-set source-pick clear-source day-today day-tomorrow zone-note ' +
    'route-input use-location duration-group run-distance run-minutes run-estimate pace-down pace-input ' +
    'pace-up duration-down duration-value duration-up hours-rows add-hours dark-times dark-ok rain-input ' +
    'rain-fill rain-value prompt answer answer-label answer-time key-numbers wind-line wind-compass ' +
    'wind-arrow wind-text tomorrow-hint try-tomorrow tomorrow-text stale-note status ' +
    'result timeline tap-line why-sentence copy-link open-api open-privacy api-dialog privacy-dialog ' +
    'close-api close-privacy'
  ).split(' ');
  const camel = id => id.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
  const el = Object.fromEntries(IDS.map(id => [camel(id), document.getElementById(id)]));

  // Reading the getter itself can throw (blocked site data), so it is wrapped too.
  function deviceStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  const storage = deviceStorage();
  const settings = loadSettings(storage);
  const state = {
    settings,
    rows: splitHours(settings.hours), // the hour rows as shown, saved through joinHours on release
    rowViews: [],
    summary: null, // the opened route's summary, memory only
    location: null, // { lat, lon }, already rounded to 2 decimals
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

  function html(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function round2(value) {
    return Number(value.toFixed(2));
  }

  const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
  const percent = min => `${((min / DAY_MIN) * 100).toFixed(2)}%`;

  function runMinutes() {
    if (!state.summary) return state.settings.durationMin;
    return Math.max(1, Plan.runMinutes(state.summary.distanceKm, state.settings.paceSec));
  }

  function query() {
    const { hours, allowDark, rain } = state.settings;
    return { lat: state.location.lat, lon: state.location.lon, hours, allowDark, rain };
  }

  function currentDay() {
    return state.body && state.body.days[state.dayIndex];
  }

  function save(changes) {
    state.settings = { ...state.settings, ...changes };
    saveSettings(storage, state.settings);
  }

  // A settled change to something the request carries: save it, then ask once. Unchanged values ask nothing.
  function commit(changes) {
    const changed = Object.keys(changes).some(key => state.settings[key] !== changes[key]);
    if (!changed) return undefined;
    save(changes);
    render();
    return refresh();
  }

  // ---- Settings rows

  // One Run row: the duration (with a distance estimate under it) without a route, the route's distance and the
  // run's minutes with one. The pace is in both.
  function renderRunRow() {
    const withRoute = Boolean(state.summary);
    const { paceSec, durationMin } = state.settings;
    el.durationGroup.hidden = withRoute;
    el.runEstimate.hidden = withRoute;
    el.runDistance.hidden = !withRoute;
    el.runMinutes.hidden = !withRoute;
    el.paceInput.value = Plan.formatPace(paceSec);
    el.durationValue.textContent = `${durationMin} min`;
    el.runEstimate.textContent = withRoute ? '' : Plan.distanceEstimate(durationMin, paceSec);
    el.runDistance.textContent = withRoute ? `${state.summary.distanceKm.toFixed(1)} km` : '';
    el.runMinutes.textContent = withRoute ? `= ${runMinutes()} min` : '';
  }

  function stepPace(delta) {
    save({ paceSec: clamp(state.settings.paceSec + delta, PACE_RANGE) });
    render(); // pace is not in the request: the response already has every run length
  }

  function onPaceTyped() {
    const pace = Plan.parsePace(el.paceInput.value.trim());
    if (pace === null) {
      setStatus(MESSAGES.pace);
      el.paceInput.value = Plan.formatPace(state.settings.paceSec);
      return;
    }
    if (el.status.textContent === MESSAGES.pace) setStatus('');
    save({ paceSec: pace });
    render();
  }

  function stepDuration(delta) {
    save({ durationMin: clamp(state.settings.durationMin + delta, DURATION_RANGE) });
    render();
  }

  // While dragging only the fill and the value move; the input keeps its own value.
  function showRain(rain) {
    el.rainInput.setAttribute('aria-valuetext', `${rain} %`);
    el.rainFill.setAttribute('width', `${rain}%`);
    el.rainValue.textContent = `${rain} %`;
  }

  function renderDark() {
    el.darkOk.setAttribute('aria-checked', String(state.settings.allowDark));
  }

  // ---- Hour rows: built from the stored string on load, add and remove; updated in place while dragging.

  function handle(index, which) {
    const input = html('input', HANDLE_CLASS);
    input.type = 'range';
    input.min = '0';
    input.max = '24';
    input.step = '1';
    input.setAttribute('aria-label', `${which === 'start' ? 'Start' : 'End'} of hours ${index + 1}`);
    input.addEventListener('input', () => {
      state.rows = moveHandle(state.rows, index, which, Number(input.value));
      updateRows();
    });
    input.addEventListener('change', () => commit({ hours: joinHours(state.rows) }));
    return input;
  }

  function buildHours() {
    el.hoursRows.replaceChildren();
    state.rowViews = state.rows.map((row, index) => {
      const wrap = html('div', 'flex items-center gap-3 border-t border-gray-200 py-2');
      wrap.appendChild(html('span', ROW_LABEL_CLASS, index === 0 ? 'Hours' : ''));
      const slider = html('div', 'relative h-6 min-w-0 flex-1');
      const track = svg('svg', {
        class: 'absolute left-2 top-0 h-full w-[calc(100%-1rem)] overflow-visible',
        'aria-hidden': 'true'
      });
      track.appendChild(svg('rect', { x: 0, y: 10, width: '100%', height: 4, rx: 2, class: 'fill-gray-200' }));
      const night = svg('g', {});
      const fill = svg('rect', { x: 0, y: 10, width: 0, height: 4, rx: 2, class: 'fill-primary' });
      track.appendChild(night);
      track.appendChild(fill);
      const start = handle(index, 'start');
      const end = handle(index, 'end');
      slider.appendChild(track);
      slider.appendChild(start);
      slider.appendChild(end);
      wrap.appendChild(slider);
      const value = html('span', 'min-w-12 flex-none whitespace-nowrap text-right font-semibold');
      wrap.appendChild(value);
      if (state.rows.length > 1) {
        const removeClass = 'flex h-6 w-6 flex-none items-center justify-center rounded-full text-secondary';
        const remove = html('button', `${removeClass} hover:bg-gray-200 hover:text-gray-900`, '✕');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove hours ${index + 1}`);
        remove.addEventListener('click', () => onRemoveRow(index));
        wrap.appendChild(remove);
      }
      if (index === state.rows.length - 1) wrap.appendChild(el.addHours); // the round + ends the last row
      el.hoursRows.appendChild(wrap);
      return { start, end, fill, night, value };
    });
    updateRows();
    renderNight();
  }

  // A stored 07:30 keeps its text; its handle sits at the nearest whole hour until moved. Screen readers hear a clock
  // time (07:30, 16:00), not the slider's number.
  const clockText = text => (text.includes(':') ? text : `${text}:00`);

  function updateRow(index) {
    const row = state.rows[index];
    const view = state.rowViews[index];
    if (!row || !view) return;
    view.start.value = String(Math.round(row.startMin / 60));
    view.end.value = String(Math.round(row.endMin / 60));
    view.start.setAttribute('aria-valuetext', clockText(row.start));
    view.end.setAttribute('aria-valuetext', clockText(row.end));
    // The later input wins where the thumbs overlap; when the end can't move right, the start goes on top so it
    // never ends up buried under the end thumb.
    const next = state.rows[index + 1];
    const endStuck = row.endMin >= (next ? next.startMin : DAY_MIN);
    view.start.className = endStuck ? `${HANDLE_CLASS} z-10` : HANDLE_CLASS;
    view.fill.setAttribute('x', percent(row.startMin));
    view.fill.setAttribute('width', percent(row.endMin - row.startMin));
    view.value.textContent = `${row.start}–${row.end}`;
  }

  // Every row (a move changes its neighbours' limits) and whether one more hour is free.
  function updateRows() {
    state.rowViews.forEach((view, index) => updateRow(index));
    el.addHours.disabled = addRow(state.rows).length === state.rows.length;
  }

  function onAddRow() {
    const rows = addRow(state.rows);
    if (rows.length === state.rows.length) return undefined;
    state.rows = rows;
    buildHours(); // the + moved to the new last row: keep focus on it, or on the new row once nothing is free
    (el.addHours.disabled ? state.rowViews[state.rowViews.length - 1].start : el.addHours).focus();
    return commit({ hours: joinHours(rows) });
  }

  function onRemoveRow(index) {
    state.rows = removeRow(state.rows, index);
    buildHours();
    state.rowViews[Math.min(index, state.rowViews.length - 1)].start.focus(); // not back to <body>
    return commit({ hours: joinHours(state.rows) });
  }

  function minuteOfDay(iso, timeZone) {
    const [hour, minute] = Plan.formatClock(iso, timeZone).split(':').map(Number);
    return hour * 60 + minute;
  }

  // The chosen day's dark hours, hatched on every hours track; none before the first response.
  function renderNight() {
    const day = currentDay();
    const known = Boolean(day && day.sunrise && day.sunset);
    const timeZone = known ? state.body.location.timezone : null;
    const dark = [];
    if (known) {
      dark.push([0, minuteOfDay(day.sunrise, timeZone)]);
      dark.push([minuteOfDay(day.sunset, timeZone), DAY_MIN]);
    }
    state.rowViews.forEach(view => {
      view.night.replaceChildren();
      dark
        .filter(([from, to]) => to > from)
        .forEach(([from, to]) => {
          const rect = svg('rect', { x: percent(from), y: 5, width: percent(to - from), height: 14, rx: 3 });
          rect.setAttribute('fill', 'url(#night-hatch)');
          view.night.appendChild(rect);
        });
    });
    el.darkTimes.hidden = !known;
    el.darkTimes.textContent = known
      ? `▨ ${Plan.formatClock(day.sunset, timeZone)}–${Plan.formatClock(day.sunrise, timeZone)}`
      : '';
  }

  function setDay(index) {
    state.dayIndex = index;
    state.selected = null;
    el.dayToday.setAttribute('aria-pressed', String(index === 0));
    el.dayTomorrow.setAttribute('aria-pressed', String(index === 1));
    render();
  }

  // ---- Input: a route file or the device's location

  function renderSource() {
    const known = Boolean(state.location);
    el.sourceSet.hidden = !known;
    el.sourcePick.hidden = known;
    el.source.textContent = state.summary ? state.summary.name || 'Route' : known ? 'Near you' : '';
    el.sourceDistance.textContent = state.summary ? `· ${state.summary.distanceKm.toFixed(1)} km` : '';
  }

  function openRouteText(text, fileName) {
    const parsed = parseRoute(String(text), String(fileName || ''), window.DOMParser);
    if (!parsed.ok) return setStatus(MESSAGES[parsed.reason] || MESSAGES.unreadable);
    state.summary = summarizeRoute(parsed.route);
    state.location = { lat: state.summary.start.lat, lon: state.summary.start.lon };
    render();
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
        state.location = { lat: round2(position.coords.latitude), lon: round2(position.coords.longitude) };
        render();
        refresh();
      },
      () => setStatus(MESSAGES.locationOff),
      { maximumAge: 10 * 60 * 1000, timeout: 15000 }
    );
  }

  // ✕ forgets the route or location and drops any answer still on its way.
  function onClearSource() {
    state.summary = null;
    state.location = null;
    state.body = null;
    state.selected = null;
    state.request++;
    setStatus('');
    render();
  }

  // ---- A route shared from the share sheet: sw.js put it in the Cache API and opened /?share=1.

  async function readSharedRoute() {
    const cache = await caches.open(SHARE_CACHE);
    const response = await cache.match(SHARE_KEY);
    if (!response) return null;
    const text = await response.text();
    const fileName = decodeURIComponent(response.headers.get('X-File-Name') || '');
    return { text, fileName };
  }

  async function deleteSharedRoute() {
    try {
      if ('caches' in window) await caches.delete(SHARE_CACHE);
    } catch {
      // no Cache API here: nothing was stored either
    }
  }

  // Every load clears the hand-off once read, or unread (a share whose redirected page never loaded), so a shared
  // route never lingers on the device.
  async function receiveShare() {
    const share = new URLSearchParams(location.search).get('share');
    if (share !== '1') {
      await deleteSharedRoute();
      if (share === null) return undefined;
    }
    history.replaceState(null, '', '/'); // before reading, so a reload never replays the share
    let shared = null;
    if (share === '1') {
      try {
        shared = 'caches' in window ? await readSharedRoute() : null;
      } catch {
        shared = null;
      }
      await deleteSharedRoute(); // read once, gone
    }
    if (share === 'too-large') return setStatus(MESSAGES['too-large']);
    if (!shared) return setStatus(MESSAGES.shareFailed);
    return openRouteText(shared.text, shared.fileName);
  }

  function registerWorker() {
    try {
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    } catch {
      // not available here (an insecure context or blocked storage): the file picker still works
    }
  }

  // ---- The request

  async function refresh() {
    if (!state.location) return undefined; // the prompt already asks for a route or location
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

  function drawTicks(slots, step, timeZone) {
    Strip.ticks(slots, timeZone).forEach(({ index, label }) => {
      const x = Math.min(index * step, step * slots.length - 12);
      const text = svg('text', { x: x.toFixed(1), y: TIMELINE_HEIGHT - 3, class: 'fill-gray-400 text-[10px]' });
      text.textContent = label;
      el.timeline.appendChild(text);
    });
  }

  function drawGaps(target, gaps, step, from, to, attributes) {
    gaps.forEach(index => {
      const x = (index * step).toFixed(1);
      target.appendChild(svg('line', { x1: x, x2: x, y1: from, y2: to, ...attributes }));
    });
  }

  function drawGraph(model, step) {
    const graph = svg('g', { transform: `translate(0 ${PLOT_TOP})` });
    model.dark.forEach(run => {
      graph.appendChild(svg('rect', { x: run.x, y: 0, width: run.width, height: PLOT_HEIGHT, class: 'fill-gray-200' }));
    });
    if (model.window) {
      const { x, width } = model.window;
      graph.appendChild(svg('rect', { x, y: 0, width, height: PLOT_HEIGHT, class: 'fill-emerald-50' }));
    }
    model.rain.forEach(bar => {
      const attributes = { x: bar.x, y: bar.y, width: Math.max(1, bar.width - 1), height: bar.height };
      graph.appendChild(svg('rect', { ...attributes, class: 'fill-blue-300' }));
    });
    if (model.feels) {
      graph.appendChild(svg('path', { d: model.feels, class: 'fill-none stroke-red-600', 'stroke-width': 2 }));
    }
    if (model.wind) {
      graph.appendChild(
        svg('path', { d: model.wind, class: 'fill-none stroke-blue-700', 'stroke-width': 2, 'stroke-dasharray': '4 3' })
      );
    }
    const dashed = { class: 'stroke-gray-300', 'stroke-width': 1.5, 'stroke-dasharray': '3 3' };
    drawGaps(graph, model.gaps, step, 0, PLOT_HEIGHT, dashed);
    el.timeline.appendChild(graph);
  }

  // One SVG: the strip band on top, the graph under it on the same x axis, one outline through both.
  function drawTimeline(slots, range, fallback, timeZone) {
    const width = widthOf(el.timeline);
    const step = width / slots.length;
    const model = Strip.chartModel(slots, { width, height: PLOT_HEIGHT, range });
    el.timeline.replaceChildren();
    el.timeline.setAttribute('viewBox', `0 0 ${width} ${TIMELINE_HEIGHT}`);
    el.timeline.setAttribute('width', width);
    Strip.shadeClasses(slots).forEach((className, index) => {
      const cell = { x: (index * step).toFixed(1), y: 0, width: (step + 0.5).toFixed(1), height: BAND_HEIGHT };
      el.timeline.appendChild(svg('rect', { ...cell, class: className }));
    });
    drawGaps(el.timeline, model.gaps, step, 0, BAND_HEIGHT, { class: 'stroke-white', 'stroke-width': 3 });
    drawGraph(model, step);
    if (range) {
      const outline = {
        x: (range.first * step + 1).toFixed(1),
        y: 1,
        width: Math.max(2, (range.last - range.first + 1) * step - 2).toFixed(1),
        height: PLOT_TOP + PLOT_HEIGHT - 2,
        rx: 6,
        class: 'fill-none stroke-primary',
        'stroke-width': 2
      };
      if (fallback) outline['stroke-dasharray'] = '6 4';
      el.timeline.appendChild(svg('rect', outline));
    }
    if (state.selected !== null) {
      const x = ((state.selected + 0.5) * step).toFixed(1);
      el.timeline.appendChild(
        svg('line', { x1: x, x2: x, y1: 0, y2: PLOT_TOP + PLOT_HEIGHT, class: 'stroke-primary', 'stroke-width': 1.5 })
      );
    }
    drawTicks(slots, step, timeZone);
  }

  function renderKeyNumbers(numbers) {
    el.keyNumbers.replaceChildren();
    numbers.forEach(({ label, value }) => {
      const item = html('div');
      item.appendChild(html('dt', 'text-[11px] text-secondary', label));
      item.appendChild(html('dd', 'text-base font-semibold', value));
      el.keyNumbers.appendChild(item);
    });
    el.keyNumbers.hidden = numbers.length === 0;
  }

  // The tap line is announced (aria-live) and the timeline's label names the selected slot, so the slot is labelled
  // when tapped or reached with the arrow keys. With nothing selected the label is the answer.
  function renderTapLine(slots, timeZone, label) {
    if (state.selected === null || !slots[state.selected]) {
      el.tapLine.textContent = TAP_HINT;
      el.timeline.setAttribute('aria-label', label);
      return;
    }
    const line = Strip.slotLine(slots[state.selected], timeZone);
    el.tapLine.textContent = line;
    el.timeline.setAttribute('aria-label', line);
  }

  // Today has no window: what tomorrow holds for the same run, or null.
  function tomorrowHint(minutes, timeZone) {
    const tomorrow = state.body.days[1];
    return tomorrow ? Plan.tomorrowHint(Plan.pickResult(tomorrow, minutes), { minutes, timeZone }) : null;
  }

  function renderAnswer(day, timeZone, dayLabel) {
    const minutes = runMinutes();
    const result = Plan.pickResult(day, minutes);
    const none = result.kind === 'none';
    el.answer.hidden = false;
    el.answerLabel.textContent = Plan.answerLabel(result, minutes);
    el.answerLabel.hidden = none;
    el.answerTime.textContent = none
      ? Plan.noWindowText(minutes, dayLabel)
      : Plan.answerTime(result, { minutes, timeZone });
    el.answerTime.className = none ? 'text-xl font-semibold' : 'text-3xl font-bold tracking-tight';
    renderKeyNumbers(Plan.keyNumbers(result, state.summary, minutes));
    el.windLine.hidden = !result.window;
    el.windText.textContent = result.window ? Plan.windLine(state.summary, result.window) : '';
    const arrow = result.window ? Plan.windArrowDeg(result.window) : null;
    el.windCompass.hidden = arrow === null; // no arrow in little wind
    el.windArrow.setAttribute('transform', `rotate(${arrow || 0} 14 14)`);
    const hint = none && state.dayIndex === 0 ? tomorrowHint(minutes, timeZone) : null;
    el.tomorrowHint.hidden = !hint;
    el.tomorrowText.textContent = hint || '';
    const stale = Plan.staleNote(state.body);
    el.staleNote.hidden = !stale;
    el.staleNote.textContent = stale || '';
    return { result, minutes, text: `${el.answerLabel.textContent} ${el.answerTime.textContent}`.trim() };
  }

  function render() {
    renderSource();
    renderRunRow();
    renderDark();
    renderNight();
    const day = state.location ? currentDay() : null;
    el.prompt.hidden = Boolean(state.location);
    if (!day) {
      el.answer.hidden = true;
      el.result.hidden = true;
      el.zoneNote.hidden = true;
      return;
    }
    const timeZone = state.body.location.timezone;
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zone = Plan.zoneNote(timeZone, deviceZone, Date.now());
    el.zoneNote.hidden = !zone;
    el.zoneNote.textContent = zone || '';

    const dayLabel = state.dayIndex === 0 ? 'today' : 'tomorrow';
    const { result, minutes, text } = renderAnswer(day, timeZone, dayLabel);
    const slots = day.slots || [];
    const range = outlineRange(slots, result, minutes);
    const label = `Timeline, ${dayLabel}: ${text}`;
    el.result.hidden = false;
    el.timeline.setAttribute('aria-label', label);

    if (slots.length === 0) {
      el.timeline.replaceChildren();
      el.whySentence.textContent = '';
      el.tapLine.textContent = 'No hours to show for this day.';
      return;
    }
    drawTimeline(slots, range, result.kind === 'fallback', timeZone);
    el.whySentence.textContent = Strip.whySentence(slots, range, { timeZone, sunsetIso: day.sunset });
    renderTapLine(slots, timeZone, label);
  }

  // ---- Exploring the timeline: tap or arrow keys. It never moves the outline.

  function select(index) {
    const day = currentDay();
    if (!day || !day.slots || day.slots.length === 0) return;
    state.selected = Math.max(0, Math.min(day.slots.length - 1, index));
    render();
  }

  function onTimelineClick(event) {
    const day = currentDay();
    if (!day || !day.slots || day.slots.length === 0) return;
    const box = el.timeline.getBoundingClientRect();
    select(Math.floor(((event.clientX - box.left) / box.width) * day.slots.length));
  }

  function onTimelineKey(event) {
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

  // ---- The API and Privacy dialogs: ✕, Escape (native) or a click on the backdrop closes them.

  function wireDialog(opener, dialog, closer) {
    opener.addEventListener('click', () => dialog.showModal());
    closer.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
  }

  let resizeFrame = null;
  function onResize() {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      render();
    });
  }

  el.paceDown.addEventListener('click', () => stepPace(-PACE_STEP));
  el.paceUp.addEventListener('click', () => stepPace(PACE_STEP));
  el.paceInput.addEventListener('change', onPaceTyped);
  el.durationDown.addEventListener('click', () => stepDuration(-DURATION_STEP));
  el.durationUp.addEventListener('click', () => stepDuration(DURATION_STEP));
  el.addHours.addEventListener('click', onAddRow);
  el.darkOk.addEventListener('click', () => commit({ allowDark: !state.settings.allowDark }));
  el.rainInput.addEventListener('input', () => showRain(Number(el.rainInput.value)));
  el.rainInput.addEventListener('change', () => commit({ rain: Number(el.rainInput.value) }));
  el.dayToday.addEventListener('click', () => setDay(0));
  el.dayTomorrow.addEventListener('click', () => setDay(1));
  el.tryTomorrow.addEventListener('click', () => {
    setDay(1);
    el.dayTomorrow.focus(); // the button hides with the switch
  });
  el.routeInput.addEventListener('change', onFileChosen);
  el.useLocation.addEventListener('click', onUseLocation);
  el.clearSource.addEventListener('click', onClearSource);
  el.timeline.addEventListener('click', onTimelineClick);
  el.timeline.addEventListener('keydown', onTimelineKey);
  el.copyLink.addEventListener('click', onCopyLink);
  wireDialog(el.openApi, el.apiDialog, el.closeApi);
  wireDialog(el.openPrivacy, el.privacyDialog, el.closePrivacy);
  window.addEventListener('resize', onResize);
  el.rainInput.value = String(state.settings.rain); // set once: a late render never moves a slider being dragged
  showRain(state.settings.rain);
  buildHours();
  render();
  registerWorker();
  receiveShare();

  globalThis.RunApp = { openRouteText };
})();
