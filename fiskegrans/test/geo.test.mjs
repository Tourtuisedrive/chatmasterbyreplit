import test from 'node:test';
import assert from 'node:assert/strict';
import { toPolygons, locate, zoneFor, tilesForBbox, bbox, padBbox, isClosedSeason } from '../js/geo.js';

// Testkvadrat ca 1 km x 1 km kring en punkt (inte den verkliga gränsen).
const LAT0 = 65.58;
const LNG0 = 16.06;
const dLat = 1000 / 110540;
const dLng = 1000 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const square = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [LNG0, LAT0], [LNG0 + dLng, LAT0], [LNG0 + dLng, LAT0 + dLat], [LNG0, LAT0 + dLat],
    ]],
  },
};
const polys = toPolygons(square);

test('ringen stängs automatiskt', () => {
  assert.equal(polys.length, 1);
  assert.deepEqual(polys[0][0][0], polys[0][0][4]);
});

test('mitten är innanför, ca 500 m från gränsen', () => {
  const r = locate(LAT0 + dLat / 2, LNG0 + dLng / 2, polys);
  assert.equal(r.inside, true);
  assert.ok(Math.abs(r.distance - 500) < 2, `distance ${r.distance}`);
});

test('punkt 100 m utanför västra kanten', () => {
  const r = locate(LAT0 + dLat / 2, LNG0 - dLng / 10, polys);
  assert.equal(r.inside, false);
  assert.ok(Math.abs(r.distance - 100) < 1, `distance ${r.distance}`);
});

test('hål räknas som utanför', () => {
  const withHole = toPolygons({
    type: 'Polygon',
    coordinates: [
      square.geometry.coordinates[0],
      [[LNG0 + dLng * 0.4, LAT0 + dLat * 0.4], [LNG0 + dLng * 0.6, LAT0 + dLat * 0.4], [LNG0 + dLng * 0.6, LAT0 + dLat * 0.6], [LNG0 + dLng * 0.4, LAT0 + dLat * 0.6]],
    ],
  });
  const r = locate(LAT0 + dLat / 2, LNG0 + dLng / 2, withHole);
  assert.equal(r.inside, false);
  assert.ok(Math.abs(r.distance - 100) < 1);
});

test('zoner och hysteres', () => {
  const opts = { warnDistance: 50, accuracy: 10, useAccuracy: true };
  assert.equal(zoneFor({ inside: true, distance: 200 }, opts), 'inside');
  assert.equal(zoneFor({ inside: true, distance: 55 }, opts), 'near'); // 55 - 10 = 45
  assert.equal(zoneFor({ inside: true, distance: 55 }, { ...opts, useAccuracy: false }), 'inside');
  assert.equal(zoneFor({ inside: false, distance: 5 }, opts), 'outside');
  assert.equal(zoneFor({ inside: true, distance: 62 }, { ...opts, previous: 'near' }), 'near'); // 52 <= 53
  assert.equal(zoneFor({ inside: true, distance: 62 }, { ...opts }), 'inside');
  assert.equal(zoneFor({ inside: false, distance: NaN }, opts), 'unknown');
});

test('tiles täcker bbox', () => {
  const b = padBbox(bbox(polys), 200);
  const t = tilesForBbox(b, 15);
  assert.ok(t.length > 0 && t.length < 50, `${t.length}`);
});

test('förbudsperiod 5/5–14/6', () => {
  const t = 'Ej upplåtet 5/5-14/6';
  assert.equal(isClosedSeason(t, new Date(2026, 4, 4)), false);
  assert.equal(isClosedSeason(t, new Date(2026, 4, 5)), true);
  assert.equal(isClosedSeason(t, new Date(2026, 5, 14)), true);
  assert.equal(isClosedSeason(t, new Date(2026, 5, 15)), false);
  assert.equal(isClosedSeason('Upplåtet hela året', new Date(2026, 4, 20)), false);
});

test('Länsstyrelsens område 82 innehåller sjökoordinaten', async () => {
  const { readFile } = await import('node:fs/promises');
  const gj = JSON.parse(await readFile(new URL('../data/boundary.geojson', import.meta.url)));
  const r = locate(65.58488, 16.06088, toPolygons(gj));
  assert.equal(r.inside, true);
  assert.ok(r.distance > 150 && r.distance < 300, `${r.distance}`);
});
