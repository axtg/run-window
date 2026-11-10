const request = require('supertest');
const { createApp } = require('../app');

const app = createApp({ weather: { getForecast: jest.fn(), stats: () => ({}), capacity: () => ({}) } });

// RFC 9116: Contact and Expires are required; Expires should be less than a year ahead.
describe('/.well-known/security.txt', () => {
  test('is served as plain text with the contact and the fields RFC 9116 asks for', async () => {
    const { text, headers } = await request(app).get('/.well-known/security.txt').expect(200);
    expect(headers['content-type']).toMatch(/^text\/plain/);
    expect(text).toContain('Contact: mailto:security@xadi.eu');
    expect(text).toContain('Canonical: https://besttimetorun.com/.well-known/security.txt');
    expect(text).toMatch(/no bug bounty/i);
  });

  // This test fails once the date is close: then renew Expires (at most a year ahead) and push.
  test('has not expired, and expires within about a year', async () => {
    const { text } = await request(app).get('/.well-known/security.txt').expect(200);
    const expires = Date.parse(text.match(/^Expires: (.+)$/m)[1]);
    const days = (expires - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(30);
    expect(days).toBeLessThan(400);
  });
});
