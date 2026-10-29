/**
 * Merge billing rows without silently dropping keys present in any source.
 * @param {Array<{driver_id: string, local_date?: string, date?: string, km: number}>} expected
 * @param {Array<{driver_id: string, date: string, km: number}>} naive
 * @param {Array<{driver_id: string, date: string, km: number}>} fixed
 * @returns {Array<object>}
 */
export function buildBillingSummary(expected, naive, fixed) {
  const expectedByKey = new Map(expected.map((row) => [`${row.driver_id}|${row.local_date ?? row.date}`, Number(row.km)]));
  const naiveByKey = new Map(naive.map((row) => [`${row.driver_id}|${row.date}`, row.km]));
  const fixedByKey = new Map(fixed.map((row) => [`${row.driver_id}|${row.date}`, row.km]));
  const keys = [...new Set([...expectedByKey.keys(), ...naiveByKey.keys(), ...fixedByKey.keys()])].sort();

  return keys.map((key) => {
    const [driver_id, local_date] = key.split('|');
    const expectedKm = expectedByKey.get(key) ?? 0;
    const naiveKm = naiveByKey.get(key) ?? 0;
    const fixedKm = fixedByKey.get(key) ?? 0;
    const naiveDifference = naiveKm - expectedKm;
    const fixedDifference = fixedKm - expectedKm;
    const percentage = (difference) => expectedKm === 0
      ? (difference === 0 ? '0.00%' : 'N/A')
      : `${((difference / expectedKm) * 100).toFixed(2)}%`;
    return {
      driver_id,
      local_date,
      naive_km: naiveKm.toFixed(6),
      fixed_km: fixedKm.toFixed(6),
      expected_km: expectedKm.toFixed(6),
      naive_error_pct: percentage(naiveDifference),
      fixed_error_pct: percentage(fixedDifference),
    };
  });
}
