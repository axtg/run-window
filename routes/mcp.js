const express = require('express');
const { createMcpHandler, McpServer } = require('@modelcontextprotocol/server');
const { toNodeHandler } = require('@modelcontextprotocol/node');
const { formatInTimeZone } = require('date-fns-tz');
const { z } = require('zod');

const { VIEW_MIME_TYPE, VIEW_URI, viewHtml } = require('../lib/mcpView');
const { placeLabel } = require('../lib/geocoding');
const { buildWindowBody } = require('../lib/windowResponse');
const { VIEW_META_KEY } = require('../mcp-view/day');
const Plan = require('../public/plan');
const { PREFERENCES, cardinal } = require('../lib/windows');
const { logError } = require('../middleware/logging');
const { version } = require('../package.json');

const MAX_REQUEST_BYTES = 64 * 1024;
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const SLOT_MINUTES = 15;
const LITTLE_WIND_KMH = 10; // as on the page: below this there is no direction worth starting into
const DRY_MAX_PROBABILITY = 20; // as lib/labels.js: "dry" needs a low chance as well as a window within the limit
const CARDINAL_NAMES = {
  N: 'north',
  NE: 'north-east',
  E: 'east',
  SE: 'south-east',
  S: 'south',
  SW: 'south-west',
  W: 'west',
  NW: 'north-west'
};

// One paragraph: the hard line breaks of a template literal would reach the client as they are.
const INSTRUCTIONS = [
  'Finds the best time to run outdoors today, tomorrow or the day after from the weather forecast: the driest,',
  'calmest, most comfortable stretch within the hours someone can run, and which way to start so the wind is behind',
  "them on the way back. It needs where the run starts: if you don't know the user's town, ask for it, then pass its",
  'coordinates (rounded to about 1 km) or its name as place, which the server looks up; check the place it names.',
  'Times are local to that place. Weather data by Open-Meteo.com (CC BY 4.0): mention it when you show results.'
].join(' ');

const place = {
  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe('Latitude of where the run starts, with longitude. Rounded to 2 decimals (~1 km).'),
  longitude: z.number().min(-180).max(180).optional().describe('Longitude of where the run starts, with latitude.'),
  place: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Instead of coordinates: a town or city, such as 'Utrecht' or 'Bergen, Norway'. The answer names the place " +
        'it found (location.name) and other matches, so check it is the right one.'
    )
};

const preferences = {
  day: z
    .string()
    .regex(/^(today|tomorrow|\d{4}-\d{2}-\d{2})$/, "Use 'today', 'tomorrow' or a date as YYYY-MM-DD")
    .default('today')
    .describe(
      "The day to look at: 'today', 'tomorrow' or a local date (YYYY-MM-DD) up to two days ahead, such as " +
        "Thursday's when it is Tuesday. Today skips times already past. Further out the forecast shifts too much."
    ),
  hours: z
    .string()
    .max(100)
    .optional()
    .describe(
      "Local time ranges the user can run, comma-separated: '07-09,17-21' or '07:30-09:15'. Leave it out for 06-22."
    ),
  darkOk: z.boolean().default(false).describe('Allow times before sunrise or after sunset.'),
  maxRainChance: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(40)
    .describe('Highest chance of rain (%) allowed in any part of the run.'),
  mindMost: z
    .enum(PREFERENCES)
    .default('balanced')
    .describe(
      'What bothers the user most. It decides first: wind gives the calmest times, rain the driest, temp the most ' +
        'comfortable, even if worse on the rest. balanced weighs all three.'
    )
};

const bestTimeInput = z.object({
  ...place,
  minutes: z
    .number()
    .int()
    .min(1)
    .max(180)
    .default(60)
    .describe('How long the run takes, in minutes. Rounded up to a multiple of 15.'),
  ...preferences
});

const conditionsInput = z.object({ ...place, ...preferences });

// The query /api/window takes, so both validate and score the same way
function windowQuery({ latitude, longitude, hours, darkOk, maxRainChance, mindMost }, { slots = false } = {}) {
  return {
    lat: String(latitude),
    lon: String(longitude),
    ...(hours !== undefined && { avail: hours.replace(/\s+/g, '') }),
    dark: darkOk ? 'ok' : 'avoid',
    rain: String(maxRainChance),
    prefer: mindMost,
    ...(slots && { slots: '1' })
  };
}

const localTime = (iso, timezone) => formatInTimeZone(new Date(iso), timezone, "yyyy-MM-dd'T'HH:mmxxx");
const clock = (iso, timezone) => formatInTimeZone(new Date(iso), timezone, 'HH:mm');

function startAdvice(window) {
  if (window.windAvg < LITTLE_WIND_KMH) return 'Little wind: any direction will do.';
  const from = CARDINAL_NAMES[window.windFromCardinal];
  return `Wind from the ${from}: start ${from}, into it, so it is behind you on the way back.`;
}

function describeWindow(window, timezone) {
  return {
    start: localTime(window.start, timezone),
    end: localTime(window.end, timezone),
    dry: window.qualifies && window.precipProbMax <= DRY_MAX_PROBABILITY,
    rainChanceMax: window.precipProbMax,
    rainMm: window.precipSum,
    feelsLikeC: Math.round(window.apparentTempAvg) || 0, // `|| 0` turns -0 into 0
    windKmh: window.windAvg,
    gustKmh: window.gustMax,
    windFrom: CARDINAL_NAMES[window.windFromCardinal],
    startDirection: startAdvice(window),
    inDaylight: window.inDaylight,
    summary: window.label
  };
}

function dayContext(body, picked, where = {}) {
  const { day } = picked;
  const { timezone, lat, lon } = body.location;
  const note = Plan.outlookNote(picked.index);
  const found = where.name ? { name: where.name, ...(where.otherMatches && { otherMatches: where.otherMatches }) } : {};
  return {
    location: { ...found, latitude: lat, longitude: lon, timezone },
    date: day.date,
    sunrise: day.sunrise ? clock(day.sunrise, timezone) : null,
    sunset: day.sunset ? clock(day.sunset, timezone) : null,
    hours: body.params.avail,
    ...(note && { forecastNote: note }),
    ...(body.warnings && { warnings: body.warnings }),
    attribution: body.attribution
  };
}

const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });

// Coordinates as given, or the first match for a place name (with the other matches, to check against).
async function resolvePlace(args, places) {
  if (Number.isFinite(args.latitude) && Number.isFinite(args.longitude)) {
    return { latitude: args.latitude, longitude: args.longitude };
  }
  if (typeof args.place === 'string' && args.place.trim() !== '') {
    const found = await places.search(args.place);
    if (found.length === 0) {
      throw badRequest(`No place found for "${args.place.trim()}": try a larger town nearby, or give coordinates.`);
    }
    const [first, ...rest] = found;
    return {
      latitude: first.lat,
      longitude: first.lon,
      name: placeLabel(first),
      ...(rest.length > 0 && { otherMatches: rest.slice(0, 3).map(placeLabel) })
    };
  }
  throw badRequest('Give latitude and longitude, or a place.');
}

// The day asked for, with its place in the API's days (0 today, 1 tomorrow, 2 the day after).
function pickDay(body, day) {
  const index = { today: 0, tomorrow: 1 }[day] ?? body.days.findIndex(entry => entry.date === day);
  if (index === -1) {
    const dates = body.days.map(entry => entry.date).join(', ');
    throw Object.assign(new Error(`Invalid day: ${day} is not one of the days with a forecast here (${dates})`), {
      statusCode: 400
    });
  }
  return { day: body.days[index], index };
}

// Text that names the day: today, tomorrow, on Thursday.
const nameDay = picked => Plan.dayLabel(picked.index, picked.day.date);

// What the view (mcp-view/day.js) draws: the day's slots and the chosen window, in the API's own shape, so it can use
// the page's plan.js and strip.js unchanged. It goes in the result's `_meta`, which the model doesn't read.
function viewPayload(picked, minutes, timezone) {
  const apiDay = picked.day;
  const window = apiDay.windows[String(minutes)];
  return {
    dayIndex: picked.index,
    date: apiDay.date,
    minutes,
    timeZone: timezone,
    day: {
      sunrise: apiDay.sunrise,
      sunset: apiDay.sunset,
      windows: window ? { [String(minutes)]: window } : {},
      fallback: apiDay.fallback || null,
      slots: apiDay.slots || []
    }
  };
}

function whyNothingFits(slots, minutes, params, dayLabel) {
  const hours = params.avail;
  const why = Plan.noWindowCause(slots, minutes);
  if (why.cause === 'past') {
    return { reason: `All of ${hours} has already passed today.`, tryNext: 'Tomorrow, or later hours today.' };
  }
  if (why.cause === 'time') {
    const limits = [
      why.past && 'still ahead',
      why.dark && 'in daylight',
      why.missing && 'covered by the forecast'
    ].filter(Boolean);
    const stretch = limits.length > 0 ? `stretch that is ${limits.join(' and ')}` : 'stretch';
    const tries = [why.past && 'tomorrow', 'more hours', 'a shorter run', why.dark && 'darkOk'].filter(Boolean);
    const next = tries.join(', ');
    return {
      reason: `Not enough time: the longest ${stretch} within ${hours} ${dayLabel} is ${why.minutesLeft} minutes.`,
      tryNext: `${next.charAt(0).toUpperCase()}${next.slice(1)}.`
    };
  }
  return {
    reason:
      `Every ${minutes}-minute stretch within ${hours} ${dayLabel} is too wet: part of it has over ` +
      `${params.rain} % chance of rain, or rain expected.`,
    tryNext: 'Another day, more hours, a shorter run or a higher maxRainChance.'
  };
}

async function findBestRunTime(input, { weather, places, now }) {
  const where = await resolvePlace(input, places);
  const args = { ...input, ...where };
  const body = await buildWindowBody({ query: windowQuery(args, { slots: true }), weather, now });
  const picked = pickDay(body, args.day);
  const { day } = picked;
  const minutes = Math.ceil(args.minutes / SLOT_MINUTES) * SLOT_MINUTES;
  const { timezone } = body.location;
  const window = day.windows[String(minutes)];
  const view = viewPayload(picked, minutes, timezone);
  if (window) {
    const data = {
      available: true,
      day: args.day,
      minutes,
      ...dayContext(body, picked, where),
      window: describeWindow(window, timezone)
    };
    // The obvious follow-up to a run in the dark: the best one in daylight. The same forecast, from the cache.
    if (args.darkOk && !window.inDaylight) {
      const daylight = await buildWindowBody({ query: windowQuery({ ...args, darkOk: false }), weather, now });
      const best = daylight.days[picked.index].windows[String(minutes)];
      data.bestInDaylight = best ? describeWindow(best, timezone) : null;
    }
    return { data, view };
  }

  const data = {
    available: false,
    day: args.day,
    minutes,
    ...whyNothingFits(day.slots || [], minutes, body.params, nameDay(picked)),
    // The API's least bad hour, rain no longer ruling slots out, when no dry hour exists at all
    ...(day.fallback && { leastBadHour: describeWindow(day.fallback, timezone) }),
    ...dayContext(body, picked, where)
  };
  return { data, view };
}

async function getRunConditions(input, { weather, places, now }) {
  const where = await resolvePlace(input, places);
  const args = { ...input, ...where };
  const body = await buildWindowBody({ query: windowQuery(args, { slots: true }), weather, now });
  const picked = pickDay(body, args.day);
  const { day } = picked;
  const { timezone } = body.location;
  return {
    day: args.day,
    ...dayContext(body, picked, where),
    statuses: 'ok: runnable; rain: over maxRainChance; dark: outside daylight; past: already started; missing: no data',
    slots: day.slots.map(slot => ({
      time: clock(slot.start, timezone),
      status: slot.status,
      score: slot.score, // penalty points, lower is better
      feelsLikeC: slot.apparentTemp,
      windKmh: slot.windSpeed,
      gustKmh: slot.gust,
      windFrom: slot.windFrom === null ? null : CARDINAL_NAMES[cardinal(slot.windFrom)],
      rainChance: slot.precipProb,
      rainMm: slot.precip
    }))
  };
}

function toolResult(data, view) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], ...(view && { _meta: { [VIEW_META_KEY]: view } }) };
}

// Only this app's own 4xx messages and its 503s (capacity, weather unavailable) reach the client, as in app.js.
function toolError(error) {
  const status = error.statusCode || 500;
  const own = error.expose === true || (status < 500 && error.statusCode !== undefined);
  if (!own) logError(error);
  return { ...toolResult({ error: own ? error.message : 'Internal server error' }), isError: true };
}

// The SDK would return the message of any thrown error, and those can contain internal details.
function safely(handler, context) {
  return async args => {
    try {
      const result = await handler(args, context);
      return result.view ? toolResult(result.data, result.view) : toolResult(result);
    } catch (error) {
      return toolError(error);
    }
  };
}

function createServerFactory(context) {
  return () => {
    const server = new McpServer({ name: 'best-time-to-run', version }, { instructions: INSTRUCTIONS });

    server.registerTool(
      'find_best_run_time',
      {
        description:
          'Find the best time to run today, tomorrow or the day after: the stretch of the given length with the ' +
          'best weather within the hours the user can run, never in the past. Returns its local start and end, the ' +
          'conditions (rain, feels-like temperature, wind) and which way to start. With darkOk, a best time in the ' +
          'dark comes with the best daylight one (bestInDaylight, null when none fits). When nothing fits, says why.',
        inputSchema: bestTimeInput,
        annotations: READ_ONLY,
        // Hosts that show MCP Apps draw the answer and the day's timeline with it; both keys, as hosts read either.
        _meta: { ui: { resourceUri: VIEW_URI }, 'ui/resourceUri': VIEW_URI }
      },
      safely(findBestRunTime, context)
    );

    server.registerTool(
      'get_run_conditions',
      {
        description:
          "The day's forecast in 15-minute slots within the user's hours: feels-like temperature, wind, gusts, " +
          'chance and amount of rain, and a score (lower is better). For questions like "how does the evening look?".',
        inputSchema: conditionsInput,
        annotations: READ_ONLY
      },
      safely(getRunConditions, context)
    );

    server.registerResource(
      'day-view',
      VIEW_URI,
      {
        title: 'Best time to run: the day',
        description: 'The answer and the day timeline, as on besttimetorun.com. Loads and fetches nothing.',
        mimeType: VIEW_MIME_TYPE
      },
      async () => ({
        contents: [
          {
            uri: VIEW_URI,
            mimeType: VIEW_MIME_TYPE,
            text: viewHtml(),
            _meta: { ui: { csp: {}, prefersBorder: true } } // no network at all
          }
        ]
      })
    );

    return server;
  };
}

// A batch counts as one request for the rate limiter however many tool calls it holds.
function refuseBatches(req, res, next) {
  if (!Array.isArray(req.body)) return next();
  return res.status(400).json({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Batches are not supported.' }
  });
}

// A new server per request and no sessions. Current clients get plain JSON; the SDK answers 2025-era clients with a
// short event stream that closes after its one message. Listen streams would stay open indefinitely, and the tools
// never change, so maxSubscriptions refuses them all. JSON is parsed here only: the rest of the app has no body parser.
function createMcpRouter({ weather, places, now }) {
  const handler = toNodeHandler(
    createMcpHandler(createServerFactory({ weather, places, now }), { responseMode: 'json', maxSubscriptions: 0 })
  );
  const run = (req, res, next) => handler(req, res, req.body).catch(next);
  return [express.json({ limit: MAX_REQUEST_BYTES }), refuseBatches, run];
}

module.exports = { createMcpRouter, INSTRUCTIONS };
