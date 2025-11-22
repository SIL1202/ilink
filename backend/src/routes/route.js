// 導入地理計算工具
import { calculateRouteDistance, haversineMeters } from "../utils/geo.js";
import fs from "fs";
import path from "path";

async function getFallbackResponse(start, end) {
  const fallbackRoute = await getFallbackRoute(start, end);
  return {
    normal: fallbackRoute,
    accessible: null,
    has_accessible_alternative: false,
    metadata: {
      normal_destination: end,
      accessible_destination: end,
      note: "使用降級路線方案",
    },
  };
}

export async function calculateRoute(start, end, options = {}) {
  const {
    mode = "normal",
    ramp = null,
    accessible_end = null,
    original_end = null,
  } = options;

  console.log("📍 計算路線...", { start, end, options });

  try {
    // 計算一般路線
    const normalRoute = await getOSRMRoute(start, end);

    let accessibleRoute = null;
    let hasAccessibleAlternative = false;

    // 判斷是否需要計算無障礙路線
    const shouldCalculateAccessible =
      mode === "accessible" || (ramp && accessible_end);

    if (shouldCalculateAccessible) {
      console.log("♿ 計算無障礙路線");

      const accessibleTarget = accessible_end || end;
      accessibleRoute = await getOSRMRoute(start, accessibleTarget);

      if (accessibleRoute && accessibleRoute.routes?.length > 0) {
        accessibleRoute = formatSimpleRoute(accessibleRoute);
        // 添加無障礙屬性
        const feature = accessibleRoute.features[0];
        feature.properties.accessibility = {
          barrier_count: 0,
          suitable_for_wheelchair: true,
          ramp_used: ramp?.name || "自動偵測坡道",
          original_destination: original_end || end,
        };
        hasAccessibleAlternative = true;
      }
    }

    return {
      normal: formatSimpleRoute(normalRoute),
      accessible: accessibleRoute,
      has_accessible_alternative: hasAccessibleAlternative,
      metadata: {
        normal_destination: end,
        accessible_destination: accessible_end || end,
      },
    };
  } catch (error) {
    console.error("路線計算失敗:", error);
    // 返回降級方案
    return getFallbackResponse(start, end);
  }
}

async function checkDestinationHasRamp(destination) {
  try {
    // 載入坡道資料
    const ramps = await loadRampsData();

    // ✅ 添加除錯：檢查載入的坡道資料
    console.log(`🔍 載入的坡道資料:`, {
      數量: ramps.length,
      是否有資料: ramps.length > 0,
      第一個坡道: ramps[0] || "無資料",
    });

    const [destLon, destLat] = destination;

    console.log(`📍 檢查目的地: [${destLon}, ${destLat}]`);
    console.log(`📊 可用坡道數量: ${ramps.length}`);

    // 如果沒有坡道資料，直接返回 false
    if (ramps.length === 0) {
      console.log("❌ 沒有坡道資料可用");
      return false;
    }

    // ✅ 詳細輸出每個坡道的距離
    let minDistance = Infinity;
    let closestRamp = null;
    let foundRamp = false;

    ramps.forEach((ramp, index) => {
      const distance = haversineMeters(
        [destLon, destLat],
        [ramp.lon, ramp.lat],
      );

      // 記錄最近坡道
      if (distance < minDistance) {
        minDistance = distance;
        closestRamp = ramp;
      }

      // 檢查是否在100公尺內
      const isWithin100m = distance <= 100;
      if (isWithin100m) {
        foundRamp = true;
        console.log(
          `🎯 找到符合的坡道: "${ramp.name}" (${distance.toFixed(1)} 公尺)`,
        );
      }

      console.log(`  坡道 ${index + 1}: "${ramp.name}"`);
      console.log(`    座標: [${ramp.lon}, ${ramp.lat}]`);
      console.log(
        `    距離: ${distance.toFixed(1)} 公尺 ${isWithin100m ? "✅ 在100公尺內!" : "❌ 超過100公尺"}`,
      );
    });

    // ✅ 輸出總結
    console.log(`📊 坡道檢查總結:`);
    console.log(`  最近坡道: "${closestRamp?.name || "無"}"`);
    console.log(`  最近距離: ${minDistance.toFixed(1)} 公尺`);
    console.log(`  100公尺內坡道: ${foundRamp ? "✅ 有" : "❌ 無"}`);
    console.log(
      `  最終結果: ${foundRamp ? "提供無障礙路線" : "僅提供一般路線"}`,
    );

    return foundRamp;
  } catch (error) {
    console.error("❌ 檢查坡道失敗:", error);
    return false;
  }
}

/**
 * 載入坡道資料
 */
async function loadRampsData() {
  try {
    // ✅ 修正檔案路徑
    const filePath = path.join(process.cwd(), "data", "ramps.json");
    console.log("📁 嘗試載入坡道檔案:", filePath);

    // ✅ 檢查檔案是否存在
    if (!fs.existsSync(filePath)) {
      console.error("❌ 坡道檔案不存在:", filePath);

      // ✅ 列出當前目錄結構幫助除錯
      const dataDir = path.join(process.cwd(), "data");
      console.log("📁 當前 data 目錄內容:");
      try {
        const files = fs.readdirSync(dataDir);
        files.forEach((file) => console.log(`   - ${file}`));
      } catch (e) {
        console.log("   - 無法讀取 data 目錄");
      }

      return [];
    }

    const json = fs.readFileSync(filePath, "utf-8");
    const ramps = JSON.parse(json);
    console.log(`✅ 成功載入 ${ramps.length} 個坡道資料`);

    // ✅ 確認資料結構正確
    if (ramps.length > 0) {
      console.log("📋 坡道資料範例:");
      ramps.slice(0, 3).forEach((ramp, i) => {
        console.log(`  [${i + 1}] ${ramp.name}: [${ramp.lon}, ${ramp.lat}]`);
      });
    } else {
      console.warn("⚠️ 坡道資料為空陣列!");
    }

    return ramps;
  } catch (error) {
    console.error("❌ 載入坡道資料失敗:", error.message);
    console.error("詳細錯誤:", error);
    return [];
  }
}

async function getOSRMRoute(start, end) {
  try {
    const [startLon, startLat] = start;
    const [endLon, endLat] = end;

    const url = `https://router.project-osrm.org/route/v1/walking/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OSRM API 錯誤: ${response.status}`);
    }

    const data = await response.json();

    // 檢查 OSRM 回傳的錯誤
    if (data.code !== "Ok") {
      throw new Error(`OSRM 路線規劃失敗: ${data.message || "未知錯誤"}`);
    }

    return data;
  } catch (error) {
    console.error("❌ OSRM 請求失敗:", error.message);
    // 返回降級方案
    return getFallbackRoute(start, end);
  }
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
