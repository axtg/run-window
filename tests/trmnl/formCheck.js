// Local check, not a Jest test: compares formSeries with Tredict's own performance series.
// Usage: node tests/trmnl/formCheck.js [--today YYYY-MM-DD]
// Reads tests/fixtures/private/efforts.json and form-from-app.json (both git-ignored). Prints no values.
const fs = require('fs');
const path = require('path');
const { formSeries } = require('../../integrations/trmnl-running-board/src/form');

const dir = path.join(__dirname, '..', 'fixtures', 'private');
const effortsFile = path.join(dir, 'efforts.json');
const appFile = path.join(dir, 'form-from-app.json');

if (!fs.existsSync(effortsFile) || !fs.existsSync(appFile)) {
  console.log('Private fixtures efforts.json and form-from-app.json not found; nothing to check.');
  process.exit(0);
}

const flag = process.argv.indexOf('--today');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const efforts = read(effortsFile).trainingEfforts || read(effortsFile);
const app = read(appFile);
const dates = Object.keys(app).sort();
const now = new Date().toISOString().slice(0, 10);
const today = flag !== -1 ? process.argv[flag + 1] : dates.filter(date => date <= now).pop();

const dayMs = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);
const back = Math.max(0, daysBetween(dates[0], today));
const ahead = Math.max(0, daysBetween(today, dates[dates.length - 1]));
const series = formSeries({ efforts, today, back, ahead });
const ours = new Map(series.points.map(point => [point.date, Math.round(point.form) || 0]));

let matches = 0;
let maxDiff = 0;
const differing = [];
for (const date of dates) {
  const diff = (ours.get(date) ?? NaN) - app[date];
  if (diff === 0) matches += 1;
  else differing.push(`${date} ${Number.isNaN(diff) ? 'missing' : diff}`);
  if (!Number.isNaN(diff)) maxDiff = Math.max(maxDiff, Math.abs(diff));
}
console.log(`dates: ${dates.length}, exact matches: ${matches}, max abs difference: ${maxDiff}`);
if (differing.length > 0) console.log(`differ: ${differing.join(', ')}`);
