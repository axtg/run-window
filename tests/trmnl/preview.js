// Writes one 800x480 HTML page per render case, for checking the screen in a browser, plus the smaller layouts for a
// few cases. Usage: node tests/trmnl/preview.js <outDir>
const fs = require('fs');
const path = require('path');
const { LAYOUTS, renderLayout } = require('./harness');
const { renderCases } = require('./renderCases');

const FRAMEWORK_CSS = 'https://trmnl.com/css/3.4.0/plugins.css';
// The view's size inside the 800x480 screen (10 px gaps), per layout
const VIEW_SIZES = {
  full: [780, 460],
  half_horizontal: [780, 225],
  half_vertical: [385, 460],
  quadrant: [385, 225]
};
const SMALL_LAYOUT_CASES = ['normal', 'long-run', 'paused', 'nl'];

// TRMNL's own structure for the 800x480 1-bit device: the framework sizes the view
function page(body, layout) {
  const [width, height] = VIEW_SIZES[layout];
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FRAMEWORK_CSS}"><style>
body{margin:0;background:#fff}
</style></head><body class="environment trmnl">
<div class="screen screen--og screen--1bit">
<div class="view view--${layout}" style="width:${width}px;height:${height}px">${body}</div>
</div>
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
    const layouts = SMALL_LAYOUT_CASES.includes(name) ? LAYOUTS : ['full'];
    for (const layout of layouts) {
      const file = path.join(outDir, layout === 'full' ? `${name}.html` : `${name}-${layout}.html`);
      fs.writeFileSync(file, page(await renderLayout(layout, output), layout));
      console.log(file);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
