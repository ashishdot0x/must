import { DateTime } from 'luxon';
import {
  booleanPointInPolygon,
  booleanPointOnLine,
  distance,
  lineIntersect,
  lineString,
  point,
  pointToLineDistance,
} from '@turf/turf';

export const FIXED_OFFSET = '+09:00';

/** @param {object} ping @returns {[number, number]} */
export function toCoordinate(ping) {
  if (ping.lat === null || ping.lat === undefined || String(ping.lat).trim() === '') throw new Error('Invalid latitude: value is empty');
  if (ping.lon === null || ping.lon === undefined || String(ping.lon).trim() === '') throw new Error('Invalid longitude: value is empty');
  const lat = Number(ping.lat);
  const lon = Number(ping.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error('Invalid GPS coordinate');
  }
  return [lon, lat];
}

/** @param {string} value @returns {DateTime} */
export function parseUtc(value) {
  if (typeof value !== 'string') throw new Error('Invalid UTC timestamp: value must be a string');
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  if (!value.endsWith('Z') || !parsed.isValid) throw new Error(`Invalid UTC timestamp: ${value}`);
  return parsed;
}

/** @param {[number, number]} first @param {[number, number]} second @returns {number} */
export function distanceMetres(first, second) {
  return distance(point(first), point(second), { units: 'meters' });
}

/** @param {[number, number]} coordinate @param {object} roadLine @returns {number} */
export function roadDeviationMetres(coordinate, roadLine) {
  return pointToLineDistance(point(coordinate), roadLine, { units: 'meters' });
}

/** @param {[number, number]} first @param {[number, number]} second @param {number} seconds @returns {number} */
export function speedKmh(first, second, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return distanceMetres(first, second) / 1000 / seconds * 3600;
}

/** @param {[number, number]} start @param {[number, number]} end @param {object} zone @returns {Array<{t0: number, t1: number, metres: number}>} */
export function clipSegmentToZone(start, end, zone) {
  const rings = zone?.geometry?.type === 'Polygon' ? zone.geometry.coordinates : null;
  if (!Array.isArray(rings) || rings.length === 0 || rings.some((ring) => !Array.isArray(ring) || ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)))) {
    throw new Error('Invalid campaign polygon: expected closed rings');
  }
  const segment = lineString([start, end]);
  const totalMetres = distanceMetres(start, end);
  if (totalMetres === 0) return [];

  const cuts = [0, 1];
  for (const ring of rings) {
    for (const intersection of lineIntersect(segment, lineString(ring)).features) {
      const t = distanceMetres(start, intersection.geometry.coordinates) / totalMetres;
      if (t > 1e-9 && t < 1 - 1e-9 && !cuts.some((existing) => Math.abs(existing - t) < 1e-7)) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  const isBoundaryPoint = (coordinate) => rings.some((ring) => {
    const boundary = lineString(ring);
    return booleanPointOnLine(point(coordinate), boundary, { ignoreEnd: false })
      || pointToLineDistance(point(coordinate), boundary, { units: 'meters' }) <= 1e-6;
  });
  const isBillablePoint = (coordinate) => booleanPointInPolygon(point(coordinate), zone) || isBoundaryPoint(coordinate);
  const portions = [];
  for (let index = 1; index < cuts.length; index += 1) {
    const t0 = cuts[index - 1];
    const t1 = cuts[index];
    const fraction = (t0 + t1) / 2;
    const midpoint = [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ];
    if (isBillablePoint(midpoint)) portions.push({ t0, t1, metres: totalMetres * (t1 - t0) });
  }
  return portions;
}

/** @param {string} utcIso @returns {string} */
export function localDate(utcIso) {
  return parseUtc(utcIso).setZone(FIXED_OFFSET).toISODate();
}

/** @param {string} startIso @param {string} endIso @returns {Array<{startMillis: number, endMillis: number, date: string}>} */
export function splitByLocalMidnight(startIso, endIso) {
  const start = parseUtc(startIso).toMillis();
  const end = parseUtc(endIso).toMillis();
  if (end <= start) return [];
  const pieces = [];
  let cursor = start;
  while (cursor < end) {
    const date = DateTime.fromMillis(cursor, { zone: FIXED_OFFSET }).toISODate();
    const nextMidnight = DateTime.fromISO(date, { zone: FIXED_OFFSET }).plus({ days: 1 }).toUTC().toMillis();
    const pieceEnd = Math.min(end, nextMidnight);
    pieces.push({ startMillis: cursor, endMillis: pieceEnd, date });
    cursor = pieceEnd;
  }
  return pieces;
}
