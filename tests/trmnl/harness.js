const fs = require('fs');
const path = require('path');
const vm = require('vm');
const yaml = require('js-yaml');
const { Liquid } = require('liquidjs');

const PLUGIN_DIR = path.join(__dirname, '..', '..', 'integrations', 'trmnl-running-board');
const RANDOM_SUFFIX = '-test';

function loadSettings() {
  return yaml.load(fs.readFileSync(path.join(PLUGIN_DIR, 'settings.yml'), 'utf8'));
}

function createEngine() {
  const engine = new Liquid();
  // TRMNL's append_random adds a random suffix; a fixed one keeps the output stable
  engine.registerFilter('append_random', value => `${value}${RANDOM_SUFFIX}`);
  return engine;
}

// The polling URL is rendered with the custom fields as top-level names
function renderPollingUrl(fieldValues) {
  return createEngine().parseAndRender(loadSettings().polling_url, fieldValues || {});
}

const LAYOUTS = ['full', 'half_horizontal', 'half_vertical', 'quadrant'];

// TRMNL puts shared.liquid in front of each layout's markup
function layoutTemplate(layout) {
  const read = name => fs.readFileSync(path.join(PLUGIN_DIR, `${name}.liquid`), 'utf8');
  return `${read('shared')}\n${read(layout)}`;
}

// The screen is rendered with the transform output's keys as top-level names
function renderLayout(layout, output) {
  return createEngine().parseAndRender(layoutTemplate(layout), output || {});
}

const renderFull = output => renderLayout('full', output);

// Runs the built transform.js in a vm context. Date.now() and new Date() return the injected now;
// Date.parse, Date.UTC and new Date(arg) keep working. Compare results after a JSON round trip,
// since objects from the vm context fail toStrictEqual. `code` replaces the committed transform.js.
function loadTransform({ fetch, now, code }) {
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(now);
      } else {
        super(...args);
      }
    }

    static now() {
      return now;
    }
  }

  const context = vm.createContext({
    fetch,
    AbortSignal,
    Intl,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Date: FakeDate
  });
  const source = code ?? fs.readFileSync(path.join(PLUGIN_DIR, 'transform.js'), 'utf8');
  vm.runInContext(`${source}\n;run;`, context);
  return input => vm.runInContext('run', context)(input);
}

module.exports = { LAYOUTS, loadSettings, renderPollingUrl, layoutTemplate, renderLayout, renderFull, loadTransform };
