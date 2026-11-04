const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const RouteFile = require('../../public/route');

const { parseRoute, haversineM, bearingDeg, distanceKm, climbM, routeShape, summarizeRoute } = RouteFile;

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'routes');
const PRIVATE_GPX = path.join(__dirname, '..', 'fixtures', 'private', 'trailrouter-loop.gpx');

// xmldom reports malformed input through its error handler; keep the test output quiet.
class QuietDOMParser extends DOMParser {
  constructor() {
    super({ onError() {} });
  }
}

function read(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function parse(name) {
  return parseRoute(read(name), name, QuietDOMParser);
}

function routeOf(name) {
  const result = parse(name);
  expect(result.ok).toBe(true);
  return result.route;
}

describe('parseRoute', () => {
  test.each([
    ['flat-loop.gpx', 37, true, 'Flat test loop'],
    ['hill-loop.gpx', 41, true, 'Hill test loop'],
    ['out-and-back.gpx', 31, true, 'out-and-back'],
    ['point-to-point.gpx', 20, true, 'Point to point test'],
    ['no-elevation.gpx', 31, false, 'No elevation test'],
    ['two-segments.gpx', 12, true, 'Two segments test'],
    ['trk-and-rte.gpx', 10, true, 'Track wins'],
    ['loop.kml', 31, true, 'KML test loop'],
    ['zero-alt.kml', 31, false, 'Zero altitude test']
  ])('%s: %i points, hasElevation %s, name %s', (file, count, hasElevation, name) => {
    const route = routeOf(file);
    expect(route.points).toHaveLength(count);
    expect(route.hasElevation).toBe(hasElevation);
    expect(route.name).toBe(name);
  });

  test('reads lat, lon and ele as numbers and ignores time', () => {
    const [first] = routeOf('flat-loop.gpx').points;
    expect(first).toEqual({ lat: 52.37, lon: 4.897365, ele: 1 });
  });

  test('points without elevation carry ele null', () => {
    expect(routeOf('no-elevation.gpx').points.every(p => p.ele === null)).toBe(true);
  });

  test('two segments are joined in order', () => {
    const { points } = routeOf('two-segments.gpx');
    const lons = points.map(p => p.lon);
    expect(lons.slice(0, 6)).toEqual([...lons.slice(0, 6)].sort((a, b) => a - b));
    expect(lons[6]).toBeGreaterThan(lons[5]);
    expect(lons.slice(6)).toEqual([...lons.slice(6)].sort((a, b) => a - b));
  });

  test('trk wins over rte', () => {
    const { points } = routeOf('trk-and-rte.gpx');
    expect(points).toHaveLength(10);
    expect(points[0].lat).toBe(52.37);
  });

  test('rte is used when there is no trk', () => {
    const text = read('trk-and-rte.gpx').replace(/<trk>[\s\S]*<\/trk>/, '');
    const result = parseRoute(text, 'rte-only.gpx', QuietDOMParser);
    expect(result.ok).toBe(true);
    expect(result.route.points).toHaveLength(6);
  });

  test('the name inside an author element is not the route name', () => {
    expect(routeOf('hill-loop.gpx').name).toBe('Hill test loop');
  });

  test('KML gx:coord is used when there is no LineString', () => {
    const text = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Doc name</name><Placemark>
      <gx:Track><gx:coord>4.89 52.37 1</gx:coord><gx:coord>4.9 52.38 2</gx:coord></gx:Track>
      </Placemark></Document></kml>`;
    const result = parseRoute(text, 'track.kml', QuietDOMParser);
    expect(result.ok).toBe(true);
    expect(result.route.name).toBe('Doc name');
    expect(result.route.points).toEqual([
      { lat: 52.37, lon: 4.89, ele: 1 },
      { lat: 52.38, lon: 4.9, ele: 2 }
    ]);
  });

  test('waypoints only has too few points', () => {
    expect(parse('waypoints-only.gpx')).toEqual({ ok: false, reason: 'too-few-points' });
  });

  test('not XML is unreadable', () => {
    expect(parse('not-xml.gpx')).toEqual({ ok: false, reason: 'unreadable' });
  });

  test('an XML file that is neither GPX nor KML is too short rather than a crash', () => {
    expect(parseRoute('<a><b/></a>', 'x.xml', QuietDOMParser)).toEqual({ ok: false, reason: 'too-few-points' });
  });

  test('a parser that throws gives unreadable', () => {
    class Throwing {
      parseFromString() {
        throw new Error('boom');
      }
    }
    expect(parseRoute('<gpx/>', 'x.gpx', Throwing)).toEqual({ ok: false, reason: 'unreadable' });
  });

  test('a parsererror element gives unreadable', () => {
    class BrowserStyle {
      parseFromString() {
        return {
          documentElement: {},
          getElementsByTagName: tag => (tag === 'parsererror' ? [{}] : [])
        };
      }
    }
    expect(parseRoute('<gpx/>', 'x.gpx', BrowserStyle)).toEqual({ ok: false, reason: 'unreadable' });
  });

  test('a 6 MB string is too large', () => {
    expect(parseRoute('x'.repeat(6 * 1024 * 1024), 'big.gpx', QuietDOMParser)).toEqual({
      ok: false,
      reason: 'too-large'
    });
  });

  test('zero-alt.kml has no elevation', () => {
    expect(routeOf('zero-alt.kml').hasElevation).toBe(false);
  });

  test('a GPX with elevation 0 everywhere still has elevation (sea level is real)', () => {
    const text = read('flat-loop.gpx').replace(/<ele>\d+<\/ele>/g, '<ele>0</ele>');
    expect(parseRoute(text, 'sea.gpx', QuietDOMParser).route.hasElevation).toBe(true);
  });
});

describe('haversineM and bearingDeg', () => {
  test('0.01 degrees of latitude is about 1.112 km', () => {
    const d = haversineM({ lat: 52.37, lon: 4.89 }, { lat: 52.38, lon: 4.89 });
    expect(Math.abs(d - 1112) / 1112).toBeLessThan(0.01);
  });

  test('bearings of the compass points', () => {
    const a = { lat: 52.37, lon: 4.89 };
    expect(bearingDeg(a, { lat: 52.38, lon: 4.89 })).toBeCloseTo(0, 5);
    expect(bearingDeg(a, { lat: 52.37, lon: 4.9 })).toBeCloseTo(90, 0);
    expect(bearingDeg(a, { lat: 52.36, lon: 4.89 })).toBeCloseTo(180, 5);
    expect(bearingDeg(a, { lat: 52.37, lon: 4.88 })).toBeCloseTo(270, 0);
  });
});

describe('distanceKm', () => {
  test('two points 0.01 degrees of latitude apart', () => {
    const km = distanceKm([
      { lat: 52.37, lon: 4.89 },
      { lat: 52.38, lon: 4.89 }
    ]);
    expect(Math.abs(km - 1.112) / 1.112).toBeLessThan(0.01);
  });

  test('the out-and-back fixture is twice its 1.5 km leg', () => {
    expect(Math.abs(distanceKm(routeOf('out-and-back.gpx').points) - 3) / 3).toBeLessThan(0.01);
  });

  test('the 500 m radius loop is about 3.14 km', () => {
    expect(Math.abs(distanceKm(routeOf('flat-loop.gpx').points) - 3.14) / 3.14).toBeLessThan(0.01);
  });
});

describe('climbM', () => {
  test('flat loop with 1 m of noise climbs nothing', () => {
    expect(climbM(routeOf('flat-loop.gpx').points)).toBe(0);
  });

  test('hill loop with a 20 m hill climbs 20', () => {
    expect(climbM(routeOf('hill-loop.gpx').points)).toBe(20);
  });

  test('the result is rounded to the nearest 5', () => {
    const climb = ele => climbM(ele.map((e, i) => ({ lat: 52.37 + i * 0.0001, lon: 4.89, ele: e })));
    expect(climb([0, 4, 8, 12])).toBe(10);
    expect(climb([0, 4, 8, 12, 14])).toBe(10);
    expect(climb([0, 4, 8, 12, 16, 17])).toBe(15);
    expect(climb([0, 3.4])).toBe(5);
    expect(climb([0, 2.9, 5.8])).toBe(5);
  });

  test('a descent does not count and resets the reference', () => {
    expect(climbM([10, 6, 2, 6, 10].map((ele, i) => ({ lat: 52.37 + i * 0.0001, lon: 4.89, ele })))).toBe(10);
  });
});

describe('routeShape', () => {
  test.each([
    ['flat-loop.gpx', 'loop'],
    ['hill-loop.gpx', 'loop'],
    ['loop.kml', 'loop'],
    ['no-elevation.gpx', 'loop'],
    ['out-and-back.gpx', 'out-and-back'],
    ['point-to-point.gpx', 'point-to-point'],
    ['two-segments.gpx', 'point-to-point'],
    ['trk-and-rte.gpx', 'point-to-point']
  ])('%s is a %s', (file, shape) => {
    expect(routeShape(routeOf(file).points)).toBe(shape);
  });
});

describe('summarizeRoute', () => {
  test('start is rounded to 2 decimals', () => {
    const summary = summarizeRoute(routeOf('flat-loop.gpx'));
    expect(summary.start).toEqual({ lat: 52.37, lon: 4.9 });
  });

  test('flat loop summary', () => {
    const summary = summarizeRoute(routeOf('flat-loop.gpx'));
    expect(summary.name).toBe('Flat test loop');
    expect(summary.shape).toBe('loop');
    expect(summary.climbM).toBe(0);
    expect(Math.abs(summary.distanceKm - 3.14) / 3.14).toBeLessThan(0.01);
  });

  test('climbM is null without elevation', () => {
    expect(summarizeRoute(routeOf('no-elevation.gpx')).climbM).toBeNull();
    expect(summarizeRoute(routeOf('zero-alt.kml')).climbM).toBeNull();
  });

  test('point-to-point bearings both point east-north-east', () => {
    const summary = summarizeRoute(routeOf('point-to-point.gpx'));
    expect(summary.overallBearing).toBeGreaterThan(75);
    expect(summary.overallBearing).toBeLessThan(85);
    expect(summary.startBearing).toBeCloseTo(summary.overallBearing, 0);
  });

  test('loop start bearing is the direction of the first quarter, not the overall bearing', () => {
    // The loop starts at its east edge and runs anticlockwise, so it first heads north-west.
    const summary = summarizeRoute(routeOf('flat-loop.gpx'));
    expect(summary.startBearing).toBeGreaterThan(300);
    expect(summary.startBearing).toBeLessThan(360);
  });

  test('out-and-back start bearing is north', () => {
    const summary = summarizeRoute(routeOf('out-and-back.gpx'));
    expect(summary.shape).toBe('out-and-back');
    expect(summary.startBearing).toBeCloseTo(0, 0);
  });
});

const privateTest = fs.existsSync(PRIVATE_GPX) ? test : test.skip;

describe('private route export', () => {
  privateTest('parses, has elevation and is a loop (no coordinates are printed)', () => {
    const result = parseRoute(fs.readFileSync(PRIVATE_GPX, 'utf8'), 'trailrouter-loop.gpx', QuietDOMParser);
    expect(result.ok).toBe(true);
    const { route } = result;
    expect(route.hasElevation).toBe(true);
    expect(routeShape(route.points)).toBe('loop');
    const summary = summarizeRoute(route);
    expect(summary.distanceKm).toBeGreaterThan(0.5);
    expect(typeof summary.climbM).toBe('number');
  });
});
