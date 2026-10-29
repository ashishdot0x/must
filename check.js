import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { DateTime } from 'luxon';
import {
  booleanPointInPolygon,
  distance,
  lineIntersect,
  lineString,
  point,
  pointToLineDistance,
} from '@turf/turf';
import { naiveDistance } from './src/naiveCalc.js';
import { fixedDistanceDetailed } from './src/fixedCalc.js';
import { buildBillingSummary } from './src/billing.js';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(projectRoot, 'data');
const reportsDir = path.join(projectRoot, 'reports');
const REQUIRED_COLUMNS = ['driver_id', 'ts_utc', 'arrival_ts_utc', 'lat', 'lon', 'injected_fault'];
const EXPECTED_DRIVERS = new Set(['driver_1', 'driver_2', 'driver_3', 'driver_4', 'driver_5']);
const TRIP_GAP_SECONDS = 5 * 60;
const SPEED_LIMIT_KMH = 150;
const ROAD_LIMIT_METRES = 100;
const FIXED_OFFSET = '+09:00';

/** @typedef {{driver_id: string, ts_utc: string, arrival_ts_utc: string, lat: number, lon: number, injected_fault: string, source_row: number, tsMillis: number, arrivalMillis: number}} Ping */

/** @param {string} value @returns {DateTime} */
function parseUtc(value) {
  const result = DateTime.fromISO(value, { zone: 'utc' });
  if (!value.endsWith('Z') || !result.isValid) {
    throw new Error(`Invalid UTC timestamp: ${value}`);
  }
  return result;
}

/** @param {string} filePath @returns {Ping[]} */
function readPings(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  if (!lines[0]?.startsWith('# SYNTHETIC DATA')) {
    throw new Error('The first line must be the synthetic-data metadata line.');
  }
  const rows = parse(lines.slice(1).join('\n'), { columns: true, skip_empty_lines: true });
  const columns = Object.keys(rows[0] ?? {});
  if (JSON.stringify(columns) !== JSON.stringify(REQUIRED_COLUMNS)) {
    throw new Error(`Unexpected CSV columns. Expected: ${REQUIRED_COLUMNS.join(',')}`);
  }

  return rows.map((row, index) => {
    if (!EXPECTED_DRIVERS.has(row.driver_id)) throw new Error(`Invalid driver_id at source row ${index + 3}: ${row.driver_id}`);
    const ts = parseUtc(row.ts_utc);
    const arrival = parseUtc(row.arrival_ts_utc);
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error(`Invalid coordinates at source row ${index + 3}`);
    }
    return {
      ...row,
      lat,
      lon,
      source_row: index + 3,
      tsMillis: ts.toMillis(),
      arrivalMillis: arrival.toMillis(),
    };
  });
}

/** @param {Ping[]} pings @returns {Map<string, Ping[]>} */
function groupChronologically(pings) {
  const byDriver = new Map();
  for (const ping of pings) {
    if (!byDriver.has(ping.driver_id)) byDriver.set(ping.driver_id, new Map());
    const byTimestamp = byDriver.get(ping.driver_id);
    const key = String(ping.tsMillis);
    if (!byTimestamp.has(key)) byTimestamp.set(key, ping);
  }
  return new Map([...byDriver].map(([driver, byTimestamp]) => [
    driver,
    [...byTimestamp.values()].sort((a, b) => a.tsMillis - b.tsMillis || a.source_row - b.source_row),
  ]));
}

/** @param {Ping} first @param {Ping} second @returns {number} */
function gapSeconds(first, second) {
  return (second.tsMillis - first.tsMillis) / 1000;
}

/** @param {Ping} ping @param {Map<number, Set<string>>} flags @param {string} name @param {string} detail */
function addFlag(ping, flags, name, detail) {
  if (!flags.has(ping.source_row)) flags.set(ping.source_row, new Set());
  flags.get(ping.source_row).add(name);
  if (!ping._details) ping._details = [];
  ping._details.push(`${name}: ${detail}`);
}

/** @param {Ping[]} pings @param {object} road @param {object} zone @param {Map<number, Set<string>>} flags @returns {object} */
function detect(pings, road, zone, flags) {
  const roadLine = road.features?.[0];
  if (!roadLine || roadLine.geometry?.type !== 'LineString') throw new Error('road.geojson must contain a LineString feature.');
  const boundary = lineString(zone.geometry.coordinates[0]);
  const chronological = groupChronologically(pings);
  const events = { speed: 0, zone: 0, midnight: 0, tripGap: 0 };
  const eventsByDriver = new Map([...chronological.keys()].map((driver) => [driver, { speed: 0, zone: 0, midnight: 0, tripGap: 0 }]));
  const countEvent = (driver, name) => {
    events[name] += 1;
    eventsByDriver.get(driver)[name] += 1;
  };
  const rawSpeeds = [];
  const preliminarySpeeds = [];

  const firstByIdentity = new Map();
  for (const ping of pings) {
    const key = `${ping.driver_id}|${ping.ts_utc}`;
    const first = firstByIdentity.get(key);
    if (!first) {
      firstByIdentity.set(key, ping);
      continue;
    }
    const conflict = first.lat !== ping.lat || first.lon !== ping.lon;
    addFlag(ping, flags, 'duplicate', conflict ? `repeated identity with coordinate conflict against source row ${first.source_row}` : `repeated identity; first source row ${first.source_row} retained`);
    if (conflict) addFlag(ping, flags, 'duplicate_conflict', `coordinates differ from source row ${first.source_row}`);
  }

  const lastArrivalByDriver = new Map();
  for (const ping of pings) {
    const previous = lastArrivalByDriver.get(ping.driver_id);
    if (previous && ping.tsMillis < previous.tsMillis) {
      addFlag(ping, flags, 'out_of_order', `GPS timestamp precedes previous arrival-order timestamp at source row ${previous.source_row}`);
    }
    lastArrivalByDriver.set(ping.driver_id, ping);
  }

  for (const ping of pings) {
    const metres = pointToLineDistance(point([ping.lon, ping.lat]), roadLine, { units: 'meters' });
    if (metres > ROAD_LIMIT_METRES) addFlag(ping, flags, 'off_road', `minimum road distance ${metres.toFixed(3)} m`);
  }

  for (const [driver, records] of chronological) {
    // A sample exactly at local midnight is not itself a positive-duration
    // crossing edge. When it has normal samples immediately before and after,
    // record the path-level midnight transition without mislabeling either
    // adjacent 10-second segment as crossing the boundary.
    for (let index = 1; index < records.length - 1; index += 1) {
      const currentLocal = DateTime.fromMillis(records[index].tsMillis, { zone: FIXED_OFFSET });
      const atMidnight = currentLocal.hour === 0
        && currentLocal.minute === 0
        && currentLocal.second === 0
        && currentLocal.millisecond === 0;
      if (atMidnight && gapSeconds(records[index - 1], records[index]) <= TRIP_GAP_SECONDS && gapSeconds(records[index], records[index + 1]) <= TRIP_GAP_SECONDS) {
        countEvent(driver, 'midnight');
        addFlag(records[index], flags, 'crosses_local_midnight', 'exact UTC+9 midnight sample with positive-duration segments immediately before and after; adjacent edges are not individually counted as crossing');
      }
    }

    for (let index = 1; index < records.length; index += 1) {
      const previous = records[index - 1];
      const current = records[index];
      const seconds = gapSeconds(previous, current);
      if (seconds > TRIP_GAP_SECONDS) {
        countEvent(driver, 'tripGap');
        addFlag(current, flags, 'trip_gap', `chronological GPS gap ${Math.round(seconds / 60)} minutes after source row ${previous.source_row}; threshold ${TRIP_GAP_SECONDS / 60} minutes`);
        continue;
      }
      if (seconds <= 0) continue;

      const kilometres = distance(point([previous.lon, previous.lat]), point([current.lon, current.lat]), { units: 'kilometers' });
      const speed = kilometres / seconds * 3600;
      rawSpeeds.push(speed);
      if (speed <= SPEED_LIMIT_KMH) preliminarySpeeds.push(speed);
      if (speed > SPEED_LIMIT_KMH) {
        countEvent(driver, 'speed');
        const previousRoad = pointToLineDistance(point([previous.lon, previous.lat]), roadLine, { units: 'meters' });
        const currentRoad = pointToLineDistance(point([current.lon, current.lat]), roadLine, { units: 'meters' });
        const suspected = previousRoad > ROAD_LIMIT_METRES && currentRoad <= ROAD_LIMIT_METRES
          ? `source row ${previous.source_row}`
          : currentRoad > ROAD_LIMIT_METRES && previousRoad <= ROAD_LIMIT_METRES
            ? `source row ${current.source_row}`
            : 'ambiguous between both endpoints';
        const detail = `${speed.toFixed(3)} km/h on edge ${previous.source_row}->${current.source_row}; suspected outlier ${suspected}`;
        addFlag(previous, flags, 'speed_spike', detail);
        addFlag(current, flags, 'speed_spike', detail);
      }

      const previousPoint = point([previous.lon, previous.lat]);
      const currentPoint = point([current.lon, current.lat]);
      const previousInside = booleanPointInPolygon(previousPoint, zone);
      const currentInside = booleanPointInPolygon(currentPoint, zone);
      const intersections = lineIntersect(lineString([previousPoint.geometry.coordinates, currentPoint.geometry.coordinates]), boundary).features;
      if (intersections.length > 0 || previousInside !== currentInside) {
        countEvent(driver, 'zone');
        const detail = `${intersections.length} boundary intersection(s); endpoints inside=${previousInside}/${currentInside}`;
        addFlag(previous, flags, 'zone_edge_segment', detail);
        addFlag(current, flags, 'zone_edge_segment', detail);
      }

      const startLocal = DateTime.fromMillis(previous.tsMillis, { zone: FIXED_OFFSET });
      const endLocal = DateTime.fromMillis(current.tsMillis, { zone: FIXED_OFFSET });
      let boundaryCursor = startLocal.startOf('day').plus({ days: 1 });
      let midnightCount = 0;
      while (boundaryCursor.toMillis() > previous.tsMillis && boundaryCursor.toMillis() < current.tsMillis) {
        midnightCount += 1;
        boundaryCursor = boundaryCursor.plus({ days: 1 });
      }
      if (midnightCount > 0) {
        const detail = `${midnightCount} fixed UTC+9 midnight boundary(ies) between ${startLocal.toISO()} and ${endLocal.toISO()}`;
        addFlag(previous, flags, 'crosses_local_midnight', detail);
        addFlag(current, flags, 'crosses_local_midnight', detail);
      }
    }
    void driver;
  }

  return { chronological, events, eventsByDriver, rawSpeeds, preliminarySpeeds };
}

/** @param {number[]} values @returns {object} */
function speedStats(values) {
  if (values.length === 0) return { count: 0, min: null, p50: null, p99: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  return { count: sorted.length, min: sorted[0], p50: percentile(0.5), p99: percentile(0.99), max: sorted.at(-1) };
}

/** @param {Ping[]} pings @param {Map<number, Set<string>>} flags @returns {object[]} */
function makeFlagRows(pings, flags) {
  return pings.map((ping) => ({
    source_row: ping.source_row,
    driver_id: ping.driver_id,
    ts_utc: ping.ts_utc,
    arrival_ts_utc: ping.arrival_ts_utc,
    lat: ping.lat,
    lon: ping.lon,
    detected_flags: [...(flags.get(ping.source_row) ?? [])].join('|'),
    injected_fault: ping.injected_fault,
    diagnostic_details: (ping._details ?? []).join(' || '),
  }));
}

/** @param {Ping[]} pings @param {Map<number, Set<string>>} flags @param {object} chronologicalInfo @returns {object[]} */
function makeSummary(pings, flags, chronologicalInfo) {
  return [...EXPECTED_DRIVERS].sort().map((driver_id) => {
    const driverRows = pings.filter((ping) => ping.driver_id === driver_id);
    const uniqueFlagged = new Set(driverRows.filter((ping) => flags.has(ping.source_row)).map((ping) => ping.source_row));
    const count = (name) => driverRows.filter((ping) => flags.get(ping.source_row)?.has(name)).length;
    return {
      driver_id,
      records: driverRows.length,
      duplicate_points: count('duplicate'),
      out_of_order_points: count('out_of_order'),
      off_road_points: count('off_road'),
      speed_spike_points: count('speed_spike'),
      zone_edge_points: count('zone_edge_segment'),
      local_midnight_points: count('crosses_local_midnight'),
      trip_gap_points: count('trip_gap'),
      uniquely_flagged_points: uniqueFlagged.size,
      speed_edge_events: chronologicalInfo.eventsByDriver.get(driver_id).speed,
      zone_edge_events: chronologicalInfo.eventsByDriver.get(driver_id).zone,
      midnight_segment_events: chronologicalInfo.eventsByDriver.get(driver_id).midnight,
      trip_gap_events: chronologicalInfo.eventsByDriver.get(driver_id).tripGap,
    };
  });
}

/** @param {Ping[]} pings @param {object} zone @returns {object[]} */
function billingSummary(pings, zone, fixedRows) {
  const expected = parse(fs.readFileSync(path.join(dataDir, 'expected.csv'), 'utf8'), { columns: true });
  const naive = naiveDistance(pings, zone);
  return buildBillingSummary(expected, naive, fixedRows);
}

/** @param {Map<string, Ping[]>} chronological @param {Map<string, Ping[]>} retainedByDriver @returns {object} */
function mapPaths(chronological, retainedByDriver) {
  const rawPaths = [];
  const filteredPaths = [];
  for (const [driver_id, records] of chronological) {
    let raw = [];
    let filtered = [];
    for (let index = 0; index < records.length; index += 1) {
      const ping = records[index];
      if (index > 0 && gapSeconds(records[index - 1], ping) > TRIP_GAP_SECONDS) {
        if (raw.length > 1) rawPaths.push({ driver_id, coordinates: raw });
        raw = [];
      }
      const coordinate = [ping.lat, ping.lon];
      raw.push(coordinate);
    }
    if (raw.length > 1) rawPaths.push({ driver_id, coordinates: raw });

    const retained = retainedByDriver.get(driver_id) ?? [];
    for (let index = 0; index < retained.length; index += 1) {
      const ping = retained[index];
      if (index > 0 && gapSeconds(retained[index - 1], ping) > TRIP_GAP_SECONDS) {
        if (filtered.length > 1) filteredPaths.push({ driver_id, coordinates: filtered });
        filtered = [];
      }
      filtered.push([ping.coordinate[1], ping.coordinate[0]]);
    }
    if (filtered.length > 1) filteredPaths.push({ driver_id, coordinates: filtered });
  }
  return { rawPaths, filteredPaths };
}

/** @param {object} mapData @param {object} road @param {object} zone */
function writeMap(mapData, road, zone) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GPS QA Diagnostic Map</title><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<style>html,body,#map{height:100%;margin:0}.legend{background:white;padding:8px;line-height:1.5;box-shadow:0 0 8px #999}.swatch{display:inline-block;width:12px;height:12px;margin-right:5px}</style></head>
<body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script><script>
const road=${JSON.stringify(road)}; const zone=${JSON.stringify(zone)}; const rawPaths=${JSON.stringify(mapData.rawPaths)}; const filteredPaths=${JSON.stringify(mapData.filteredPaths)}; const flagged=${JSON.stringify(mapData.flagged)};
const map=L.map('map').setView([35.70,139.77],11); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
L.geoJSON(road,{style:{color:'#555',weight:3}}).addTo(map); L.geoJSON(zone,{style:{color:'#7b3fb6',fillColor:'#b98be0',fillOpacity:.2}}).addTo(map);
rawPaths.forEach(p=>L.polyline(p.coordinates,{color:'red',weight:2,opacity:.55}).addTo(map)); filteredPaths.forEach(p=>L.polyline(p.coordinates,{color:'green',weight:3,opacity:.8}).bindTooltip('Fixed-calculator retained path.').addTo(map));
flagged.filter(p=>p.detected_flags).forEach(p=>L.circleMarker([p.lat,p.lon],{radius:5,color:'#111',fillColor:'#ff8c00',fillOpacity:.9}).bindPopup('<b>'+p.driver_id+'</b><br>'+p.ts_utc+'<br>Flags: '+p.detected_flags+'<br>'+p.diagnostic_details).addTo(map));
const legend=L.control({position:'topright'}); legend.onAdd=function(){const d=L.DomUtil.create('div','legend');d.innerHTML='<b>Legend</b><br><span class="swatch" style="background:red"></span>Raw GPS route<br><span class="swatch" style="background:green"></span>Fixed-calculator retained path<br><span class="swatch" style="background:#ff8c00"></span>Flagged point<br><span class="swatch" style="background:#b98be0"></span>Campaign zone';return d}; legend.addTo(map);
</script></body></html>`;
  fs.writeFileSync(path.join(reportsDir, 'map.html'), html);
}

function main() {
  const inputPath = process.argv[2];
  const wantsMap = process.argv.includes('--map');
  if (!inputPath || (process.argv.length > 3 && !wantsMap)) throw new Error('Usage: node check.js data/pings.csv [--map]');
  const pings = readPings(path.resolve(projectRoot, inputPath));
  const road = JSON.parse(fs.readFileSync(path.join(dataDir, 'road.geojson'), 'utf8'));
  const zone = JSON.parse(fs.readFileSync(path.join(dataDir, 'zone.geojson'), 'utf8'));
  const flags = new Map();
  const result = detect(pings, road, zone, flags);
  const fixed = fixedDistanceDetailed(pings, road, zone);
  const flagRows = makeFlagRows(pings, flags);
  const summary = makeSummary(pings, flags, result);
  const billing = billingSummary(pings, zone, fixed.rows);
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'flags.csv'), stringify(flagRows, { header: true, record_delimiter: '\n' }));
  fs.writeFileSync(path.join(reportsDir, 'summary.csv'), stringify(billing, { header: true, record_delimiter: '\n' }));

  console.log(`Validated ${pings.length} input records across ${new Set(pings.map((ping) => ping.driver_id)).size} drivers.`);
  console.log('Per-driver diagnostic summary:');
  console.table(summary);
  console.log('Speed distribution (chronological GPS order, duplicate timestamps excluded, trip-gap edges excluded, noise included):');
  console.table({ raw: speedStats(result.rawSpeeds), preliminaryBelow150: speedStats(result.preliminarySpeeds) });
  console.log(`Detected segment events: speed=${result.events.speed}, zone_edge_segment=${result.events.zone}, crosses_local_midnight=${result.events.midnight}, trip_gap=${result.events.tripGap}`);
  console.log(`Fixed pipeline diagnostics: invalid=${fixed.diagnostics.invalid}, duplicates_removed=${fixed.diagnostics.duplicateRemoved}, off_road_rejected=${fixed.diagnostics.offRoadRejected}, speed_outliers_rejected=${fixed.diagnostics.speedOutlierRejected}, trip_gaps_excluded=${fixed.diagnostics.tripGapsExcluded}`);
console.log('Billing comparison (fixed metrics populated by Phase 5):');
  console.table(billing);
  console.log('Reports: reports/flags.csv, reports/summary.csv');

  if (wantsMap) {
    const mapData = { ...mapPaths(result.chronological, fixed.retainedByDriver), flagged: flagRows };
    writeMap(mapData, road, zone);
    console.log('Map: reports/map.html (Leaflet CDN and map tiles require internet access)');
  }
}

try {
  main();
} catch (error) {
  console.error(`QA check failed: ${error.message}`);
  process.exitCode = 1;
}
