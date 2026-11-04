// Reads GPX and KML route files and summarises them. Runs in the browser; the file never leaves the device.
// Loaded by the page and by the Jest tests.
(function () {
  const MAX_TEXT_LENGTH = 5 * 1024 * 1024;
  const EARTH_RADIUS_M = 6371000;
  const CLIMB_THRESHOLD_M = 3;
  const CLIMB_ROUNDING_M = 5;
  const LOOP_CLOSE_M = 200;
  const RETRACE_M = 30;
  const RETRACE_SHARE = 0.8;
  const RESAMPLE_M = 20;
  const START_BEARING_SHARE = 0.25;

  const toRad = degrees => (degrees * Math.PI) / 180;

  function haversineM(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Initial compass bearing from a to b, 0 (north) up to but not including 360.
  function bearingDeg(a, b) {
    const dLon = toRad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
    const x =
      Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
      Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
    return ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
  }

  function distanceKm(points) {
    let meters = 0;
    for (let i = 1; i < points.length; i += 1) meters += haversineM(points[i - 1], points[i]);
    return meters / 1000;
  }

  // Total ascent, ignoring wobble smaller than the threshold, rounded to the nearest 5 m.
  function climbM(points) {
    const elevations = points.map(p => p.ele).filter(Number.isFinite);
    if (elevations.length === 0) return 0;
    let gain = 0;
    let ref = elevations[0];
    for (const ele of elevations) {
      if (ele - ref >= CLIMB_THRESHOLD_M) {
        gain += ele - ref;
        ref = ele;
      } else if (ref - ele >= CLIMB_THRESHOLD_M) {
        ref = ele;
      }
    }
    return Math.round(gain / CLIMB_ROUNDING_M) * CLIMB_ROUNDING_M;
  }

  // Keeps the first and last point and every point at least RESAMPLE_M from the previous kept one.
  function resample(points) {
    const kept = [points[0]];
    for (let i = 1; i < points.length - 1; i += 1) {
      if (haversineM(kept[kept.length - 1], points[i]) >= RESAMPLE_M) kept.push(points[i]);
    }
    kept.push(points[points.length - 1]);
    return kept;
  }

  function routeShape(points) {
    const first = points[0];
    const last = points[points.length - 1];
    if (haversineM(first, last) > LOOP_CLOSE_M) return 'point-to-point';
    const sparse = resample(points);
    const half = Math.floor(sparse.length / 2);
    const outward = sparse.slice(0, half);
    const back = sparse.slice(half);
    if (outward.length === 0 || back.length === 0) return 'loop';
    const retraced = back.filter(p => outward.some(q => haversineM(p, q) <= RETRACE_M)).length;
    return retraced / back.length >= RETRACE_SHARE ? 'out-and-back' : 'loop';
  }

  function startBearing(points, totalM) {
    const target = totalM * START_BEARING_SHARE;
    let travelled = 0;
    for (let i = 1; i < points.length; i += 1) {
      travelled += haversineM(points[i - 1], points[i]);
      if (travelled >= target) return bearingDeg(points[0], points[i]);
    }
    return bearingDeg(points[0], points[points.length - 1]);
  }

  function summarizeRoute(route) {
    const { points } = route;
    const first = points[0];
    const km = distanceKm(points);
    return {
      name: route.name,
      distanceKm: km,
      climbM: route.hasElevation ? climbM(points) : null,
      shape: routeShape(points),
      startBearing: startBearing(points, km * 1000),
      overallBearing: bearingDeg(first, points[points.length - 1]),
      start: { lat: Number(first.lat.toFixed(2)), lon: Number(first.lon.toFixed(2)) }
    };
  }

  // ---- Reading the files. Only getElementsByTagName, getAttribute, textContent and parentNode are used, so the
  // same code runs on the browser's DOMParser and on xmldom.

  function elementsOf(root, tag) {
    return Array.from(root.getElementsByTagName(tag));
  }

  function textOf(element) {
    return (element.textContent || '').trim();
  }

  // The text of the first direct child element called tag, or ''.
  function childText(parent, tag) {
    const child = elementsOf(parent, tag).find(el => el.parentNode === parent);
    return child ? textOf(child) : '';
  }

  function validPoint(lat, lon, ele) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon, ele: Number.isFinite(ele) ? ele : null };
  }

  function gpxPoints(doc) {
    let elements = elementsOf(doc, 'trkpt');
    if (elements.length === 0) elements = elementsOf(doc, 'rtept');
    return elements
      .map(el => {
        const eleText = elementsOf(el, 'ele').map(textOf)[0];
        return validPoint(
          parseFloat(el.getAttribute('lat')),
          parseFloat(el.getAttribute('lon')),
          eleText ? parseFloat(eleText) : NaN
        );
      })
      .filter(Boolean);
  }

  function kmlTuple(tuple, separator) {
    const [lon, lat, alt] = tuple.split(separator).map(part => (part === '' ? NaN : parseFloat(part)));
    return validPoint(lat, lon, alt);
  }

  function kmlPoints(doc) {
    const lineStrings = elementsOf(doc, 'LineString');
    const fromLines = lineStrings
      .flatMap(line => elementsOf(line, 'coordinates'))
      .flatMap(el => textOf(el).split(/\s+/).filter(Boolean))
      .map(tuple => kmlTuple(tuple, ','))
      .filter(Boolean);
    if (fromLines.length > 0) return fromLines;
    return elementsOf(doc, 'gx:coord')
      .map(el => kmlTuple(textOf(el), /\s+/))
      .filter(Boolean);
  }

  function nameOf(doc, isKml, fileName) {
    const candidates = isKml
      ? [elementsOf(doc, 'Placemark')[0], elementsOf(doc, 'Document')[0]]
      : [elementsOf(doc, 'trk')[0], elementsOf(doc, 'metadata')[0]];
    for (const parent of candidates) {
      const name = parent ? childText(parent, 'name') : '';
      if (name) return name;
    }
    return fileName.replace(/\.[^./\\]*$/, '');
  }

  function parseRoute(text, fileName, DOMParserImpl) {
    if (text.length > MAX_TEXT_LENGTH) return { ok: false, reason: 'too-large' };
    let doc;
    try {
      doc = new DOMParserImpl().parseFromString(text, 'application/xml');
      if (!doc || !doc.documentElement || elementsOf(doc, 'parsererror').length > 0) {
        return { ok: false, reason: 'unreadable' };
      }
    } catch (error) {
      return { ok: false, reason: 'unreadable' };
    }
    const isKml = doc.documentElement.nodeName.toLowerCase() === 'kml';
    const points = isKml ? kmlPoints(doc) : gpxPoints(doc);
    if (points.length < 2) return { ok: false, reason: 'too-few-points' };
    const everyPointHasEle = points.every(p => p.ele !== null);
    // KML writers put 0 where they have no altitude, so a file of zeros carries no elevation.
    const hasElevation = everyPointHasEle && !(isKml && points.every(p => p.ele === 0));
    return { ok: true, route: { name: nameOf(doc, isKml, fileName), points, hasElevation } };
  }

  const api = { parseRoute, haversineM, bearingDeg, distanceKm, climbM, routeShape, summarizeRoute };

  if (typeof module !== 'undefined') module.exports = api;
  else globalThis.RouteFile = api;
})();
