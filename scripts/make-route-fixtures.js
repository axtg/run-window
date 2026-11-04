// Writes the synthetic route files in tests/fixtures/routes/. All of them sit around Amsterdam centre
// (52.37, 4.89). Run with: node scripts/make-route-fixtures.js
const fs = require('fs');
const path = require('path');

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const OUT_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'routes');
const CENTRE = { lat: 52.37, lon: 4.89 };
const M_PER_DEG_LAT = 111195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTRE.lat * Math.PI) / 180);

function offset(eastM, northM) {
  return {
    lat: Number((CENTRE.lat + northM / M_PER_DEG_LAT).toFixed(6)),
    lon: Number((CENTRE.lon + eastM / M_PER_DEG_LON).toFixed(6))
  };
}

// A closed circle of the given radius, starting and ending at its east edge.
function circle(radiusM, count, eleAt) {
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const angle = (2 * Math.PI * (i % count)) / count;
    points.push({
      ...offset(radiusM * Math.cos(angle), radiusM * Math.sin(angle)),
      ele: eleAt ? eleAt(i % count) : null
    });
  }
  return points;
}

function line(fromEastM, fromNorthM, toEastM, toNorthM, count, ele) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    points.push({ ...offset(fromEastM + (toEastM - fromEastM) * t, fromNorthM + (toNorthM - fromNorthM) * t), ele });
  }
  return points;
}

function pt(tag, { lat, lon, ele }, extra = '') {
  const eleXml = ele === null || ele === undefined ? '' : `<ele>${ele}</ele>`;
  return `      <${tag} lat="${lat}" lon="${lon}">${eleXml}${extra}</${tag}>`;
}

function gpx(body) {
  const root = '<gpx version="1.1" creator="synthetic" xmlns="http://www.topografix.com/GPX/1/1">';
  return `${XML_DECLARATION}\n${root}\n${body}\n</gpx>\n`;
}

function trk(segments, name) {
  const nameXml = name ? `    <name>${name}</name>\n` : '';
  const segs = segments
    .map(seg => `    <trkseg>\n${seg.map(p => pt('trkpt', p)).join('\n')}\n    </trkseg>`)
    .join('\n');
  return `  <trk>\n${nameXml}${segs}\n  </trk>`;
}

function kml(name, coordinates) {
  const lines = [
    XML_DECLARATION,
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    '    <name>Ignored document name</name>',
    '    <Placemark>',
    `      <name>${name}</name>`,
    '      <LineString>',
    '        <coordinates>',
    coordinates,
    '        </coordinates>',
    '      </LineString>',
    '    </Placemark>',
    '  </Document>',
    '</kml>'
  ];
  return `${lines.join('\n')}\n`;
}

function kmlCoordinates(points, altAt) {
  return points.map((p, i) => `          ${p.lon},${p.lat},${altAt(i)}`).join('\n');
}

// Flat circle with +-1 m of elevation noise, and a time on every point that readers must ignore.
const flatLoop = circle(500, 36, i => (i % 2 ? 3 : 1));
// Circle with one 20 m hill in four-metre steps.
const hillElevation = i => {
  if (i < 10) return 0;
  if (i < 15) return 4 * (i - 9);
  if (i < 20) return 20;
  if (i < 25) return 20 - 4 * (i - 19);
  return 0;
};
const hillLoop = circle(500, 40, hillElevation);
const outward = line(0, 0, 0, 1500, 16, 1);
const outAndBack = [...outward, ...outward.slice(0, -1).reverse()];
const pointToPoint = line(0, 0, 1800, 300, 20, 1);
const noElevation = circle(400, 30, null);
const segmentA = line(0, 0, 400, 0, 6, 1);
const segmentB = line(500, 0, 900, 0, 6, 1);
const routeTrack = line(0, 0, 900, 0, 10, 1);
const rtePoints = line(0, 200, 300, 200, 6, 1);
const kmlLoop = circle(450, 30, null);
const HILL_METADATA = [
  '  <metadata>',
  '    <name>Hill test loop</name>',
  '    <author><name>Nobody</name></author>',
  '  </metadata>'
].join('\n');
const rteXml = ['  <rte>', '    <name>Route loses</name>', ...rtePoints.map(p => pt('rtept', p)), '  </rte>'].join(
  '\n'
);

const files = {
  'flat-loop.gpx': gpx(
    trk([flatLoop.map(p => p)], 'Flat test loop').replace(
      /(<trkpt [^>]*>.*?)(<\/trkpt>)/g,
      '$1<time>2026-01-01T10:00:00Z</time>$2'
    )
  ),
  'hill-loop.gpx': gpx(`${HILL_METADATA}\n${trk([hillLoop])}`),
  'out-and-back.gpx': gpx(trk([outAndBack])),
  'point-to-point.gpx': gpx(trk([pointToPoint], 'Point to point test')),
  'no-elevation.gpx': gpx(trk([noElevation], 'No elevation test')),
  'two-segments.gpx': gpx(trk([segmentA, segmentB], 'Two segments test')),
  'waypoints-only.gpx': gpx(
    [offset(0, 0), offset(300, 300), offset(600, 0)]
      .map(p => pt('wpt', { ...p, ele: 1 }, '<name>Stop</name>'))
      .join('\n')
  ),
  'trk-and-rte.gpx': gpx(`${trk([routeTrack], 'Track wins')}\n${rteXml}`),
  'loop.kml': kml(
    'KML test loop',
    kmlCoordinates(kmlLoop, i => 1 + (i % 4))
  ),
  'zero-alt.kml': kml(
    'Zero altitude test',
    kmlCoordinates(kmlLoop, () => 0)
  ),
  'not-xml.gpx': 'this is not xml <<< &&& \n'
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT_DIR, name), content);
}
