import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { naiveDistance } from '../src/naiveCalc.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const dataDir = path.join(projectRoot, 'data');
const reportDir = path.join(projectRoot, 'reports');

const pingText = fs.readFileSync(path.join(dataDir, 'pings.csv'), 'utf8');
const pingLines = pingText.split(/\r?\n/);
if (!pingLines[0].startsWith('# SYNTHETIC DATA')) {
  throw new Error('Expected synthetic-data metadata line in pings.csv');
}
const pings = parse(pingLines.slice(1).join('\n'), {
  columns: true,
  skip_empty_lines: true,
}).map((ping) => ({
  ...ping,
  lat: Number(ping.lat),
  lon: Number(ping.lon),
}));
const originalPings = JSON.stringify(pings);
const zone = JSON.parse(fs.readFileSync(path.join(dataDir, 'zone.geojson'), 'utf8'));
const expected = parse(fs.readFileSync(path.join(dataDir, 'expected.csv'), 'utf8'), {
  columns: true,
}).map((row) => ({
  driver_id: row.driver_id,
  date: row.local_date,
  km: Number(row.km),
}));

const naive = naiveDistance(pings, zone);
if (JSON.stringify(pings) !== originalPings) {
  throw new Error('naiveDistance mutated the input pings array');
}

const byKey = (rows) => new Map(rows.map((row) => [`${row.driver_id}|${row.date}`, row.km]));
const expectedByKey = byKey(expected);
const naiveByKey = byKey(naive);
const keys = [...new Set([...expectedByKey.keys(), ...naiveByKey.keys()])]
  .sort((a, b) => a.localeCompare(b));

const comparison = keys.map((key) => {
  const [driver_id, date] = key.split('|');
  const expectedKm = expectedByKey.get(key) ?? 0;
  const naiveKm = naiveByKey.get(key) ?? 0;
  const differenceKm = naiveKm - expectedKm;
  let errorPct;
  if (expectedKm === 0) {
    errorPct = naiveKm === 0 ? '0.00%' : 'N/A';
  } else {
    errorPct = `${((differenceKm / expectedKm) * 100).toFixed(2)}%`;
  }
  return {
    driver_id,
    date,
    expected_km: expectedKm,
    naive_km: naiveKm,
    difference_km: differenceKm,
    error_pct: errorPct,
  };
});

const reportRows = comparison.map((row) => ({
  ...row,
  expected_km: row.expected_km.toFixed(6),
  naive_km: row.naive_km.toFixed(6),
  difference_km: row.difference_km.toFixed(6),
}));
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(
  path.join(reportDir, 'naive_comparison.csv'),
  stringify(reportRows, {
    header: true,
    columns: ['driver_id', 'date', 'expected_km', 'naive_km', 'difference_km', 'error_pct'],
    record_delimiter: '\n',
  }),
);

console.table(reportRows);
const totalAbsoluteError = comparison.reduce((sum, row) => sum + Math.abs(row.difference_km), 0);
const overallSignedDifference = comparison.reduce((sum, row) => sum + row.difference_km, 0);
console.log(`Total absolute error (km): ${totalAbsoluteError.toFixed(6)}`);
console.log(`Overall signed difference (km): ${overallSignedDifference.toFixed(6)}`);
console.log('Comparison report: reports/naive_comparison.csv');
