// The MCP view of find_best_run_time (an MCP App): one self-contained HTML file, built once from mcp-view/ and the
// page's own plan.js and strip.js, so the chat shows the same answer and timeline as the page.
const fs = require('fs');
const path = require('path');

const VIEW_URI = 'ui://besttimetorun/day.html';
const VIEW_MIME_TYPE = 'text/html;profile=mcp-app';
const ROOT = path.join(__dirname, '..');

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Inlined code must not close its own <script> or <style> element early.
function inline(code, tag) {
  if (new RegExp(`</${tag}`, 'i').test(code)) throw new Error(`Inlined code contains </${tag}`);
  return code;
}

let cached = null;
function viewHtml() {
  if (cached) return cached;
  const script = ['public/plan.js', 'public/strip.js', 'mcp-view/day.js'].map(read).join('\n');
  cached = read('mcp-view/day.html')
    .replace('/* day.css */', () => inline(read('mcp-view/day.css'), 'style'))
    .replace('/* day.js */', () => inline(script, 'script'));
  return cached;
}

module.exports = { VIEW_URI, VIEW_MIME_TYPE, viewHtml };
