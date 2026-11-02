const fs = require('fs');
const path = require('path');
const { LOGGABLE_PATHS } = require('../middleware/logging');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const conf = read('docker/nginx-run.xadi.eu.conf');
const compose = read('docker-compose.yml');

// Contents of the `{ ... }` block that starts at the first match of `opener`
const block = opener => {
  const start = conf.search(opener);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = conf.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < conf.length; i++) {
    if (conf[i] === '{') depth++;
    if (conf[i] === '}' && --depth === 0) return conf.slice(open + 1, i);
  }
  throw new Error('unbalanced braces');
};

const server = block(/^server\s*\{/m);
const locations = [...server.matchAll(/^\s*location\s[^{]*\{/gm)].map(match => ({
  head: match[0].trim(),
  body: block(new RegExp(match[0].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}));
const logFormat = conf.match(/log_format\s+runwindow\s+([^;]*);/)[1];
const mapBody = block(/^map\s+\$uri\s+\$run_window_path\s*\{/m);

describe('nginx config', () => {
  test('removes credentials at server level and not per location', () => {
    expect(server).toMatch(/proxy_set_header Authorization "";/);
    expect(server).toMatch(/proxy_set_header Cookie "";/);
    expect(server).toMatch(/proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
    // Any proxy_set_header in a location replaces the inherited ones, so locations must set none
    expect(locations.length).toBeGreaterThan(0);
    for (const location of locations) {
      expect(location.body).not.toMatch(/proxy_set_header/);
      expect(location.body).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:3001;/);
    }
  });

  test('serves run.xadi.eu and leaves TLS to certbot', () => {
    expect(server).toMatch(/server_name run\.xadi\.eu;/);
    expect(server).toMatch(/listen 80;/);
    expect(server).not.toMatch(/ssl_certificate|listen\s+443/);
    expect(conf).toMatch(/certbot/);
  });

  test('logs a fixed allow-list of paths, never a query string', () => {
    expect(logFormat).toMatch(/\$run_window_path/);
    expect(logFormat).not.toMatch(/\$uri|\$request\b|\$request_uri|\$args|\$query_string|\$http_referer/);
    expect(conf).toMatch(/access_log \S+ runwindow;/);
    expect(conf).toMatch(/error_log \S+ crit;/);
  });

  test('the logged path map matches LOGGABLE_PATHS', () => {
    expect(mapBody).toMatch(/default\s+other;/);
    const mapped = [...mapBody.matchAll(/^\s*(\S+)\s+(\S+);/gm)].filter(([, key]) => key !== 'default');
    mapped.forEach(([, key, value]) => expect(value).toBe(key));
    expect(mapped.map(([, key]) => key).sort()).toEqual([...LOGGABLE_PATHS].sort());
  });

  test('/health/cache is reachable from the host only, whatever the case', () => {
    const cache = locations.find(location => /health\/cache/.test(location.head));
    expect(cache.head).toMatch(/^location ~\* /);
    expect(cache.body).toMatch(/allow 127\.0\.0\.1;\s*deny all;/);
    const regex = new RegExp(cache.head.match(/~\*\s+(\S+)/)[1], 'i');
    ['/health/cache', '/HEALTH/Cache', '/health/cache/'].forEach(url => expect(url).toMatch(regex));
    expect('/health').not.toMatch(regex);
  });
});

describe('docker compose', () => {
  test('uses host networking on loopback', () => {
    expect(compose).toMatch(/network_mode: host/);
    expect(compose).toMatch(/HOST=127\.0\.0\.1/);
    expect(compose).toMatch(/PORT=3001/);
  });
});

describe('docker image', () => {
  test('exposes 3001 and checks health on loopback', () => {
    expect(read('docker/Dockerfile')).toMatch(/EXPOSE 3001/);
    const healthcheck = read('docker/healthcheck.js');
    expect(healthcheck).toMatch(/127\.0\.0\.1/);
    expect(healthcheck).toMatch(/process\.env\.PORT \|\| 3001/);
  });
});
