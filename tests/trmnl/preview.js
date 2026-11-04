// Writes one HTML page per render case, for checking the screen in a browser, plus the smaller layouts for a few
// cases. Usage: node tests/trmnl/preview.js <outDir> [--screen og|og-portrait|x|x-portrait]
const fs = require('fs');
const path = require('path');
const { LAYOUTS, renderLayout } = require('./harness');
const { renderCases } = require('./renderCases');

const FRAMEWORK_URL = 'https://trmnl.com/';
const FRAMEWORK_CSS = `${FRAMEWORK_URL}css/3.4.0/plugins.css`;
// The framework's runtime applies data-clamp. It measures text, so it is loaded once the fonts are in. The stylesheet
// references its fonts by root-relative paths, hence the <base> in the page.
const FRAMEWORK_JS = `${FRAMEWORK_URL}js/3.4.0/plugins.js`;
const FRAMEWORK_LOADER = `<script>Promise.all(['400', '700'].map(weight => document.fonts.load(weight + ' 16px "Inter Variable"'))).then(() => {
  const script = document.createElement('script');
  script.src = '${FRAMEWORK_JS}';
  document.body.appendChild(script);
});</script>`;

// TRMNL's screen classes (device, size and density, as in its device models) and size (width, height), portrait
// included. The density class decides the OG's bitmap faces.
const SCREENS = {
  og: { classes: 'screen--og screen--1bit screen--md screen--density-1x', size: [800, 480] },
  'og-portrait': {
    classes: 'screen--og screen--1bit screen--md screen--density-1x screen--portrait',
    size: [480, 800]
  },
  x: { classes: 'screen--v2 screen--lg screen--4bit screen--density-2x', size: [1040, 780] },
  'x-portrait': { classes: 'screen--v2 screen--lg screen--4bit screen--density-2x screen--portrait', size: [780, 1040] }
};
const GAP = 10;
const SMALL_LAYOUT_CASES = ['normal', 'long-run', 'paused', 'nl'];

// The view's size inside the screen, per layout: the screen minus a gap on every side, halved for the smaller layouts
function viewSize(screen, layout) {
  const [width, height] = SCREENS[screen].size.map(side => side - 2 * GAP);
  const wide = layout === 'full' || layout === 'half_horizontal';
  const tall = layout === 'full' || layout === 'half_vertical';
  return [wide ? width : Math.floor((width - GAP) / 2), tall ? height : Math.floor((height - GAP) / 2)];
}

// TRMNL's own structure: the framework sizes the view
function page(body, layout, screen, scriptTag) {
  const [width, height] = viewSize(screen, layout);
  const [screenWidth, screenHeight] = SCREENS[screen].size;
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${FRAMEWORK_URL}"><link rel="stylesheet" href="${FRAMEWORK_CSS}"><style>
body{margin:0;background:#fff}
</style></head><body class="environment trmnl" data-screen="${screenWidth}x${screenHeight}">
<div class="screen ${SCREENS[screen].classes}">
<div class="view view--${layout}" style="width:${width}px;height:${height}px">${body}</div>
</div>
${scriptTag ? FRAMEWORK_LOADER : ''}
</body></html>`;
}

function parseArgs(argv) {
  const args = { screen: 'og' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--screen') {
      args.screen = argv[++i];
    } else if (argv[i] === '--no-script') {
      args.noScript = true;
    } else {
      positional.push(argv[i]);
    }
  }
  args.outDir = positional[0];
  return args;
}

async function main() {
  const { outDir, screen, noScript } = parseArgs(process.argv.slice(2));
  if (!outDir || !SCREENS[screen]) {
    console.error(`Usage: node tests/trmnl/preview.js <outDir> [--screen ${Object.keys(SCREENS).join('|')}]`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const cases = await renderCases();
  const normal = cases.find(({ name }) => name === 'normal');
  cases.push({ name: 'normal-dark', output: { ...normal.output, theme: 'dark' } });
  for (const { name, output } of cases) {
    const layouts = SMALL_LAYOUT_CASES.includes(name) ? LAYOUTS : ['full'];
    for (const layout of layouts) {
      const file = path.join(outDir, `${screen}-${name}-${layout}.html`);
      fs.writeFileSync(file, page(await renderLayout(layout, output), layout, screen, !noScript));
      console.log(file);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
