// Turns the API's per-slot list into the day strip's classes, ticks, tap line, chart model and "why" sentence.
// Runs in the browser and in the Jest tests.
(function () {
  const { formatClock } = typeof module !== 'undefined' ? require('./plan') : globalThis.RunPlan;

  const SHADES = ['fill-green-100', 'fill-green-300', 'fill-green-500', 'fill-green-700', 'fill-green-900'];
  const GREY = 'fill-gray-300';
  const RAIN = 'fill-red-300';
  const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const SLOT_MS = 15 * 60 * 1000;
  const TICK_EVERY_HOURS = 3;
  const PADDING = 0.1;
  const RAIN_BAND = 0.4;
  const WARMER_C = 1;
  const CALMER_KMH = 3;
  const SEP = ' · ';

  function cardinal(degrees) {
    const normalised = ((degrees % 360) + 360) % 360;
    return CARDINALS[Math.floor((normalised + 22.5) / 45) % 8];
  }

  const whole = value => Math.round(value) || 0; // `|| 0` turns -0 into 0
  const coord = value => String(Math.round(value * 100) / 100);
  const hasData = slot => slot.status !== 'missing' && slot.apparentTemp !== null;
  const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;

  function shadeClasses(slots) {
    const scores = slots.filter(s => s.status === 'ok').map(s => s.score);
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    return slots.map(slot => {
      if (slot.status === 'rain') return RAIN;
      if (slot.status !== 'ok') return GREY;
      const level = max === min ? 4 : Math.round((4 * (max - slot.score)) / (max - min));
      return SHADES[level];
    });
  }

  function rangeIndices(slots, startIso, endIso) {
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    let first = -1;
    let last = -1;
    slots.forEach((slot, index) => {
      const time = Date.parse(slot.start);
      if (time < start || time >= end) return;
      if (first === -1) first = index;
      last = index;
    });
    return first === -1 ? null : { first, last };
  }

  function ticks(slots, timeZone) {
    const result = [];
    slots.forEach((slot, index) => {
      const [hour, minute] = formatClock(slot.start, timeZone).split(':');
      if (minute === '00' && Number(hour) % TICK_EVERY_HOURS === 0) result.push({ index, label: hour });
    });
    return result;
  }

  function slotLine(slot, timeZone) {
    const clock = formatClock(slot.start, timeZone);
    if (slot.status === 'missing') return `${clock}${SEP}no data`;
    const parts = [
      clock,
      `feels ${whole(slot.apparentTemp)} °C`,
      `wind ${whole(slot.windSpeed)} km/h ${cardinal(slot.windFrom)}`,
      `rain ${whole(slot.precipProb)} %`
    ];
    if (slot.status !== 'ok') parts.push(slot.status);
    return parts.join(SEP);
  }

  // One SVG path over the slots, scaled min..max with padding, broken (new M) across slots without a value.
  function linePath(slots, key, step, height) {
    const values = slots.filter(hasData).map(s => s[key]);
    if (values.length === 0) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * PADDING;
    const low = min - pad;
    const span = max - min + 2 * pad;
    let path = '';
    let pen = false;
    slots.forEach((slot, index) => {
      if (!hasData(slot)) {
        pen = false;
        return;
      }
      const y = span === 0 ? height / 2 : height - ((slot[key] - low) / span) * height;
      path += `${pen ? 'L' : 'M'}${coord(index * step)} ${coord(y)}`;
      pen = true;
    });
    return path;
  }

  function darkRuns(slots, step) {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= slots.length; i++) {
      const dark = i < slots.length && slots[i].inDaylight === false;
      if (dark && start === -1) start = i;
      if (!dark && start !== -1) {
        runs.push({ x: start * step, width: (i - start) * step });
        start = -1;
      }
    }
    return runs;
  }

  function chartModel(slots, { width, height, range }) {
    if (slots.length === 0) return { feels: '', wind: '', rain: [], window: null, dark: [] };
    const step = width / slots.length;
    const rain = [];
    slots.forEach((slot, index) => {
      if (!hasData(slot)) return;
      const barHeight = (slot.precipProb / 100) * RAIN_BAND * height;
      rain.push({ x: index * step, y: height - barHeight, width: step, height: barHeight });
    });
    return {
      feels: linePath(slots, 'apparentTemp', step, height),
      wind: linePath(slots, 'windSpeed', step, height),
      rain,
      window: range ? { x: range.first * step, width: (range.last - range.first + 1) * step } : null,
      dark: darkRuns(slots, step)
    };
  }

  function whySentence(slots, range, { timeZone, sunsetIso } = {}) {
    if (!range) return '';
    const inside = slots.slice(range.first, range.last + 1).filter(hasData);
    const outside = slots.filter((s, i) => (i < range.first || i > range.last) && s.status === 'ok');
    let first;
    if (outside.length === 0 || inside.length === 0) {
      first = 'The only dry stretch of the day.';
    } else {
      const warmer = mean(inside.map(s => s.apparentTemp)) - mean(outside.map(s => s.apparentTemp)) >= WARMER_C;
      const calmer = mean(outside.map(s => s.windSpeed)) - mean(inside.map(s => s.windSpeed)) >= CALMER_KMH;
      if (warmer && calmer) first = 'Warmer and less windy than the rest of the day.';
      else if (warmer) first = 'Warmer than the rest of the day.';
      else if (calmer) first = 'Less windy than the rest of the day.';
      else first = 'Similar all day; this is the earliest good time.';
    }

    const notes = [];
    const rainSlot = slots.slice(range.last + 1).find(s => s.status === 'rain');
    if (rainSlot) notes.push(`rain from ${formatClock(rainSlot.start, timeZone)}`);
    if (sunsetIso && slots.length > 0) {
      const sunset = Date.parse(sunsetIso);
      const rangeEnd = Date.parse(slots[range.last].start) + SLOT_MS;
      const spanEnd = Date.parse(slots[slots.length - 1].start) + SLOT_MS;
      if (sunset >= rangeEnd && sunset < spanEnd) notes.push(`dark from ${formatClock(sunsetIso, timeZone)}`);
    }
    if (notes.length === 0) return first;
    const text = notes.join(', ');
    return `${first} ${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }

  const api = { SHADES, GREY, RAIN, shadeClasses, rangeIndices, ticks, slotLine, chartModel, whySentence };

  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.DayStrip = api;
})();
