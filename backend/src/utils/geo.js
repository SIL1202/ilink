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

// 新增導航相關的地理計算函數

/**
 * 計算點到線段的最短距離
 * @param {Array} point - [lon, lat] 座標
 * @param {Array} lineStart - 線段起點 [lon, lat]
 * @param {Array} lineEnd - 線段終點 [lon, lat]
 * @returns {number} 最短距離（公尺）
 */
export function distanceToLineSegment(point, lineStart, lineEnd) {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;

  return haversineMeters([x, y], [xx, yy]);
}

/**
 * 計算沿路線的進度百分比
 * @param {Array} currentPosition - 當前位置 [lon, lat]
 * @param {Array} routeCoordinates - 路線座標陣列
 * @returns {number} 進度百分比 (0-100)
 */
export function calculateRouteProgress(currentPosition, routeCoordinates) {
  if (!routeCoordinates || routeCoordinates.length < 2) {
    return 0;
  }

  let totalDistance = 0;
  let accumulatedDistance = 0;
  let closestSegmentIndex = -1;
  let minDistance = Infinity;

  // 計算總距離和找到最近線段
  for (let i = 0; i < routeCoordinates.length - 1; i++) {
    const segmentDistance = haversineMeters(
      routeCoordinates[i],
      routeCoordinates[i + 1],
    );
    totalDistance += segmentDistance;

    const distanceToSegment = distanceToLineSegment(
      currentPosition,
      routeCoordinates[i],
      routeCoordinates[i + 1],
    );

    if (distanceToSegment < minDistance) {
      minDistance = distanceToSegment;
      closestSegmentIndex = i;
    }
  }

  // 計算到最近線段起點的累積距離
  for (let i = 0; i < closestSegmentIndex; i++) {
    accumulatedDistance += haversineMeters(
      routeCoordinates[i],
      routeCoordinates[i + 1],
    );
  }

  const progress = (accumulatedDistance / totalDistance) * 100;
  return Math.max(0, Math.min(100, progress));
}
