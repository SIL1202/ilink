// 統一的距離計算工具
export function haversineMeters(coord1, coord2) {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function calculateRouteDistance(coordinates) {
  let totalDistance = 0;
  for (let i = 1; i < coordinates.length; i++) {
    totalDistance += haversineMeters(coordinates[i - 1], coordinates[i]);
  }
  return Math.round(totalDistance);
}

export function calculateRouteDuration(coordinates, params) {
  const distance = calculateRouteDistance(coordinates);
  let speed = 1.0; // m/s

  if (params.maximum_incline <= 0.05) speed = 1.2;
  if (params.minimum_width >= 1.2) speed = 1.3;

  return Math.round(distance / speed);
}

export function validLonLatPair(p) {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((v) => Number.isFinite(v)) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}
