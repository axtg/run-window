const http = require('http');

const { fetchText } = require('../utils/httpClient');

describe('fetchText', () => {
  let server;
  let baseUrl;
  let handler;

  beforeAll(async () => {
    server = http.createServer((req, res) => handler(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  test('returns the status and body of a successful response', async () => {
    handler = (req, res) => res.end('hello');

    expect(await fetchText(baseUrl, { timeoutMs: 1000 })).toEqual({ status: 200, body: 'hello' });
  });

  test('returns the status and body of an error response instead of throwing', async () => {
    handler = (req, res) => {
      res.statusCode = 503;
      res.end('unavailable');
    };

    expect(await fetchText(baseUrl, { timeoutMs: 1000 })).toEqual({ status: 503, body: 'unavailable' });
  });

  test('rejects when the connection drops part way through the body', async () => {
    handler = (req, res) => {
      res.writeHead(200, { 'Content-Length': '1000' });
      res.write('partial');
      setTimeout(() => res.socket.destroy(), 20);
    };

    await expect(fetchText(baseUrl, { timeoutMs: 2000 })).rejects.toThrow();
  });

  test('rejects at the deadline when the server never responds', async () => {
    handler = () => {};
    const started = Date.now();

    await expect(fetchText(baseUrl, { timeoutMs: 100 })).rejects.toThrow('timed out after 100ms');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('rejects at the deadline when the server keeps sending data slowly', async () => {
    handler = (req, res) => {
      res.writeHead(200);
      const drip = setInterval(() => res.write('x'), 20);
      res.on('close', () => clearInterval(drip));
    };
    const started = Date.now();

    await expect(fetchText(baseUrl, { timeoutMs: 150 })).rejects.toThrow('timed out after 150ms');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('closes the connection when the deadline passes', async () => {
    let closed = false;
    handler = req => req.socket.on('close', () => (closed = true));

    await expect(fetchText(baseUrl, { timeoutMs: 50 })).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(closed).toBe(true);
  });

  test('rejects a body larger than the limit', async () => {
    handler = (req, res) => res.end(Buffer.alloc(2000, 'a'));

    await expect(fetchText(baseUrl, { timeoutMs: 1000, maxBytes: 1000 })).rejects.toThrow('larger than 1000 bytes');
  });

  test('does not follow redirects, so a URL token cannot be sent elsewhere', async () => {
    let followed = false;
    handler = (req, res) => {
      if (req.url === '/target') {
        followed = true;
        return res.end('target');
      }
      res.writeHead(302, { Location: '/target' });
      return res.end();
    };

    await expect(fetchText(baseUrl, { timeoutMs: 1000 })).rejects.toThrow('Request failed: unexpected redirect');
    expect(followed).toBe(false);
  });

  test('does not include the URL or its token in errors', async () => {
    handler = () => {};

    const error = await fetchText(`${baseUrl}/api?securityToken=secret-value`, { timeoutMs: 50 }).catch(e => e);

    expect(error.message).not.toContain('secret-value');
  });
});
