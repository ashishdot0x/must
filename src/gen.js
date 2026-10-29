import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import seedrandom from 'seedrandom';
import { DateTime } from 'luxon';
import { stringify } from 'csv-stringify/sync';
import {
  along,
  bearing,
  booleanPointInPolygon,
  destination,
  distance,
  featureCollection,
  feature,
  lineIntersect,
  lineString,
  point,
  pointToLineDistance,
} from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(projectRoot, 'data');
const FIXED_OFFSET = '+09:00';
const DRIVERS = ['driver_1', 'driver_2', 'driver_3', 'driver_4', 'driver_5'];
const REPORTING_DATES = ['2026-01-01', '2026-01-02', '2026-01-03'];
const STEP_SECONDS = 10;
const TRIP_SECONDS = 40 * 60;

/** @param {number} value @returns {string} */
function fixed(value) {
  return value.toFixed(7);
}

/** @param {Date} date @returns {string} */
function utcIso(date) {
  return date.toISOString().replace('.000Z', 'Z');
}

/** @param {string} iso @returns {DateTime} */
function utcDateTime(iso) {
  return DateTime.fromISO(iso, { zone: 'utc' });
}

/** @param {string} iso @returns {string} */
function localDate(iso) {
  return utcDateTime(iso).setZone(FIXED_OFFSET).toISODate();
}

/**
 * Return the distance inside the zone for one segment, split at all polygon
 * boundary crossings and fixed UTC+9 midnight boundaries.
 * @param {[number, number]} start
 * @param {[number, number]} end
 * @param {string} startTs
 * @param {string} endTs
 * @param {object} zone
 * @returns {Map<string, number>}
 */
function clippedDistanceByDate(start, end, startTs, endTs, zone) {
  const segment = lineString([start, end]);
  const boundary = lineString(zone.geometry.coordinates[0]);
  const totalKm = distance(point(start), point(end), { units: 'kilometers' });
  const cuts = [0, 1];

  for (const intersection of lineIntersect(segment, boundary).features) {
    const t = totalKm === 0 ? 0 : distance(point(start), intersection, { units: 'kilometers' }) / totalKm;
    if (t > 1e-9 && t < 1 - 1e-9 && !cuts.some((value) => Math.abs(value - t) < 1e-7)) {
      cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);

  const startTime = utcDateTime(startTs);
  const endTime = utcDateTime(endTs);
  const result = new Map();
  const add = (date, km) => result.set(date, (result.get(date) ?? 0) + km);

  for (let index = 0; index < cuts.length - 1; index += 1) {
    const t0 = cuts[index];
    const t1 = cuts[index + 1];
    const midpoint = along(segment, totalKm * ((t0 + t1) / 2), { units: 'kilometers' });
    if (!booleanPointInPolygon(midpoint, zone)) continue;

    const intervalStart = startTime.plus({ milliseconds: (endTime - startTime) * t0 });
    const intervalEnd = startTime.plus({ milliseconds: (endTime - startTime) * t1 });
    let cursor = intervalStart;
    const intervalKm = totalKm * (t1 - t0);

    while (cursor < intervalEnd) {
      const date = cursor.setZone(FIXED_OFFSET).toISODate();
      const nextMidnight = DateTime.fromISO(date, { zone: FIXED_OFFSET }).plus({ days: 1 }).toUTC();
      const pieceEnd = nextMidnight < intervalEnd ? nextMidnight : intervalEnd;
      const fraction = (pieceEnd - cursor) / (intervalEnd - intervalStart || 1);
      add(date, intervalKm * fraction);
      cursor = pieceEnd;
    }
  }
  return result;
}

/** @param {object[]} cleanTrips @param {object} zone @returns {object[]} */
function createExpected(cleanTrips, zone) {
  const totals = new Map();
  for (const driver of DRIVERS) {
    for (const date of REPORTING_DATES) totals.set(`${driver}|${date}`, 0);
  }

  for (const trip of cleanTrips) {
    for (let index = 1; index < trip.points.length; index += 1) {
      const previous = trip.points[index - 1];
      const current = trip.points[index];
      const byDate = clippedDistanceByDate(
        [previous.lon, previous.lat],
        [current.lon, current.lat],
        previous.ts_utc,
        current.ts_utc,
        zone,
      );
      for (const [date, km] of byDate) {
        const key = `${trip.driver_id}|${date}`;
        if (totals.has(key)) totals.set(key, totals.get(key) + km);
      }
    }
  }

  return [...totals].map(([key, km]) => {
    const [driver_id, local_date] = key.split('|');
    return { driver_id, local_date, km: km.toFixed(6) };
  });
}

/** @param {number} seed @returns {object} */
function generate(seed) {
  const rng = seedrandom(String(seed));
  const road = lineString([
    [139.6700, 35.6600], [139.6900, 35.6800], [139.7100, 35.7000],
    [139.7300, 35.6900], [139.7500, 35.7100], [139.7700, 35.7300],
    [139.7900, 35.7000], [139.8100, 35.7200], [139.8300, 35.7400],
    [139.8500, 35.7200], [139.8700, 35.7400],
  ], { name: 'fictional_tokyo_route' });
  const zone = feature({
    type: 'Polygon',
    coordinates: [[
      [139.7200, 35.6800], [139.8200, 35.6800], [139.8200, 35.7300],
      [139.7200, 35.7300], [139.7200, 35.6800],
    ]],
  }, { name: 'fictional_campaign_zone' });

  const routeKm = distance(along(road, 0), along(road, 999, { units: 'kilometers' }), { units: 'kilometers' });
  const starts = ['2026-01-01T00:00:00Z', '2026-01-01T14:30:00Z', '2026-01-02T14:30:00Z'];
  const cleanTrips = [];
  let arrivalCounter = 0;

  for (let driverIndex = 0; driverIndex < DRIVERS.length; driverIndex += 1) {
    for (let tripIndex = 0; tripIndex < starts.length; tripIndex += 1) {
      const driver_id = DRIVERS[driverIndex];
      const speedKmh = 18 + driverIndex * 1.1 + tripIndex * 0.7;
      const stepKm = speedKmh * STEP_SECONDS / 3600;
      const count = TRIP_SECONDS / STEP_SECONDS;
      const startKm = 0.5 + driverIndex * 1.9 + tripIndex * 2.2;
      const points = [];
      const tripStart = utcDateTime(starts[tripIndex]);
      for (let pointIndex = 0; pointIndex <= count; pointIndex += 1) {
        const routePosition = Math.min(startKm + stepKm * pointIndex, routeKm - 0.01);
        const position = along(road, routePosition, { units: 'kilometers' });
        const ts = tripStart.plus({ seconds: pointIndex * STEP_SECONDS }).toUTC().toISO({ suppressMilliseconds: true });
        const arrivalJitter = Math.floor(rng() * 4);
        points.push({
          driver_id,
          ts_utc: ts,
          arrival_ts_utc: tripStart.plus({ seconds: pointIndex * STEP_SECONDS + arrivalJitter }).toUTC().toISO({ suppressMilliseconds: true }),
          lat: position.geometry.coordinates[1],
          lon: position.geometry.coordinates[0],
          injected_fault: '',
          _arrivalOrder: arrivalCounter++,
        });
      }
      cleanTrips.push({ driver_id, tripIndex, points });
    }
  }

  const cleanPoints = cleanTrips.flatMap((trip) => trip.points);
  const faulty = cleanPoints.map((record) => ({ ...record }));
  const byKey = new Map(faulty.map((record) => [`${record.driver_id}|${record.ts_utc}`, record]));
  const faultCounts = { off_road: 0, speed_spike: 0, duplicate: 0, late: 0 };

  for (let driverIndex = 0; driverIndex < DRIVERS.length; driverIndex += 1) {
    const driver = DRIVERS[driverIndex];
    const tripPoints = cleanTrips.filter((trip) => trip.driver_id === driver);
    for (const [tripIndex, trip] of tripPoints.entries()) {
      const offRoad = byKey.get(`${driver}|${trip.points[40].ts_utc}`);
      const speedSpike = byKey.get(`${driver}|${trip.points[120].ts_utc}`);
      const late = byKey.get(`${driver}|${trip.points[180].ts_utc}`);

      const roadDistance = (candidate) => pointToLineDistance(candidate, road, { units: 'meters' });
      const original = point([offRoad.lon, offRoad.lat]);
      const offsetBearing = bearing(along(road, 1), along(road, 2));
      let displaced = null;
      for (const direction of [offsetBearing + 90, offsetBearing - 90, offsetBearing, offsetBearing + 180]) {
        const candidate = destination(original, 0.35, direction, { units: 'kilometers' });
        if (roadDistance(candidate) > 100) { displaced = candidate; break; }
      }
      if (!displaced) throw new Error('Could not create a verified off-road fault');
      offRoad.lon = displaced.geometry.coordinates[0];
      offRoad.lat = displaced.geometry.coordinates[1];
      offRoad.injected_fault = 'off_road';
      faultCounts.off_road += 1;

      const previous = trip.points[119];
      const spikePoint = destination(point([previous.lon, previous.lat]), 0.8, bearing(point([previous.lon, previous.lat]), point([trip.points[121].lon, trip.points[121].lat])), { units: 'kilometers' });
      speedSpike.lon = spikePoint.geometry.coordinates[0];
      speedSpike.lat = spikePoint.geometry.coordinates[1];
      speedSpike.injected_fault = 'speed_spike';
      faultCounts.speed_spike += 1;

      const duplicateSource = trip.points[80];
      faulty.push({ ...duplicateSource, injected_fault: 'duplicate', _arrivalOrder: arrivalCounter++ });
      faultCounts.duplicate += 1;

      late.arrival_ts_utc = utcDateTime(trip.points[179].arrival_ts_utc).minus({ seconds: 20 + tripIndex }).toUTC().toISO({ suppressMilliseconds: true });
      late.injected_fault = 'late';
      faultCounts.late += 1;
    }
  }

  const expected = createExpected(cleanTrips, zone);
  const outputRecords = faulty
    .sort((a, b) => a.arrival_ts_utc.localeCompare(b.arrival_ts_utc) || a._arrivalOrder - b._arrivalOrder)
    .map(({ _arrivalOrder, ...record }) => ({
      ...record,
      lat: fixed(record.lat),
      lon: fixed(record.lon),
    }));

  const csv = (rows, columns) => stringify(rows, { header: true, columns, record_delimiter: '\n' });
  const pingsCsv = '# SYNTHETIC DATA - generated by gen.js, seed=' + seed + '\n'
    + csv(outputRecords, ['driver_id', 'ts_utc', 'arrival_ts_utc', 'lat', 'lon', 'injected_fault']);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'road.geojson'), JSON.stringify(featureCollection([road]), null, 2) + '\n');
  fs.writeFileSync(path.join(dataDir, 'zone.geojson'), JSON.stringify(zone, null, 2) + '\n');
  fs.writeFileSync(path.join(dataDir, 'pings.csv'), pingsCsv);
  fs.writeFileSync(path.join(dataDir, 'expected.csv'), csv(expected, ['driver_id', 'local_date', 'km']));

  const boundaryCrossings = cleanTrips.reduce((count, trip) => {
    for (let index = 1; index < trip.points.length; index += 1) {
      const before = booleanPointInPolygon(point([trip.points[index - 1].lon, trip.points[index - 1].lat]), zone);
      const after = booleanPointInPolygon(point([trip.points[index].lon, trip.points[index].lat]), zone);
      if (before !== after) count += 1;
    }
    return count;
  }, 0);
  const midnightTrips = cleanTrips.filter((trip) => localDate(trip.points[0].ts_utc) !== localDate(trip.points.at(-1).ts_utc)).length;
  const expectedTotalKm = expected.reduce((sum, row) => sum + Number(row.km), 0);
  return { road, zone, cleanPoints, outputRecords, expected, faultCounts, boundaryCrossings, midnightTrips, expectedTotalKm };
}

const seedArgIndex = process.argv.indexOf('--seed');
const seed = seedArgIndex >= 0 ? Number(process.argv[seedArgIndex + 1]) : 42;
if (!Number.isInteger(seed)) throw new Error('Seed must be an integer, for example: node src/gen.js --seed 42');
const result = generate(seed);
console.log(`Seed used: ${seed}`);
console.log(`Total pings: ${result.outputRecords.length}`);
console.log(`Clean pings: ${result.cleanPoints.length}`);
console.log(`off_road: ${result.faultCounts.off_road}`);
console.log(`speed_spike: ${result.faultCounts.speed_spike}`);
console.log(`duplicate: ${result.faultCounts.duplicate}`);
console.log(`late: ${result.faultCounts.late}`);
console.log(`Driver count: ${DRIVERS.length}`);
console.log(`UTC+9 reporting dates: ${REPORTING_DATES.join(', ')}`);
console.log(`Trips crossing local midnight: ${result.midnightTrips}`);
console.log(`Campaign-zone boundary crossings: ${result.boundaryCrossings}`);
console.log(`Expected total billable kilometres: ${result.expectedTotalKm.toFixed(6)}`);
console.log('Generated files: data/pings.csv, data/road.geojson, data/zone.geojson, data/expected.csv');
