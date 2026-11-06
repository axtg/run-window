const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Scripts without a src, excluding data blocks such as JSON-LD, which browsers never run.
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)(?![^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/g;

// Plausible: its one script file, and its event endpoint. Nothing else leaves the page's own origin.
const PLAUSIBLE_SCRIPT = 'https://plausible.io/js/pa-Y3VqyvdYCOYYLOZ8-gRL1.js';
const SITE_SOURCES = { scripts: [PLAUSIBLE_SCRIPT], connect: ['https://plausible.io'] };

// Blocks anything not listed. To debug a policy without breaking pages, switch to Content-Security-Policy-Report-Only.
const POLICY_HEADER = 'Content-Security-Policy';

// A hash covers a script's exact text. The page is hashed at startup, so the policy stays in step with it.
function buildContentSecurityPolicy(html, { scripts = [], styles = [], connect = [] } = {}) {
  const inlineHashes = [...html.matchAll(INLINE_SCRIPT)].map(([, source]) => {
    return `'sha256-${crypto.createHash('sha256').update(source).digest('base64')}'`;
  });

  return [
    "default-src 'self'",
    ["script-src 'self'", ...scripts, ...inlineHashes].join(' '),
    ["style-src 'self'", ...styles].join(' '),
    "img-src 'self' data:",
    ["connect-src 'self'", ...connect].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join('; ');
}

function securityHeaders() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const policy = buildContentSecurityPolicy(html, SITE_SOURCES);

  return (req, res, next) => {
    res.setHeader(POLICY_HEADER, policy);
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=604800'); // One week, while this is new
    next();
  };
}

module.exports = { PLAUSIBLE_SCRIPT, buildContentSecurityPolicy, securityHeaders };
