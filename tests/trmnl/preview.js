// Writes one 800x480 HTML page per render case, for checking the screen in a browser.
// Usage: node tests/trmnl/preview.js <outDir>
const fs = require('fs');
const path = require('path');
const { renderFull } = require('./harness');
const { renderCases } = require('./renderCases');

const FRAMEWORK_CSS = 'https://trmnl.com/css/3.4.0/plugins.css';

// TRMNL's own structure for the 800x480 1-bit device: the framework sizes the view
// (780x460, inside a 10 px gap)
function page(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FRAMEWORK_CSS}"><style>
body{margin:0;background:#fff}
</style></head><body class="environment trmnl">
<div class="screen screen--og screen--1bit"><div class="view view--full">${body}</div></div>
</body></html>`;
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('Usage: node tests/trmnl/preview.js <outDir>');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const { name, output } of await renderCases()) {
    const file = path.join(outDir, `${name}.html`);
    fs.writeFileSync(file, page(await renderFull(output)));
    console.log(file);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
