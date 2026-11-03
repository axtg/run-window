const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const PRIVATE = path.join(FIXTURES, 'private');
const SYNTHETIC_DIRS = ['tredict', 'trmnl'].map(dir => path.join(FIXTURES, dir));
const COORDINATE_KEYS = { positionLat: 52.37, lat: 52.37, positionLong: 4.89, lon: 4.89 };
const TWINS = ['planned', 'activities', 'efforts'];

const listJson = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.json')) : []);
// A fixed message naming the file only: a SyntaxError's text quotes the content, which may be private
function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Not valid JSON: ${path.basename(file)}`);
  }
}
const syntheticFiles = SYNTHETIC_DIRS.flatMap(dir => listJson(dir).map(name => path.join(dir, name)));

const normalize = key => (/^\d{8}$/.test(key) ? '*' : key);

// Map of "path" to the set of value types found there; array indices and YYYYMMDD keys become "*"
function shapeOf(value, prefix = '', shape = new Map()) {
  if (Array.isArray(value)) {
    value.forEach(item => shapeOf(item, `${prefix}/*`, shape));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) shapeOf(item, `${prefix}/${normalize(key)}`, shape);
  } else {
    const type = value === null ? 'null' : typeof value;
    if (!shape.has(prefix)) shape.set(prefix, new Set());
    shape.get(prefix).add(type);
  }
  return shape;
}

function collect(value, visit) {
  if (Array.isArray(value)) value.forEach(item => collect(item, visit));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      visit(key, item);
      collect(item, visit);
    }
  }
}

describe('readJson', () => {
  it('names only the file when the JSON is malformed', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-fixture-'));
    try {
      const file = path.join(scratch, 'efforts.json');
      fs.writeFileSync(file, '{"secretValue": 52.37,');
      let thrown;
      try {
        readJson(file);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toBe('Error: Not valid JSON: efforts.json');
      expect(thrown.cause).toBeUndefined();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('synthetic fixtures', () => {
  it('exist', () => {
    const names = listJson(path.join(FIXTURES, 'tredict')).sort();
    expect(names).toEqual([
      'activities-dst.json',
      'activities-week.json',
      'efforts-week.json',
      'planned-dst.json',
      'planned-week.json'
    ]);
  });

  it.each(syntheticFiles.map(file => [path.relative(FIXTURES, file), file]))(
    '%s holds no bearer, token or e-mail address',
    (name, file) => {
      const text = fs.readFileSync(file, 'utf8');
      expect(text).not.toMatch(/bearer/i);
      expect(text).not.toMatch(/token/i);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    }
  );

  it.each(syntheticFiles.map(file => [path.relative(FIXTURES, file), file]))(
    '%s keeps every coordinate at Amsterdam centre',
    (name, file) => {
      const bad = [];
      collect(readJson(file), (key, value) => {
        if (key in COORDINATE_KEYS && !(Math.abs(value - COORDINATE_KEYS[key]) <= 0.01)) bad.push(key);
      });
      expect(bad).toEqual([]);
    }
  );
});

const hasPrivate = TWINS.every(name => fs.existsSync(path.join(PRIVATE, `${name}.json`)));
const describePrivate = hasPrivate ? describe : describe.skip;

describePrivate('synthetic fixtures against the private responses', () => {
  const synthetic = {
    planned: ['planned-week.json', 'planned-dst.json'],
    activities: ['activities-week.json', 'activities-dst.json'],
    efforts: ['efforts-week.json']
  };

  it.each(TWINS)('%s has the same key paths and value types', name => {
    const real = shapeOf(readJson(path.join(PRIVATE, `${name}.json`)));
    const mismatches = new Set();
    for (const file of synthetic[name]) {
      const fake = shapeOf(readJson(path.join(FIXTURES, 'tredict', file)));
      for (const [pathKey, types] of fake) {
        const realTypes = real.get(pathKey);
        if (!realTypes) mismatches.add(`only in ${file}: ${pathKey}`);
        else for (const type of types) if (!realTypes.has(type)) mismatches.add(`type in ${file}: ${pathKey}`);
      }
    }
    expect([...mismatches]).toEqual([]);
  });

  it('shares no id, title or executedTrainingId value with the private files', () => {
    const real = new Set();
    for (const name of TWINS) {
      collect(readJson(path.join(PRIVATE, `${name}.json`)), (key, value) => {
        if (['id', 'title', 'executedTrainingId'].includes(key) && typeof value === 'string') real.add(value);
      });
    }
    let clashes = 0;
    for (const file of syntheticFiles) {
      collect(readJson(file), (key, value) => {
        if (['id', 'title', 'executedTrainingId'].includes(key) && real.has(value)) clashes += 1;
      });
    }
    expect(clashes).toBe(0);
  });
});
