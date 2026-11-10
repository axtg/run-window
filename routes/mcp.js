const express = require('express');
const { createMcpHandler, McpServer } = require('@modelcontextprotocol/server');
const { toNodeHandler } = require('@modelcontextprotocol/node');
const { formatInTimeZone } = require('date-fns-tz');
const { z } = require('zod');

const { buildWindowBody } = require('../lib/windowResponse');
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
  'Finds the best time to run outdoors today or tomorrow from the weather forecast: the driest, calmest, most',
  'comfortable stretch within the hours someone can run, and which way to start so the wind is behind them on the',
  "way back. It needs where the run starts: if you don't know the user's town, ask for it, then pass its",
  'coordinates (they are rounded to about 1 km). Times are local to that place. Weather data by Open-Meteo.com',
  '(CC BY 4.0): mention it when you show results.'
].join(' ');

const place = {
  latitude: z.number().min(-90).max(90).describe('Latitude of where the run starts. Rounded to 2 decimals (~1 km).'),
  longitude: z.number().min(-180).max(180).describe('Longitude of where the run starts. Rounded to 2 decimals.')
};

const preferences = {
  day: z.enum(['today', 'tomorrow']).default('today').describe('The day to look at. Today skips times already past.'),
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
    .describe('What bothers the user most: wind, rain or temp count three times in the score. balanced weighs all.')
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

function dayContext(body, day) {
  const { timezone, lat, lon } = body.location;
  return {
    location: { latitude: lat, longitude: lon, timezone },
    date: day.date,
    sunrise: day.sunrise ? clock(day.sunrise, timezone) : null,
    sunset: day.sunset ? clock(day.sunset, timezone) : null,
    hours: body.params.avail,
    ...(body.warnings && { warnings: body.warnings }),
    attribution: body.attribution
  };
}

const pickDay = (body, day) => body.days[day === 'tomorrow' ? 1 : 0];

async function findBestRunTime(args, { weather, now }) {
  const body = await buildWindowBody({ query: windowQuery(args), weather, now });
  const day = pickDay(body, args.day);
  const minutes = Math.ceil(args.minutes / SLOT_MINUTES) * SLOT_MINUTES;
  const { timezone } = body.location;
  const window = day.windows[String(minutes)];
  if (window) {
    return {
      available: true,
      day: args.day,
      minutes,
      ...dayContext(body, day),
      window: describeWindow(window, timezone)
    };
  }

  const limits = `${body.params.rain} % chance of rain${body.params.dark === 'avoid' ? ', in daylight' : ''}`;
  return {
    available: false,
    day: args.day,
    minutes,
    reason: `No ${minutes}-minute stretch ${args.day} within ${body.params.avail} stays within ${limits}.`,
    tryNext: 'Another day, more hours, a shorter run, darkOk or a higher maxRainChance.',
    // The API's least bad hour, rain no longer ruling slots out, when no dry hour exists at all
    ...(day.fallback && { leastBadHour: describeWindow(day.fallback, timezone) }),
    ...dayContext(body, day)
  };
}

async function getRunConditions(args, { weather, now }) {
  const body = await buildWindowBody({ query: windowQuery(args, { slots: true }), weather, now });
  const day = pickDay(body, args.day);
  const { timezone } = body.location;
  return {
    day: args.day,
    ...dayContext(body, day),
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

function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
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
      return toolResult(await handler(args, context));
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
          'Find the best time to run today or tomorrow: the stretch of the given length with the best weather ' +
          'within the hours the user can run, never in the past. Returns its local start and end, the conditions ' +
          '(rain, feels-like temperature, wind) and which way to start. When nothing fits, says why.',
        inputSchema: bestTimeInput,
        annotations: READ_ONLY
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
function createMcpRouter({ weather, now }) {
  const handler = toNodeHandler(
    createMcpHandler(createServerFactory({ weather, now }), { responseMode: 'json', maxSubscriptions: 0 })
  );
  const run = (req, res, next) => handler(req, res, req.body).catch(next);
  return [express.json({ limit: MAX_REQUEST_BYTES }), refuseBatches, run];
}

module.exports = { createMcpRouter, INSTRUCTIONS };
