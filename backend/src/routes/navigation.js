import express from "express";
import { calculateRoute } from "./route.js";
import { haversineMeters } from "../utils/geo.js";

const router = express.Router();

// 儲存進行中的導航會話
const navigationSessions = new Map();

// 開始導航
router.post("/navigation/start", async (req, res) => {
  try {
    const { start, end, route_type, route_data } = req.body;

    console.log("🧭 開始導航請求:", { start, end, route_type });

    if (!start || !end) {
      return res.status(400).json({
        error: "missing_params",
        message: "缺少起點或終點座標",
      });
    }

    // 生成導航會話 ID
    const navigationId = generateNavigationId();

    // 取得詳細路線步驟
    const navigationSteps = await generateNavigationSteps(
      start,
      end,
      route_type,
      route_data,
    );

    // 儲存導航會話
    navigationSessions.set(navigationId, {
      start,
      end,
      route_type,
      steps: navigationSteps,
      current_step: 0,
      created_at: new Date(),
      user_positions: [],
    });

    console.log(
      `✅ 導航會話建立: ${navigationId}, 步驟數: ${navigationSteps.length}`,
    );

    res.json({
      navigation_id: navigationId,
      steps: navigationSteps,
      total_steps: navigationSteps.length,
      total_distance: navigationSteps.reduce(
        (sum, step) => sum + step.distance,
        0,
      ),
      estimated_duration: navigationSteps.reduce(
        (sum, step) => sum + step.duration,
        0,
      ),
    });
  } catch (error) {
    console.error("❌ 開始導航失敗:", error);
    res.status(500).json({
      error: "navigation_start_failed",
      message: "導航啟動失敗",
    });
  }
});

// 位置更新檢查
router.post("/navigation/position", async (req, res) => {
  try {
    const { current_position, current_step, navigation_id } = req.body;

    console.log("📍 位置更新:", {
      navigation_id,
      current_step,
      position: current_position,
    });

    if (!navigation_id || !current_position) {
      return res.status(400).json({
        error: "missing_params",
        message: "缺少導航ID或当前位置",
      });
    }

    // 取得導航會話
    const session = navigationSessions.get(navigation_id);
    if (!session) {
      return res.status(404).json({
        error: "session_not_found",
        message: "導航會話不存在或已過期",
      });
    }

    // 更新使用者位置記錄
    session.user_positions.push({
      position: current_position,
      timestamp: new Date(),
      step: current_step,
    });

    // 檢查是否完成當前步驟
    const stepCompleted = await checkStepCompletion(
      current_position,
      current_step,
      session,
    );

    // 檢查是否偏離路線
    const offRoute = await checkOffRoute(
      current_position,
      current_step,
      session,
    );

    let next_instruction = null;
    if (stepCompleted && current_step < session.steps.length - 1) {
      next_instruction = session.steps[current_step + 1].instruction;
    }

    res.json({
      step_completed: stepCompleted,
      off_route: offRoute,
      next_instruction: next_instruction,
      current_step: current_step,
      progress: Math.round(
        ((current_step + (stepCompleted ? 1 : 0)) / session.steps.length) * 100,
      ),
    });
  } catch (error) {
    console.error("❌ 位置檢查失敗:", error);
    res.status(500).json({
      error: "position_check_failed",
      message: "位置檢查失敗",
    });
  }
});

// 重新規劃路線
router.post("/navigation/recalculate", async (req, res) => {
  try {
    const { current_position, end, route_type } = req.body;

    console.log("🔄 重新規劃路線:", { current_position, end, route_type });

    // 使用現有的路線規劃邏輯
    const newRoute = await calculateRoute(current_position, end, route_type);

    // 生成新的導航步驟
    const newSteps = await generateNavigationSteps(
      current_position,
      end,
      route_type,
      newRoute,
    );

    res.json({
      route_geometry: newRoute,
      steps: newSteps,
      total_steps: newSteps.length,
      recalculated: true,
    });
  } catch (error) {
    console.error("❌ 重新規劃失敗:", error);
    res.status(500).json({
      error: "recalculation_failed",
      message: "路線重新規劃失敗",
    });
  }
});

// 結束導航
router.post("/navigation/stop", (req, res) => {
  const { navigation_id } = req.body;

  if (navigation_id && navigationSessions.has(navigation_id)) {
    navigationSessions.delete(navigation_id);
    console.log(`🛑 導航會話結束: ${navigation_id}`);
  }

  res.json({ success: true, message: "導航已結束" });
});

// 生成導航步驟
async function generateNavigationSteps(start, end, routeType, routeData) {
  console.log("📝 生成導航步驟...");

  try {
    // 使用 OSRM 的導航服務取得轉向指令
    const osrmSteps = await getOSRMManeuvers(start, end);

    if (osrmSteps && osrmSteps.length > 0) {
      console.log(`✅ 從 OSRM 取得 ${osrmSteps.length} 個導航步驟`);
      return osrmSteps;
    }
  } catch (error) {
    console.warn("⚠️ OSRM 導航步驟取得失敗，使用模擬步驟:", error.message);
  }

  // 降級方案：生成模擬導航步驟
  return generateSimulatedSteps(start, end, routeType);
}

// 從 OSRM 取得詳細導航指令
async function getOSRMManeuvers(start, end) {
  const [startLon, startLat] = start;
  const [endLon, endLat] = end;

  const url =
    `https://router.project-osrm.org/route/v1/walking/` +
    `${startLon},${startLat};${endLon},${endLat}?` +
    `overview=false&steps=true&geometries=geojson`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OSRM API 錯誤: ${response.status}`);
  }

  const data = await response.json();

  if (!data.routes?.[0]?.legs?.[0]?.steps) {
    throw new Error("OSRM 回傳無效的步驟資料");
  }

  const steps = data.routes[0].legs[0].steps;
  const navigationSteps = [];

  // 轉換 OSRM 步驟為我們的格式
  steps.forEach((step, index) => {
    const instruction = generateInstructionFromManeuver(
      step.maneuver,
      step.name,
      step.distance,
    );

    if (instruction) {
      navigationSteps.push({
        step: index,
        instruction: instruction,
        distance: Math.round(step.distance),
        duration: Math.round(step.duration / 60),
        coordinates: step.geometry?.coordinates || [],
        type: step.maneuver?.type || "continue",
      });
    }
  });

  return navigationSteps;
}

// 根據 OSRM 機動生成中文指令
function generateInstructionFromManeuver(maneuver, roadName, distance) {
  if (!maneuver) return "沿當前道路繼續前行";

  const distText = distance > 0 ? ` ${Math.round(distance)} 公尺` : "";
  const roadText = roadName ? ` ${roadName}` : " 當前道路";

  switch (maneuver.type) {
    case "depart":
      return `從起點出發，沿${roadText}前行${distText}`;

    case "arrive":
      return `已到達目的地`;

    case "turn":
      switch (maneuver.modifier) {
        case "left":
          return `左轉進入${roadText}${distText}`;
        case "right":
          return `右轉進入${roadText}${distText}`;
        case "sharp left":
          return `向左急轉進入${roadText}${distText}`;
        case "sharp right":
          return `向右急轉進入${roadText}${distText}`;
        case "slight left":
          return `向左微轉進入${roadText}${distText}`;
        case "slight right":
          return `向右微轉進入${roadText}${distText}`;
        default:
          return `轉彎進入${roadText}${distText}`;
      }

    case "continue":
      return `繼續沿${roadText}直行${distText}`;

    case "fork":
      return `在岔路保持${maneuver.modifier === "left" ? "左" : "右"}側行駛${distText}`;

    case "roundabout":
      return `進入圓環，第 ${maneuver.exit || 1} 個出口離開${distText}`;

    default:
      return `沿${roadText}前行${distText}`;
  }
}

// 生成模擬導航步驟（降級方案）
function generateSimulatedSteps(start, end, routeType) {
  const [startLon, startLat] = start;
  const [endLon, endLat] = end;

  const totalDistance = haversineMeters(start, end);
  const stepCount = Math.max(3, Math.min(10, Math.floor(totalDistance / 50)));

  const steps = [];

  // 起始步驟
  steps.push({
    step: 0,
    instruction: "從起點開始導航",
    distance: 0,
    duration: 0,
    type: "depart",
  });

  // 中間步驟
  if (stepCount > 2) {
    const midInstruction =
      routeType === "accessible"
        ? "沿無障礙路線繼續前行"
        : "沿規劃路線繼續前行";

    steps.push({
      step: 1,
      instruction: midInstruction,
      distance: Math.round(totalDistance * 0.6),
      duration: Math.round((totalDistance * 0.6) / 1.0 / 60),
      type: "continue",
    });
  }

  // 結束步驟
  steps.push({
    step: steps.length,
    instruction: "即將到達目的地",
    distance: Math.round(totalDistance * 0.4),
    duration: Math.round((totalDistance * 0.4) / 1.0 / 60),
    type: "arrive",
  });

  console.log(`📋 生成 ${steps.length} 個模擬導航步驟`);
  return steps;
}

// 檢查步驟完成狀態
async function checkStepCompletion(currentPosition, currentStep, session) {
  if (currentStep >= session.steps.length - 1) {
    // 最後一步：檢查是否接近終點
    const distanceToEnd = haversineMeters(currentPosition, session.end);
    return distanceToEnd < 20; // 20公尺內視為到達
  }

  // 檢查是否接近下一步的起始點
  const nextStep = session.steps[currentStep + 1];
  if (nextStep.coordinates && nextStep.coordinates.length > 0) {
    const nextStepStart = nextStep.coordinates[0];
    const distanceToNextStep = haversineMeters(currentPosition, nextStepStart);
    return distanceToNextStep < 15; // 15公尺內視為可進行下一步
  }

  // 簡單的距離判斷
  const stepProgress = Math.min(1, currentStep / session.steps.length);
  const expectedProgress = (currentStep + 1) / session.steps.length;
  return stepProgress >= expectedProgress - 0.1;
}

// 檢查是否偏離路線
async function checkOffRoute(currentPosition, currentStep, session) {
  if (!session.steps[currentStep]?.coordinates) {
    return false; // 沒有座標資訊，無法判斷
  }

  // 計算當前位置到當前步驟路線的最短距離
  const stepCoordinates = session.steps[currentStep].coordinates;
  let minDistance = Infinity;

  for (const coord of stepCoordinates) {
    const distance = haversineMeters(currentPosition, coord);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  // 如果偏離路線超過50公尺，視為偏離
  return minDistance > 50;
}

// 生成唯一的導航會話 ID
function generateNavigationId() {
  return `nav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 定期清理過期的導航會話
setInterval(
  () => {
    const now = new Date();
    const MAX_SESSION_AGE = 30 * 60 * 1000; // 30分鐘

    for (const [id, session] of navigationSessions.entries()) {
      const sessionAge = now - session.created_at;
      if (sessionAge > MAX_SESSION_AGE) {
        navigationSessions.delete(id);
        console.log(`🧹 清理過期導航會話: ${id}`);
      }
    }
  },
  5 * 60 * 1000,
); // 每5分鐘檢查一次

export default router;
