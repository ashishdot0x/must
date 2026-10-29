import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { destination, lineString, point, polygon } from '@turf/turf';
import { parse } from 'csv-parse/sync';
import { naiveDistance } from '../src/naiveCalc.js';
import { fixedDistance, fixedDistanceDetailed } from '../src/fixedCalc.js';
import { clipSegmentToZone, distanceMetres, roadDeviationMetres, splitByLocalMidnight } from '../src/geo.js';
import { haversineKm, splitByElapsedRatio } from './independentOracle.js';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const driver = 'test_driver';
const road = (coordinates) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: lineString(coordinates).geometry }] });
const zone = (coordinates) => polygon([coordinates]);
const insideZone = zone([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]);
const routeRoad = road([[-1, 0], [1, 0]]);

/** @param {string} iso @param {number} lon @param {number} lat @param {Partial<object>} extra */
function ping(iso, lon, lat = 0, extra = {}) {
  return { driver_id: driver, ts_utc: iso, arrival_ts_utc: iso, lat, lon, ...extra };
}

/** @param {Array<object>} rows @param {string} date */
function kilometresFor(rows, date) {
  return rows.find((row) => row.driver_id === driver && row.date === date)?.km ?? 0;
}

/** @param {[number, number]} start @param {[number, number]} end */
function directKm(start, end) {
  return haversineKm(start, end);
}

const scenarios = [
  {
    name: 'off-road point is rejected while a point at the threshold is accepted',
    pings: [
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:00:10Z', 0.002, 0.002),
      ping('2026-01-01T00:00:20Z', 0.004),
    ],
    road: routeRoad,
    zone: insideZone,
    expectedKm: directKm([0, 0], [0.004, 0]),
  },
  {
    name: 'isolated speed spike is removed and neighboring speed is recomputed',
    pings: [
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:00:10Z', 0.02),
      ping('2026-01-01T00:00:20Z', 0.001),
      ping('2026-01-01T00:00:30Z', 0.002),
    ],
    road: routeRoad,
    zone: insideZone,
    expectedKm: directKm([0, 0], [0.001, 0]) + directKm([0.001, 0], [0.002, 0]),
  },
  {
    name: 'exact duplicate timestamp is retained once',
    pings: [
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:00:10Z', 0.001),
      ping('2026-01-01T00:00:00Z', 0, 0, { injected_fault: 'duplicate' }),
    ],
    road: routeRoad,
    zone: insideZone,
    expectedKm: directKm([0, 0], [0.001, 0]),
  },
  {
    name: 'GPS timestamp order wins over shuffled arrival order',
    pings: [
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:00:20Z', 0.002),
      ping('2026-01-01T00:00:10Z', 0.001),
    ],
    road: routeRoad,
    zone: insideZone,
    expectedKm: directKm([0, 0], [0.002, 0]),
  },
  {
    name: 'UTC+9 midnight is split by elapsed-time proportion',
    pings: [
      ping('2026-01-01T14:59:50Z', 0),
      ping('2026-01-01T15:00:10Z', 0.001),
    ],
    road: routeRoad,
    zone: insideZone,
    expectedByDate: {
      '2026-01-01': splitByElapsedRatio(directKm([0, 0], [0.001, 0]), 20)[0] * 10,
      '2026-01-02': splitByElapsedRatio(directKm([0, 0], [0.001, 0]), 20)[1] * 10,
    },
  },
  {
    name: 'zone boundary crossings are clipped rather than billed whole',
    pings: [
      ping('2026-01-01T00:00:00Z', -0.002),
      ping('2026-01-01T00:00:10Z', 0),
      ping('2026-01-01T00:00:20Z', 0.001),
      ping('2026-01-01T00:00:30Z', 0.002),
    ],
    road: road([[-1, 0], [1, 0]]),
    zone: zone([[-0.001, -0.001], [0.001, -0.001], [0.001, 0.001], [-0.001, 0.001], [-0.001, -0.001]]),
    expectedKm: directKm([-0.001, 0], [0.001, 0]),
  },
];

describe.each(scenarios)('core business rule: $name', (scenario) => {
  it('passes with the fixed implementation using independent geometry', () => {
    const result = fixedDistance(scenario.pings, scenario.road, scenario.zone);
    const expectedByDate = scenario.expectedByDate ?? { '2026-01-01': scenario.expectedKm };
    for (const [date, expectedKm] of Object.entries(expectedByDate)) {
      expect(kilometresFor(result, date)).toBeCloseTo(expectedKm, 6);
    }
  });

  it.fails('does not satisfy the same rule with the intentionally naive implementation', () => {
    const result = naiveDistance(scenario.pings, scenario.zone);
    const expectedByDate = scenario.expectedByDate ?? { '2026-01-01': scenario.expectedKm };
    for (const [date, expectedKm] of Object.entries(expectedByDate)) {
      expect(kilometresFor(result, date)).toBeCloseTo(expectedKm, 6);
    }
  });
});

it('covers outside-to-inside, outside-to-outside, and boundary endpoint zone cases', () => {
  const campaign = zone([[-0.001, -0.001], [0.001, -0.001], [0.001, 0.001], [-0.001, 0.001], [-0.001, -0.001]]);
  const insideMetres = (start, end) => clipSegmentToZone(start, end, campaign).reduce((total, portion) => total + portion.metres, 0);
  expect(insideMetres([-0.002, 0], [0, 0]) / 1000).toBeCloseTo(directKm([-0.001, 0], [0, 0]), 6);
  expect(insideMetres([-0.002, 0], [0.002, 0]) / 1000).toBeCloseTo(directKm([-0.001, 0], [0.001, 0]), 6);
  expect(insideMetres([0, 0], [0.001, 0]) / 1000).toBeCloseTo(directKm([0, 0], [0.001, 0]), 6);
});

describe('independent polygon geometry cases', () => {
  const square = zone([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]);
  const clippedKm = (start, end, campaign = square) => clipSegmentToZone(start, end, campaign)
    .reduce((total, portion) => total + portion.metres, 0) / 1000;

  it('handles a segment completely inside', () => {
    expect(clippedKm([-0.5, 0], [0.5, 0])).toBeCloseTo(directKm([-0.5, 0], [0.5, 0]), 6);
  });

  it('handles a segment completely outside', () => {
    expect(clippedKm([-2, 2], [2, 2])).toBe(0);
  });

  it('clips a segment entering or exiting the polygon', () => {
    expect(clippedKm([-2, 0], [0, 0])).toBeCloseTo(directKm([-1, 0], [0, 0]), 6);
  });

  it('clips both endpoints outside when the segment passes through', () => {
    expect(clippedKm([-2, 0], [2, 0])).toBeCloseTo(directKm([-1, 0], [1, 0]), 6);
  });

  it('excludes a polygon hole while retaining outer portions', () => {
    const withHole = zone([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]);
    withHole.geometry.coordinates.push([[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2], [-0.2, -0.2]]);
    const expected = directKm([-1, 0], [-0.2, 0]) + directKm([0.2, 0], [1, 0]);
    expect(clippedKm([-1, 0], [1, 0], withHole)).toBeCloseTo(expected, 6);
  });

  it('treats travel exactly along the outer boundary as billable', () => {
    expect(clippedKm([-0.5, 1], [0.5, 1])).toBeCloseTo(directKm([-0.5, 1], [0.5, 1]), 6);
  });

  it('does not bill a tangential one-point contact', () => {
    expect(clippedKm([0, 2], [2, 0])).toBe(0);
  });

  it('handles a segment crossing polygon vertices', () => {
    expect(Math.abs(clippedKm([-2, -2], [2, 2]) - directKm([-1, -1], [1, 1]))).toBeLessThan(0.0001);
  });

  it('handles multiple entry and exit intersections from two holes', () => {
    const withHoles = zone([[-3, -1], [3, -1], [3, 1], [-3, 1], [-3, -1]]);
    withHoles.geometry.coordinates.push([[-2, -0.5], [-1, -0.5], [-1, 0.5], [-2, 0.5], [-2, -0.5]]);
    withHoles.geometry.coordinates.push([[1, -0.5], [2, -0.5], [2, 0.5], [1, 0.5], [1, -0.5]]);
    const expected = directKm([-3, 0], [-2, 0]) + directKm([-1, 0], [1, 0]) + directKm([2, 0], [3, 0]);
    expect(clippedKm([-3, 0], [3, 0], withHoles)).toBeCloseTo(expected, 6);
  });

  it('rejects an invalid or malformed polygon', () => {
    expect(() => clipSegmentToZone([-1, 0], [1, 0], { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1]]] } })).toThrow(/Invalid campaign polygon/);
  });
});

describe('threshold and edge-case regressions', () => {
  it('accepts a point measured at 100 metres from the road within geometry tolerance', () => {
    const pointAt100m = destination(point([0, 0]), 0.1, 0).geometry.coordinates;
    const measured = roadDeviationMetres(pointAt100m, routeRoad.features[0]);
    const result = fixedDistanceDetailed([
      ping('2026-01-01T00:00:00Z', 0, 0),
      ping('2026-01-01T00:00:10Z', pointAt100m[0], pointAt100m[1]),
    ], routeRoad, insideZone);
    expect(measured).toBeCloseTo(100, 1);
    expect(result.diagnostics.offRoadRejected).toBe(0);
  });

  it('removes a proposed trip-gap edge greater than five minutes', () => {
    const result = fixedDistanceDetailed([
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:10:00Z', 0.001),
    ], routeRoad, insideZone);
    expect(result.diagnostics.tripGapsExcluded).toBe(1);
    expect(kilometresFor(result.rows, '2026-01-01')).toBe(0);
  });

  it('gives a driver with one retained point zero distance', () => {
    const result = fixedDistance([ping('2026-01-01T00:00:00Z', 0)], routeRoad, insideZone);
    expect(result).toEqual([{ driver_id: driver, date: '2026-01-01', km: 0 }]);
  });

  it('rejects timestamps without terminal Z and invalid coordinates', () => {
    const result = fixedDistanceDetailed([
      ping('2026-01-01T00:00:00', 0),
      ping('2026-01-01T00:00:10Z', 0, 91),
      ping('2026-01-01T00:00:20Z', 0),
    ], routeRoad, insideZone);
    expect(result.diagnostics.invalid).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('keeps the first deterministic record for a conflicting duplicate timestamp', () => {
    const result = fixedDistanceDetailed([
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:00:00Z', 0.5),
      ping('2026-01-01T00:00:10Z', 0.001),
    ], routeRoad, insideZone);
    expect(result.diagnostics.duplicateRemoved).toBe(1);
    expect(result.diagnostics.duplicateConflicts).toHaveLength(1);
    expect(result.diagnostics.offRoadRejected).toBe(0);
    expect(kilometresFor(result.rows, '2026-01-01')).toBeCloseTo(directKm([0, 0], [0.001, 0]), 6);
  });

  it('does not deduplicate identical coordinates at different timestamps', () => {
    const result = fixedDistanceDetailed([
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:00:10Z', 0),
    ], routeRoad, insideZone);
    expect(result.diagnostics.duplicateRemoved).toBe(0);
    expect(kilometresFor(result.rows, '2026-01-01')).toBe(0);
  });

  it('accepts an implied speed at 150 km/h within numerical tolerance', () => {
    const end = destination(point([0, 0]), 150 * 10 / 3600, 90).geometry.coordinates;
    const result = fixedDistanceDetailed([
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:00:10Z', end[0], end[1]),
    ], road([ [0, 0], end ]), insideZone);
    expect(result.diagnostics.speedOutlierRejected).toBe(0);
    expect(distanceMetres([0, 0], end) / 10 * 3.6).toBeCloseTo(150, 3);
  });

  it('splits a long interval at more than one fixed UTC+9 midnight', () => {
    const pieces = splitByLocalMidnight('2026-01-01T14:59:50Z', '2026-01-03T14:59:50Z');
    expect(pieces.map((piece) => piece.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('does not mutate caller input', () => {
    const pings = [ping('2026-01-01T00:00:10Z', 0.001), ping('2026-01-01T00:00:00Z', 0)];
    const before = structuredClone(pings);
    fixedDistance(pings, routeRoad, insideZone);
    expect(pings).toEqual(before);
  });

  it('keeps generated billing outputs finite and nonnegative', () => {
    const rows = parse(fs.readFileSync(path.join(projectRoot, 'data/pings.csv'), 'utf8').split(/\r?\n/).slice(1).join('\n'), { columns: true, skip_empty_lines: true }).map((row) => ({ ...row, lat: Number(row.lat), lon: Number(row.lon) }));
    const roadData = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data/road.geojson'), 'utf8'));
    const zoneData = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data/zone.geojson'), 'utf8'));
    const result = fixedDistance(rows, roadData, zoneData);
    expect(result.every((row) => Number.isFinite(row.km) && row.km >= 0)).toBe(true);
  });

  it('handles overlapping off-road and speed-spike evidence without invalid output', () => {
    const result = fixedDistanceDetailed([
      ping('2026-01-01T00:00:00Z', 0),
      ping('2026-01-01T00:00:10Z', 0.02, 0.002, { injected_fault: 'speed_spike' }),
      ping('2026-01-01T00:00:20Z', 0.001),
    ], routeRoad, insideZone);
    expect(result.diagnostics.offRoadRejected).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('documents that the map receives the fixed retained path', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'check.js'), 'utf8');
    expect(source).toContain('mapPaths(result.chronological, fixed.retainedByDriver)');
  });

  it('rejects a missing driver ID instead of crashing during sorting', () => {
    const result = fixedDistanceDetailed([
      ping('2026-01-01T00:00:00Z', 0, 0, { driver_id: '' }),
      ping('2026-01-01T00:00:10Z', 0.001),
    ], routeRoad, insideZone);
    expect(result.diagnostics.invalid).toBe(1);
    expect(result.diagnostics.invalidRecords[0].reason).toMatch(/driver_id/);
  });
});

describe('end-to-end independent expected CSV comparison', () => {
  it('matches all expected driver/date rows within 1 percent and beats the naive baseline', async () => {
    const csv = (file) => parse(fs.readFileSync(path.join(projectRoot, file), 'utf8').split(/\r?\n/).slice(file.includes('pings') ? 1 : 0).join('\n'), { columns: true, skip_empty_lines: true });
    const pings = csv('data/pings.csv').map((row) => ({ ...row, lat: Number(row.lat), lon: Number(row.lon) }));
    const roadData = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data/road.geojson'), 'utf8'));
    const zoneData = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data/zone.geojson'), 'utf8'));
    const expected = csv('data/expected.csv').map((row) => ({ ...row, km: Number(row.km) }));
    const fixed = fixedDistance(pings, roadData, zoneData);
    const naive = naiveDistance(pings, zoneData);
    const expectedKeys = new Set(expected.map((row) => `${row.driver_id}|${row.local_date}`));
    const fixedKeys = new Set(fixed.map((row) => `${row.driver_id}|${row.date}`));
    expect([...expectedKeys].sort()).toEqual([...fixedKeys].sort());
    expect(fixed.every((row) => Number.isFinite(row.km) && row.km >= 0)).toBe(true);

    let fixedAbsoluteError = 0;
    for (const row of expected) {
      const actual = fixed.find((candidate) => candidate.driver_id === row.driver_id && candidate.date === row.local_date)?.km;
      const difference = actual - row.km;
      fixedAbsoluteError += Math.abs(difference);
      if (row.km === 0) expect(Math.abs(difference)).toBeLessThan(0.00001);
      else expect(Math.abs(difference / row.km) * 100).toBeLessThan(1);
    }

    const naiveByKey = new Map(naive.map((row) => [`${row.driver_id}|${row.date}`, row.km]));
    const naiveAbsoluteError = expected.reduce((total, row) => total + Math.abs((naiveByKey.get(`${row.driver_id}|${row.local_date}`) ?? 0) - row.km), 0);
    expect(fixedAbsoluteError).toBeLessThan(naiveAbsoluteError);
  });
});

describe('billing summary key coverage', () => {
  it('includes a fixed-only driver/date key', async () => {
    const { buildBillingSummary } = await import('../src/billing.js');
    const rows = buildBillingSummary(
      [{ driver_id: 'a', local_date: '2026-01-01', km: 0 }],
      [],
      [{ driver_id: 'a', date: '2026-01-02', km: 1.25 }],
    );
    expect(rows).toEqual([
      { driver_id: 'a', local_date: '2026-01-01', naive_km: '0.000000', fixed_km: '0.000000', expected_km: '0.000000', naive_error_pct: '0.00%', fixed_error_pct: '0.00%' },
      { driver_id: 'a', local_date: '2026-01-02', naive_km: '0.000000', fixed_km: '1.250000', expected_km: '0.000000', naive_error_pct: '0.00%', fixed_error_pct: 'N/A' },
    ]);
  });
});
