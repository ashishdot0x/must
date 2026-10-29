const EARTH_RADIUS_KM = 6371.0088;

/**
 * Independent spherical-distance oracle for small analytical fixtures.
 * It deliberately does not import production geographic helpers.
 * @param {[number, number]} first [longitude, latitude]
 * @param {[number, number]} second [longitude, latitude]
 * @returns {number}
 */
export function haversineKm(first, second) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const lat1 = toRadians(first[1]);
  const lat2 = toRadians(second[1]);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(second[0] - first[0]);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** @param {number} distanceKm @param {number} elapsedSeconds @returns {[number, number]} */
export function splitByElapsedRatio(distanceKm, elapsedSeconds) {
  return [distanceKm / elapsedSeconds, distanceKm / elapsedSeconds];
}
