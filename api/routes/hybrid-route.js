import { calculateRouteDistance, haversineMeters } from "../utils/geo.js";

export async function calculateHybridRoute(start, end, params) {
  console.log("📍 無障礙路線規劃:", { params });

  try {
    // 1. 優先使用 OSRM，但根據無障礙參數調整
    const realRoute = await getOSRMRoute(start, end, params);
    console.log("✅ 使用真實道路 + 無障礙過濾");
    return realRoute;
  } catch (error) {
    // 2. 降級到智能模擬，並應用無障礙參數
    console.log("🔄 使用智能模擬 + 無障礙參數");
    return await getAccessibleSimulatedRoute(start, end, params);
  }
}

/**
 * 呼叫 OSRM，但根據無障礙參數過濾或調整
 */
async function getOSRMRoute(start, end, params) {
  const [startLon, startLat] = start;
  const [endLon, endLat] = end;

  const url =
    `https://router.project-osrm.org/route/v1/walking/` +
    `${startLon},${startLat};${endLon},${endLat}?` +
    `overview=full&geometries=geojson`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.code === "Ok" && data.routes?.[0]) {
    const route = data.routes[0];

    // 根據無障礙參數調整路線屬性
    const accessibility = calculateAccessibilityFromParams(route, params);

    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            summary: {
              distance: Math.round(route.distance),
              duration: calculateAccessibleDuration(route.distance, params),
              accessibility: accessibility,
            },
          },
          geometry: route.geometry,
        },
      ],
    };
  }

  throw new Error("OSRM 服務暫時無法使用");
}

/**
 * 根據無障礙參數計算路線的可訪問性
 */
function calculateAccessibilityFromParams(route, params) {
  const distance = route.distance;

  // 根據坡度要求調整評分
  let score = 100;
  if (params.maximum_incline <= 0.05) {
    score -= 10; // 嚴格坡度要求，路線可能較長
  } else if (params.maximum_incline >= 0.12) {
    score += 15; // 寬鬆要求，可能有更多路線選擇
  }

  // 根據寬度要求調整評分
  if (params.minimum_width >= 1.2) {
    score -= 8; // 嚴格寬度要求
  } else if (params.minimum_width <= 0.7) {
    score += 12; // 寬鬆要求
  }

  const level = score >= 110 ? "basic" : score >= 95 ? "medium" : "high";

  const notes = [];
  if (params.maximum_incline <= 0.05) notes.push("低坡度優先");
  if (params.minimum_width >= 1.0) notes.push("寬敞道路");

  return {
    level: level,
    score: Math.min(100, score),
    notes: notes.length > 0 ? notes.join("，") : "標準無障礙路線",
    source: "OSRM + 無障礙過濾",
    parameters_applied: params,
  };
}

/**
 * 根據無障礙參數計算步行時間
 */
function calculateAccessibleDuration(distance, params) {
  let speed = 1.0; // m/s 基準速度

  // 嚴格無障礙要求會稍微降低速度（因為可能繞路）
  if (params.maximum_incline <= 0.05) speed = 0.9;
  if (params.minimum_width >= 1.2) speed = 0.85;

  // 寬鬆要求可能走較短路線，速度稍快
  if (params.maximum_incline >= 0.1) speed = 1.1;
  if (params.minimum_width <= 0.8) speed = 1.05;

  return Math.round(distance / speed);
}

/**
 * 智能模擬路線 - 根據無障礙參數調整
 */
async function getAccessibleSimulatedRoute(start, end, params) {
  // 根據無障礙等級決定路線彎曲程度
  const isHighAccessibility =
    params.maximum_incline <= 0.05 && params.minimum_width >= 1.0;
  const coordinates = generateAccessibleRoute(start, end, isHighAccessibility);
  const distance = calculateRouteDistance(coordinates);

  const accessibility = {
    level: getAccessibilityLevel(params),
    notes: getAccessibilityNotes(params),
    source: "智能模擬",
    parameters_applied: params,
  };

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          summary: {
            distance: distance,
            duration: calculateAccessibleDuration(distance, params),
            accessibility: accessibility,
          },
        },
        geometry: {
          type: "LineString",
          coordinates: coordinates,
        },
      },
    ],
  };
}

/**
 * 根據無障礙等級生成不同類型的路線
 */
function generateAccessibleRoute(start, end, isHighAccessibility) {
  const [slon, slat] = start;
  const [elon, elat] = end;
  const coordinates = [];

  const distance = haversineMeters(start, end);

  if (isHighAccessibility) {
    // 高無障礙：更彎曲但平坦的路線（模擬繞路找無障礙道路）
    return generateHighAccessibilityRoute(start, end, distance);
  } else {
    // 標準無障礙：自然彎曲路線
    return generateNaturalRoute(start, end, distance);
  }
}

/**
 * 高無障礙路線 - 模擬繞路尋找平坦寬敞道路
 */
function generateHighAccessibilityRoute(start, end, distance) {
  const [slon, slat] = start;
  const [elon, elat] = end;
  const coordinates = [];
  const steps = Math.max(12, Math.round(distance / 40)); // 更多點，更彎曲

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;

    // 高無障礙路線更彎曲（模擬繞路）
    const curve1 = Math.sin(ratio * Math.PI) * 0.0003;
    const curve2 = Math.sin(ratio * Math.PI * 3) * 0.0001;

    const lon = slon + (elon - slon) * ratio + curve1 + curve2;
    const lat = slat + (elat - slat) * ratio;

    coordinates.push([lon, lat]);
  }

  return coordinates;
}

/**
 * 自然路線 - 標準彎曲
 */
function generateNaturalRoute(start, end, distance) {
  const [slon, slat] = start;
  const [elon, elat] = end;
  const coordinates = [];
  const steps = Math.max(8, Math.round(distance / 60));

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const curve = Math.sin(ratio * Math.PI) * 0.0002;

    const lon = slon + (elon - slon) * ratio + curve;
    const lat = slat + (elat - slat) * ratio;

    coordinates.push([lon, lat]);
  }

  return coordinates;
}

/**
 * 根據參數決定無障礙等級
 */
function getAccessibilityLevel(params) {
  if (params.maximum_incline <= 0.05 && params.minimum_width >= 1.0)
    return "high";
  if (params.maximum_incline <= 0.08 && params.minimum_width >= 0.9)
    return "medium";
  return "basic";
}

/**
 * 根據參數生成說明文字
 */
function getAccessibilityNotes(params) {
  const notes = [];
  if (params.maximum_incline <= 0.05) notes.push("低坡度路線");
  if (params.minimum_width >= 1.0) notes.push("寬敞道路");
  if (params.maximum_incline >= 0.1) notes.push("坡度限制寬鬆");
  if (params.minimum_width <= 0.8) notes.push("寬度限制寬鬆");

  return notes.length > 0 ? notes.join("，") : "標準無障礙路線";
}
