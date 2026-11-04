const fs = require('fs');
const path = require('path');

const { SHARE_CACHE, SHARE_KEY, handleShare } = require('../../public/sw');

// app.js runs only in the browser, so its side of the hand-off is checked as text: it must read the cache and key
// that sw.js writes, and the query values sw.js redirects with.
const APP_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
const ORIGIN = 'https://run.xadi.eu';

function fakeCaches() {
  return { open: async () => ({ put: async () => {} }) };
}

function shareRequest(file) {
  return { url: `${ORIGIN}/share-target`, formData: async () => ({ get: name => (name === 'route' ? file : null) }) };
}

async function redirectQuery(request) {
  const response = await handleShare(request, fakeCaches());
  return new URL(response.headers.get('Location')).searchParams;
}

describe('share hand-off between sw.js and app.js', () => {
  it('uses the same cache name', () => {
    expect(APP_SOURCE).toContain(`const SHARE_CACHE = '${SHARE_CACHE}';`);
  });

  it('uses the same cache key', () => {
    expect(APP_SOURCE).toContain(`const SHARE_KEY = '${SHARE_KEY}';`);
  });

  it('reads the share query value sw.js sends after a stored share', async () => {
    const query = await redirectQuery(shareRequest(new File(['<gpx/>'], 'a.gpx')));
    expect([...query.keys()]).toEqual(['share']);
    expect(query.get('share')).toBe('1');
    expect(APP_SOURCE).toContain(".get('share')");
    expect(APP_SOURCE).toContain(`share === '${query.get('share')}'`);
  });

  it('treats the failed value as a share that did not arrive', async () => {
    const query = await redirectQuery(shareRequest(null));
    expect(query.get('share')).toBe('failed');
    // app.js clears and reports any share value other than 1; it never treats "failed" as a stored file.
    expect(APP_SOURCE).toContain("if (share !== '1')");
  });

  it('shows the too-large message for the too-large value, not the "didn\'t arrive" one', async () => {
    const query = await redirectQuery(shareRequest(new File([new Uint8Array(6 * 1024 * 1024)], 'huge.gpx')));
    expect(query.get('share')).toBe('too-large');
    expect(APP_SOURCE).toContain(`share === '${query.get('share')}'`);
    expect(APP_SOURCE).toContain("'too-large': 'That file is too large for a route.'");
  });
});
