import { clipSegmentToZone, distanceMetres, localDate, parseUtc, roadDeviationMetres, speedKmh, splitByLocalMidnight, toCoordinate } from './geo.js';

const ROAD_LIMIT_METRES = 100;
const SPEED_LIMIT_KMH = 150;
// Small tolerance prevents geodesic floating-point noise from rejecting an
// observation that is mathematically exactly on an inclusive threshold.
const THRESHOLD_EPSILON = 1e-9;
const TRIP_GAP_SECONDS = 5 * 60;

/** @typedef {{driver_id: string, ts_utc: string, arrival_ts_utc?: string, lat: number|string, lon: number|string, sourceIndex?: number, tsMillis?: number}} FixedPing */

/** @param {FixedPing[]} pings @param {object} road @param {object} zone @returns {object} */
export function fixedDistanceDetailed(pings, road, zone) {
  const roadLine = road.features?.[0];
  if (!roadLine || roadLine.geometry?.type !== 'LineString') throw new Error('road.geojson must contain a LineString feature');
  const diagnostics = { invalid: 0, invalidRecords: [], duplicateRemoved: 0, duplicateConflicts: [], offRoadRejected: 0, speedOutlierRejected: 0, tripGapsExcluded: 0 };
  const normalized = [];
  for (let sourceIndex = 0; sourceIndex < pings.length; sourceIndex += 1) {
    const ping = pings[sourceIndex];
    try {
      if (typeof ping.driver_id !== 'string' || ping.driver_id.trim() === '') throw new Error('Invalid driver_id: value is empty');
      const timestamp = parseUtc(ping.ts_utc);
      normalized.push({ ...ping, coordinate: toCoordinate(ping), tsMillis: timestamp.toMillis(), sourceIndex });
    } catch (error) {
      diagnostics.invalid += 1;
      diagnostics.invalidRecords.push({ sourceIndex, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  // Step 1: sort by driver and GPS timestamp without mutating the caller's array.
  normalized.sort((a, b) => a.driver_id.localeCompare(b.driver_id) || a.tsMillis - b.tsMillis || a.sourceIndex - b.sourceIndex);

  // Step 2: keep the first deterministic record for each driver/timestamp.
  const deduplicated = [];
  const identities = new Set();
  for (const ping of normalized) {
    const key = `${ping.driver_id}|${ping.tsMillis}`;
    if (identities.has(key)) {
      diagnostics.duplicateRemoved += 1;
      const kept = deduplicated.at(-1);
      if (kept.lat !== ping.lat || kept.lon !== ping.lon) {
        diagnostics.duplicateConflicts.push({
          driver_id: ping.driver_id,
          timestamp_ms: ping.tsMillis,
          keptSourceIndex: kept.sourceIndex,
          discardedSourceIndex: ping.sourceIndex,
        });
      }
      continue;
    }
    identities.add(key);
    deduplicated.push(ping);
  }

  // Step 3: remove road deviations before speed analysis.
  const onRoad = deduplicated.filter((ping) => {
    const rejected = roadDeviationMetres(ping.coordinate, roadLine) > ROAD_LIMIT_METRES + THRESHOLD_EPSILON;
    if (rejected) diagnostics.offRoadRejected += 1;
    return !rejected;
  });

  // Step 4: repeatedly remove a point only when adjacent evidence supports it.
  const byDriver = new Map();
  for (const ping of onRoad) {
    if (!byDriver.has(ping.driver_id)) byDriver.set(ping.driver_id, []);
    byDriver.get(ping.driver_id).push(ping);
  }
  const retainedByDriver = new Map();
  for (const [driver, records] of byDriver) {
    const working = [...records];
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = 1; index < working.length; index += 1) {
        const previous = working[index - 1];
        const current = working[index];
        const seconds = (current.tsMillis - previous.tsMillis) / 1000;
        if (seconds <= 0 || seconds > TRIP_GAP_SECONDS) continue;
        const speed = speedKmh(previous.coordinate, current.coordinate, seconds);
        if (speed <= SPEED_LIMIT_KMH + THRESHOLD_EPSILON) continue;

        let removeIndex = -1;
        if (index + 1 < working.length) {
          const next = working[index + 1];
          const nextSeconds = (next.tsMillis - current.tsMillis) / 1000;
          const bridgeSeconds = (next.tsMillis - previous.tsMillis) / 1000;
          if (nextSeconds > 0 && nextSeconds <= TRIP_GAP_SECONDS && speedKmh(previous.coordinate, next.coordinate, bridgeSeconds) <= SPEED_LIMIT_KMH + THRESHOLD_EPSILON) removeIndex = index;
        }
        if (removeIndex < 0 && index >= 2) {
          const beforePrevious = working[index - 2];
          const bridgeSeconds = (current.tsMillis - beforePrevious.tsMillis) / 1000;
          if (bridgeSeconds > 0 && bridgeSeconds <= TRIP_GAP_SECONDS && speedKmh(beforePrevious.coordinate, current.coordinate, bridgeSeconds) <= SPEED_LIMIT_KMH + THRESHOLD_EPSILON) removeIndex = index - 1;
        }
        if (removeIndex < 0) {
          // Ambiguous edges use a deterministic geometry tie-breaker only.
          const previousDeviation = roadDeviationMetres(previous.coordinate, roadLine);
          const currentDeviation = roadDeviationMetres(current.coordinate, roadLine);
          removeIndex = currentDeviation >= previousDeviation ? index : index - 1;
        }
        working.splice(removeIndex, 1);
        diagnostics.speedOutlierRejected += 1;
        changed = true;
        break;
      }
    }
    retainedByDriver.set(driver, working);
  }

  // Steps 5–7: exclude inferred trip gaps, clip to the zone, then split by UTC+9 midnight.
  const totals = new Map();
  const add = (driver, date, metres) => {
    const key = `${driver}|${date}`;
    totals.set(key, (totals.get(key) ?? 0) + metres);
  };
  for (const [driver, records] of retainedByDriver) {
    for (let index = 1; index < records.length; index += 1) {
      const previous = records[index - 1];
      const current = records[index];
      const seconds = (current.tsMillis - previous.tsMillis) / 1000;
      if (seconds <= 0) continue;
      if (seconds > TRIP_GAP_SECONDS) {
        diagnostics.tripGapsExcluded += 1;
        continue;
      }
      for (const portion of clipSegmentToZone(previous.coordinate, current.coordinate, zone)) {
        const portionStart = previous.tsMillis + (current.tsMillis - previous.tsMillis) * portion.t0;
        const portionEnd = previous.tsMillis + (current.tsMillis - previous.tsMillis) * portion.t1;
        const pieces = splitByLocalMidnight(new Date(portionStart).toISOString(), new Date(portionEnd).toISOString());
        for (const piece of pieces) {
          const fraction = (piece.endMillis - piece.startMillis) / (portionEnd - portionStart || 1);
          add(driver, piece.date, portion.metres * fraction);
        }
      }
    }
  }

  const dates = [...new Set([...retainedByDriver.values()].flat().map((ping) => localDate(ping.ts_utc)))].sort();
  const rows = [];
  for (const driver of [...byDriver.keys()].sort()) {
    for (const date of dates) rows.push({ driver_id: driver, date, km: (totals.get(`${driver}|${date}`) ?? 0) / 1000 });
  }
  return { rows, retainedByDriver, diagnostics };
}

/** @param {FixedPing[]} pings @param {object} road @param {object} zone @returns {Array<{driver_id: string, date: string, km: number}>} */
export function fixedDistance(pings, road, zone) {
  return fixedDistanceDetailed(pings, road, zone).rows;
}
