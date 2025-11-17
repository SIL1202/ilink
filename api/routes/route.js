// 導入地理計算工具
import { calculateRouteDistance, haversineMeters } from "../utils/geo.js";

/**
 * 主要路由函數 - 計算一般路線和無障礙路線
 * @param {Array} start - 起點座標 [經度, 緯度]
 * @param {Array} end - 終點座標 [經度, 緯度]
 * @returns {Object} 包含一般路線和無障礙路線的物件
 */
export async function calculateRoute(start, end) {
  console.log("📍 計算路線...", { start, end });

  try {
    // 取得一般步行路線
    const normalRoute = await getOSRMRoute(start, end);

    // 先檢查 OSRM 回傳是否有效
    if (
      !normalRoute ||
      normalRoute.code !== "Ok" ||
      !normalRoute.routes?.length
    ) {
      throw new Error("OSRM_no_valid_route");
    }

    // ✅ 新增：檢查終點附近是否有坡道
    const hasNearbyRamp = await checkDestinationHasRamp(end);

    let accessibleRoute = null;

    // ✅ 只有終點附近有坡道時，才分析無障礙路線
    if (hasNearbyRamp) {
      console.log("✅ 終點附近有坡道，分析無障礙路線");
      accessibleRoute = await analyzeAccessibleRoute(normalRoute);
    } else {
      console.log("❌ 終點100公尺內無坡道，僅提供一般路線");
    }

    // ✅ 添加詳細日誌
    console.log("🔍 路線分析結果:");
    console.log("  - 一般路線: ✅ 有");
    console.log("  - 終點附近坡道:", hasNearbyRamp ? "✅ 有" : "❌ 無");
    console.log("  - 無障礙路線:", accessibleRoute ? "✅ 有" : "❌ 無");
    console.log(
      "  - 有替代路線:",
      accessibleRoute !== null ? "✅ 是" : "❌ 否",
    );

    return {
      normal: formatSimpleRoute(normalRoute),
      accessible: accessibleRoute,
      has_accessible_alternative: accessibleRoute !== null,
    };
  } catch (error) {
    console.log("🔄 OSRM 失敗，使用 Fallback:", error.message);
    const fallback = await getFallbackRoute(start, end);
    return {
      normal: fallback,
      accessible: null,
      has_accessible_alternative: false,
    };
  }
}

/**
 * 檢查目的地附近是否有坡道（100公尺內）
 * @param {Array} destination - 目的地座標 [經度, 緯度]
 * @returns {boolean} 100公尺內是否有坡道
 */
async function checkDestinationHasRamp(destination) {
  try {
    // 載入坡道資料
    const ramps = await loadRampsData();
    const [destLon, destLat] = destination;

    // 檢查100公尺內是否有坡道
    const hasRamp = ramps.some((ramp) => {
      const distance = haversineMeters(
        [destLon, destLat],
        [ramp.lon, ramp.lat],
      );
      return distance <= 100; // 100公尺內
    });

    console.log(
      `📍 目的地坡道檢查: ${hasRamp ? "100公尺內有坡道" : "100公尺內無坡道"}`,
    );
    return hasRamp;
  } catch (error) {
    console.error("❌ 檢查坡道失敗:", error);
    return false; // 失敗時保守估計為無坡道
  }
}

/**
 * 載入坡道資料
 */
async function loadRampsData() {
  // 這裡可以從你的坡道API或本地檔案載入
  // 暫時回傳空陣列，你需要根據實際情況實作
  return [];
} /**
 * 從 OSRM 服務取得路線 - 添加錯誤處理
 */
async function getOSRMRoute(start, end) {
  const [startLon, startLat] = start;
  const [endLon, endLat] = end;

  const url =
    `https://router.project-osrm.org/route/v1/walking/` +
    `${startLon},${startLat};${endLon},${endLat}?` +
    `overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `OSRM API 錯誤: ${response.status} ${response.statusText}`,
      );
    }
    return await response.json();
  } catch (error) {
    console.error("❌ OSRM 請求失敗:", error.message);
    throw error;
  }
}

/**
 * 分析無障礙路線
 * @param {Object} routeData - 原始路線資料
 * @returns {Object|null} 無障礙路線資料，如果無法分析則回傳 null
 */
async function analyzeAccessibleRoute(routeData) {
  // 檢查路線資料是否有效
  if (routeData.code !== "Ok") return null;

  // 偵測路線中的無障礙障礙點
  const barriers = detectAccessibilityBarriers(routeData);

  // 取得主要路線資訊
  const route = routeData.routes[0];

  // 檢查距離是否適合輪椅（2公里內）
  const distanceOk = route.distance <= 2000;

  // ✅ 修正：如果有障礙或距離過長，就回傳 null
  if (barriers.length > 0 || !distanceOk) {
    console.log(
      `❌ 不提供無障礙路線: ${barriers.length > 0 ? "有障礙" : "距離過長"}`,
    );
    return null;
  }

  // ✅ 只有真正適合的路線才回傳
  console.log("✅ 路線適合輪椅，提供無障礙路線");
  return {
    type: "FeatureCollection", // GeoJSON 格式
    features: [
      {
        type: "Feature",
        properties: {
          summary: {
            distance: Math.round(route.distance), // 距離（公尺）
            duration: Math.round(route.duration / 60), // 時間（分鐘）
          },
          accessibility: {
            suitable_for_wheelchair: true, // 因為通過檢查，所以是 true
            barriers: barriers, // 障礙點列表（應該是空的）
            barrier_count: barriers.length, // 障礙點數量（應該是 0）
            distance_analysis: {
              distance: route.distance, // 路線距離
              suitable: distanceOk, // 距離是否合適
              suggestion: "距離適合輪椅", // 建議
            },
            confidence: "high", // 可信度
            assumptions: "基於OpenStreetMap道路類型分析", // 分析基礎說明
          },
        },
        geometry: route.geometry, // 路線幾何資料
      },
    ],
    metadata: {
      source: "OSRM", // 資料來源
      accessibility_checked: true, // 是否經過無障礙檢查
      last_updated: new Date().toISOString(), // 最後更新時間
    },
  };
}

/**
 * 偵測路線中的無障礙障礙點
 * @param {Object} routeData - 路線資料
 * @returns {Array} 障礙點陣列
 */
function detectAccessibilityBarriers(routeData) {
  // 檢查路線步驟資料是否存在
  if (!routeData.routes?.[0]?.legs?.[0]?.steps) {
    console.log("⚠️ 沒有步驟資料，無法偵測障礙");
    return [];
  }

  // 取得所有路線步驟
  const steps = routeData.routes[0].legs[0].steps;
  const barriers = []; // 儲存障礙點

  // 遍歷每個步驟，檢查是否有障礙
  steps.forEach((step, index) => {
    if (isDefiniteBarrier(step)) {
      console.log(
        `🚫 發現障礙: ${step.name || "未知路段"} - ${getBarrierReason(step)}`,
      );
      barriers.push({
        type: getBarrierType(step), // 障礙類型
        location: step.name || "未知路段", // 障礙位置
        reason: getBarrierReason(step), // 障礙原因
        distance: step.distance, // 障礙路段距離
      });
    }
  });

  console.log(`📊 障礙偵測完成: 找到 ${barriers.length} 個障礙點`);
  return barriers;
}

/**
 * 判斷步驟是否包含明確障礙
 * @param {Object} step - 路線步驟
 * @returns {boolean} 是否為障礙
 */
function isDefiniteBarrier(step) {
  // 1. 階梯（100%輪椅無法通行）
  if (step.tags?.highway === "steps") return true;
  if (step.name?.toLowerCase().includes("steps")) return true;

  // 2. 明確禁止通行的道路
  if (step.tags?.access === "no") return true;
  if (step.tags?.foot === "no") return true;

  // 3. 登山步道/越野路徑
  if (step.tags?.highway === "track") return true;

  return false; // 沒有明確障礙
}

/**
 * 取得障礙類型
 * @param {Object} step - 路線步驟
 * @returns {string} 障礙類型
 */
function getBarrierType(step) {
  if (step.tags?.highway === "steps") return "stairs"; // 階梯
  if (step.tags?.access === "no") return "access_denied"; // 禁止通行
  if (step.tags?.highway === "track") return "rough_terrain"; // 崎嶇地形
  return "unknown"; // 未知類型
}

/**
 * 取得障礙原因說明
 * @param {Object} step - 路線步驟
 * @returns {string} 障礙原因
 */
function getBarrierReason(step) {
  if (step.tags?.highway === "steps") return "包含階梯";
  if (step.tags?.access === "no") return "禁止通行";
  if (step.tags?.highway === "track") return "越野路徑不適合輪椅";
  return "可能不適合輪椅";
}

/**
 * 格式化簡單路線（一般路線）
 * @param {Object} routeData - 原始路線資料
 * @returns {Object} 格式化後的路線
 */
function formatSimpleRoute(routeData) {
  const route = routeData.routes[0]; // 取得主要路線

  return {
    type: "FeatureCollection", // GeoJSON 格式
    features: [
      {
        type: "Feature",
        properties: {
          summary: {
            distance: Math.round(route.distance), // 距離（公尺）
            duration: Math.round(route.duration / 60), // 時間（分鐘）
          },
        },
        geometry: route.geometry, // 路線幾何資料
      },
    ],
    metadata: {
      source: "OSRM", // 資料來源
      last_updated: new Date().toISOString(), // 最後更新時間
    },
  };
}

/**
 * 降級方案 - 當主要服務失敗時使用
 * @param {Array} start - 起點座標
 * @param {Array} end - 終點座標
 * @returns {Object} 模擬路線
 */
async function getFallbackRoute(start, end) {
  // 生成簡單的模擬路線
  const coordinates = generateSimpleRoute(start, end);
  // 計算路線距離
  const distance = calculateRouteDistance(coordinates);

  return {
    type: "FeatureCollection", // GeoJSON 格式
    features: [
      {
        type: "Feature",
        properties: {
          summary: {
            distance: distance, // 計算出的距離
            duration: Math.round(distance / 1.0 / 60), // 估算時間（分鐘）
          },
        },
        geometry: {
          type: "LineString", // 線條幾何類型
          coordinates: coordinates, // 座標陣列
        },
      },
    ],
    metadata: {
      source: "fallback_simulation", // 標記為降級方案
    },
  };
}

/**
 * 生成簡單的模擬路線
 * @param {Array} start - 起點座標
 * @param {Array} end - 終點座標
 * @returns {Array} 座標陣列
 */
function generateSimpleRoute(start, end) {
  // 解構起點終點座標
  const [slon, slat] = start;
  const [elon, elat] = end;
  const coordinates = []; // 儲存座標
  const steps = 10; // 分割點數量

  // 生成平滑的曲線路線
  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps; // 進度比例（0-1）
    // 添加正弦曲線使路線更自然
    const curve = Math.sin(ratio * Math.PI) * 0.0002;

    // 計算中間點座標
    const lon = slon + (elon - slon) * ratio + curve;
    const lat = slat + (elat - slat) * ratio;

    // 加入座標陣列
    coordinates.push([lon, lat]);
  }

  return coordinates; // 回傳座標陣列
}
