const fs = require('fs');
const path = require('path');
const { LOGGABLE_PATHS } = require('../middleware/logging');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const conf = read('docker/nginx-run.xadi.eu.conf');
const compose = read('docker-compose.yml');

// Contents of the `{ ... }` block whose opening brace is the first one at or after `start`
const blockAt = start => {
  const open = conf.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < conf.length; i++) {
    if (conf[i] === '{') depth++;
    if (conf[i] === '}' && --depth === 0) return conf.slice(open + 1, i);
  }
  throw new Error('unbalanced braces');
};

// Contents of the block that starts at the first match of `opener`
const block = opener => {
  const start = conf.search(opener);
  expect(start).toBeGreaterThanOrEqual(0);
  return blockAt(start);
};

// Contents of every top-level `server { ... }` block, in file order
const servers = [...conf.matchAll(/^server\s*\{/gm)].map(match => blockAt(match.index));
const [server, redirect] = servers;
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
      expect(location.body).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:3003;/);
    }
  });

  test('serves run.xadi.eu and leaves TLS to certbot', () => {
    expect(server).toMatch(/server_name run\.xadi\.eu;/);
    expect(server).not.toMatch(/ssl_certificate|listen\s+443/);
    expect(conf).toMatch(/certbot --nginx --no-redirect/);
  });

  test('port 80 is a block of its own that only redirects, so certbot has nothing to create', () => {
    expect(servers).toHaveLength(2);
    expect(redirect).toMatch(/listen 80;/);
    expect(redirect).toMatch(/server_name run\.xadi\.eu;/);
    expect(redirect).toMatch(/return 301 https:\/\/\$host\$request_uri;/);
    expect(redirect).not.toMatch(/proxy_pass|location/);
    // Two blocks with one name on port 80 make nginx ignore the second, and the app would be served over plain http.
    expect(server).not.toMatch(/listen\s+(\S+:)?80\b/);
    expect(server).toMatch(/listen 127\.0\.0\.1:\d+;/);
  });

  test('every server block logs with the safe format at crit, so none inherits the host format', () => {
    servers.forEach(body => {
      expect(body).toMatch(/access_log \S+ runwindow;/);
      expect(body).toMatch(/error_log \S+ crit;/);
    });
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
    expect(mapped.map(([, , value]) => value).sort()).toEqual([...LOGGABLE_PATHS].sort());
    // Each key is a case-insensitive regex matching its path with or without a trailing slash, like Express does
    mapped.forEach(([, key, value]) => {
      expect(key.startsWith('~*^') && key.endsWith('$')).toBe(true);
      const regex = new RegExp(key.slice(2), 'i');
      [value, value.toUpperCase(), value === '/' ? '/' : `${value}/`].forEach(url => expect(url).toMatch(regex));
      expect(`${value}x`).not.toMatch(regex);
      expect(`/x${value}`).not.toMatch(regex);
    });
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
    expect(compose).toMatch(/PORT=3003/);
  });
});

describe('docker image', () => {
  test('the build context leaves out the working notes', () => {
    expect(read('.dockerignore').split('\n')).toContain('.superpowers');
  });

  test('exposes 3003 and checks health on loopback', () => {
    expect(read('docker/Dockerfile')).toMatch(/EXPOSE 3003/);
    const healthcheck = read('docker/healthcheck.js');
    expect(healthcheck).toMatch(/127\.0\.0\.1/);
    expect(healthcheck).toMatch(/process\.env\.PORT \|\| 3003/);
  });
});
