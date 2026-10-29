import { booleanPointInPolygon, distance, point } from '@turf/turf';

/**
 * Calculate intentionally incorrect billable distance for the Phase 3
 * reference comparison.
 *
 * @param {Array<{driver_id: string, ts_utc: string, arrival_ts_utc: string, lat: number|string, lon: number|string}>} pings
 * @param {import('@turf/helpers').Feature<import('geojson').Polygon>} zone
 * @returns {Array<{driver_id: string, date: string, km: number}>}
 */
export function naiveDistance(pings, zone) {
  const totals = new Map();
  const previousByDriver = new Map();

  // BUG: Arrival-order processing. The caller's arrival order is retained;
  // GPS timestamps are not used to reorder records.
  for (const ping of pings) {
    const lat = Number(ping.lat);
    const lon = Number(ping.lon);
    const timestamp = new Date(ping.ts_utc);
    if (!ping.driver_id || !Number.isFinite(lat) || !Number.isFinite(lon) || Number.isNaN(timestamp.valueOf())) {
      continue;
    }

    const current = { ...ping, lat, lon, timestamp };
    const previous = previousByDriver.get(current.driver_id);
    previousByDriver.set(current.driver_id, current);
    if (!previous) continue;

    // BUG: Missing trip-boundary detection can connect unrelated driving sessions.
    // BUG: Duplicate counting. Duplicate records remain in the stream. Exact
    // coordinate duplicates naturally add zero distance rather than being removed.
    // BUG: No off-road filtering. Every finite coordinate is eligible.
    // BUG: No speed filtering. Excessive implied speeds are retained.
    // BUG: Incorrect campaign-zone billing. An endpoint test bills the whole
    // segment and does not clip only the portion inside the polygon.
    const previousInside = booleanPointInPolygon(point([previous.lon, previous.lat]), zone);
    const currentInside = booleanPointInPolygon(point([current.lon, current.lat]), zone);
    if (!previousInside && !currentInside) continue;

    const km = distance(
      point([previous.lon, previous.lat]),
      point([current.lon, current.lat]),
      { units: 'kilometers' },
    );
    if (!Number.isFinite(km)) continue;

    // BUG: Wrong daily timezone. UTC date grouping is intentional; no UTC+9
    // conversion is performed. A segment is assigned to its current endpoint.
    const date = current.timestamp.toISOString().slice(0, 10);
    const key = `${current.driver_id}|${date}`;
    totals.set(key, (totals.get(key) ?? 0) + km);
  }

  return [...totals].map(([key, km]) => {
    const [driver_id, date] = key.split('|');
    return { driver_id, date, km };
  });
}
