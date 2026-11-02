const express = require('express');
const request = require('supertest');

const stripAuth = require('../middleware/stripAuth');

describe('stripAuth', () => {
  test('removes authorization and cookie from headers and rawHeaders, in any case', () => {
    const req = {
      headers: { authorization: 'Bearer secret', cookie: 'a=b', accept: '*/*' },
      rawHeaders: ['AUTHORIZATION', 'Bearer secret', 'Accept', '*/*', 'cookie', 'a=b']
    };
    const next = jest.fn();

    stripAuth(req, {}, next);

    expect(req.headers).toEqual({ accept: '*/*' });
    expect(req.rawHeaders).toEqual(['Accept', '*/*']);
    expect(next).toHaveBeenCalledWith();
  });

  test('leaves requests without credentials alone', () => {
    const req = { headers: { accept: '*/*' }, rawHeaders: ['Accept', '*/*'] };

    stripAuth(req, {}, jest.fn());

    expect(req.headers).toEqual({ accept: '*/*' });
    expect(req.rawHeaders).toEqual(['Accept', '*/*']);
  });

  test('handlers behind it cannot read the credentials', async () => {
    const app = express();
    app.use(stripAuth);
    app.get('/', (req, res) =>
      res.json({ auth: req.get('Authorization') || null, cookie: req.get('Cookie') || null, raw: req.rawHeaders })
    );

    const response = await request(app).get('/').set('Authorization', 'Bearer secret').set('Cookie', 'a=b');

    expect(response.body.auth).toBeNull();
    expect(response.body.cookie).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});
