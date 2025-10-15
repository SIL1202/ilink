// server.js (clean rewrite)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

// -------------------------------------------------------
// Path helpers
// -------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------------------------
// App
// -------------------------------------------------------
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "app"))); // 靜態檔案

// -------------------------------------------------------
// Mock data: 花蓮無障礙網路（示例）
// -------------------------------------------------------
const hualienRoadNetwork = {
  accessibleRoads: [
    {
      id: "road-1",
      name: "中山路",
      coordinates: [
        [121.602, 23.974],
        [121.603, 23.975],
        [121.604, 23.976],
        [121.605, 23.977],
        [121.606, 23.978],
        [121.607, 23.979],
      ],
      properties: {
        width: 1.5,
        incline: 0.02,
        surface: "paved",
        hasRamp: true,
      },
    },
    {
      id: "road-2",
      name: "中正路",
      coordinates: [
        [121.608, 23.973],
        [121.609, 23.974],
        [121.61, 23.975],
        [121.611, 23.976],
        [121.612, 23.977],
      ],
      properties: {
        width: 1.2,
        incline: 0.05,
        surface: "paved",
        hasRamp: true,
      },
    },
    {
      id: "road-3",
      name: "國聯一路",
      coordinates: [
        [121.604, 23.98],
        [121.605, 23.981],
        [121.606, 23.982],
        [121.607, 23.983],
        [121.608, 23.984],
      ],
      properties: {
        width: 1.8,
        incline: 0.03,
        surface: "paved",
        hasRamp: true,
      },
    },
  ],
  obstacles: [
    { type: "stairs", coordinates: [121.606, 23.977] },
    { type: "steepSlope", coordinates: [121.61, 23.978] },
    { type: "narrowPath", coordinates: [121.603, 23.982] },
  ],
};

// -------------------------------------------------------
// Utilities: 單位統一（公尺、秒）
// -------------------------------------------------------
function toRad(d) {
  return (d * Math.PI) / 180;
}

// Haversine 距離（公尺）
function haversineMeters(a, b) {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 折線總長（公尺，四捨五入整數）
function routeDistanceMeters(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++)
    d += haversineMeters(coords[i - 1], coords[i]);
  return Math.round(d);
}

// 以 m/s 計算時間（秒，整數）
function routeDurationSeconds(coords, params) {
  const distance = routeDistanceMeters(coords);
  let speed = 1.0; // m/s 基準
  if (params.maximum_incline <= 0.05) speed = 1.2;
  if (params.minimum_width >= 1.2) speed *= 1.1;
  return Math.max(1, Math.round(distance / speed));
}

// 經緯度輸入驗證
function validLonLatPair(p) {
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

// 最近的無障礙道路（以道路起點當代表）
function findNearestAccessibleRoad(point, params) {
  let best = null;
  let bestDist = Infinity;
  for (const road of hualienRoadNetwork.accessibleRoads) {
    const okWidth = road.properties.width >= params.minimum_width;
    const okIncline = road.properties.incline <= params.maximum_incline;
    if (!okWidth || !okIncline) continue;
    const dist = haversineMeters(point, road.coordinates[0]);
    if (dist < bestDist) {
      bestDist = dist;
      best = road;
    }
  }
  return best;
}

// 避障（在 SAFE_RADIUS_M 內的點會略過；如果整條都被略過，回傳原路線）
function avoidObstacles(coords, obstacles, SAFE_RADIUS_M = 100) {
  const out = [];
  for (const c of coords) {
    let safe = true;
    for (const ob of obstacles) {
      if (haversineMeters(c, ob.coordinates) < SAFE_RADIUS_M) {
        safe = false;
        break;
      }
    }
    if (safe) out.push(c);
  }
  return out.length ? out : coords;
}

// 簡單平滑：移除尖銳折點（可選）
function smoothPolyline(coords, angleDeg = 20) {
  if (coords.length < 3) return coords;
  const keep = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const c = coords[i + 1];
    // 計算夾角（粗略）
    const v1 = [b[0] - a[0], b[1] - a[1]];
    const v2 = [c[0] - b[0], c[1] - b[1]];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const m1 = Math.hypot(v1[0], v1[1]);
    const m2 = Math.hypot(v2[0], v2[1]);
    if (m1 === 0 || m2 === 0) {
      keep.push(b);
      continue;
    }
    const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    if (deg > angleDeg) keep.push(b); // 夾角太小容易鋸齒，過濾掉
  }
  keep.push(coords[coords.length - 1]);
  return keep;
}

// 產生三種路線模板
function generateHighAccessibleRoute(start, end) {
  const [lon1, lat1] = start;
  const [lon2, lat2] = end;
  const mid1 = [lon1 + (lon2 - lon1) * 0.3, lat1 + (lat2 - lat1) * 0.7];
  const mid2 = [lon1 + (lon2 - lon1) * 0.7, lat1 + (lat2 - lat1) * 0.3];
  return [start, mid1, mid2, end];
}

function generateStandardAccessibleRoute(start, end) {
  const [lon1, lat1] = start;
  const [lon2, lat2] = end;
  const mid = [lon1 + (lon2 - lon1) * 0.5, lat1 + (lat2 - lat1) * 0.5];
  return [start, mid, end];
}

function generateBasicAccessibleRoute(start, end) {
  const steps = 8;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const curve = Math.sin(t * Math.PI) * 0.0001; // 約 11m 級別微曲線
    out.push([
      start[0] + (end[0] - start[0]) * t + curve,
      start[1] + (end[1] - start[1]) * t + curve,
    ]);
  }
  return out;
}

function accessibilityLevel(params) {
  if (params.maximum_incline <= 0.05 && params.minimum_width >= 1.0)
    return "high";
  if (params.maximum_incline <= 0.08 && params.minimum_width >= 0.9)
    return "medium";
  return "basic";
}

function accessibilityNotes(params) {
  const notes = [];
  if (params.maximum_incline <= 0.05) notes.push("低坡度");
  if (params.minimum_width >= 1.0) notes.push("道路寬裕");
  return notes.length ? notes.join("，") : "標準無障礙條件";
}

function basicSteps() {
  return [
    { type: "depart", instruction: "出發" },
    { type: "continue", instruction: "沿無障礙路線前進" },
    { type: "arrive", instruction: "到達目的地" },
  ];
}

// -------------------------------------------------------
// Core: 計算無障礙路線（乾淨版）
// -------------------------------------------------------
async function calculateAccessibleRouteClean(start, end, params) {
  // 1) 基於參數挑路線模板
  let coords;
  if (params.maximum_incline <= 0.05 && params.minimum_width >= 1.0) {
    coords = generateHighAccessibleRoute(start, end);
  } else if (params.maximum_incline <= 0.08 && params.minimum_width >= 0.9) {
    coords = generateStandardAccessibleRoute(start, end);
  } else {
    coords = generateBasicAccessibleRoute(start, end);
  }

  // 2) 嘗試掛上已知無障礙道路（起點/終點各拼一段）
  const nearStart = findNearestAccessibleRoad(start, params);
  const nearEnd = findNearestAccessibleRoad(end, params);
  if (nearStart && nearEnd) {
    coords = [
      start,
      ...nearStart.coordinates,
      ...coords.slice(1, -1), // 保留中間形狀
      ...nearEnd.coordinates,
      end,
    ];
  }

  // 3) 避障 + 平滑
  coords = avoidObstacles(coords, hualienRoadNetwork.obstacles, 100);
  coords = smoothPolyline(coords, 15);

  // 4) 度量與輸出
  const distance = routeDistanceMeters(coords);
  const duration = routeDurationSeconds(coords, params);

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          summary: {
            distance, // meters
            duration, // seconds
            accessibility: {
              level: accessibilityLevel(params),
              meetsRequirements: true,
              notes: accessibilityNotes(params),
            },
          },
          segments: [
            {
              distance,
              duration,
              steps: basicSteps(),
            },
          ],
          way_points: [0, coords.length - 1],
        },
        geometry: { type: "LineString", coordinates: coords },
      },
    ],
    metadata: {
      routing_type: "wheelchair_accessible",
      parameters_applied: params,
      units: { distance: "meters", duration: "seconds", speed: "m/s" },
      timestamp: new Date().toISOString(),
    },
  };
}

// -------------------------------------------------------
// API
// -------------------------------------------------------

// 健康檢查
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "hualien-accessible-routing" });
});

// 無障礙路線規劃
app.post("/api/route", async (req, res) => {
  try {
    const { start, end, params = {} } = req.body;

    if (!validLonLatPair(start) || !validLonLatPair(end)) {
      return res.status(400).json({
        error: "bad_coords",
        hint: "expect start/end as [lon, lat] within valid ranges",
      });
    }

    const maximum_incline = Number.isFinite(params.maximum_incline)
      ? params.maximum_incline
      : 0.08;
    const minimum_width = Number.isFinite(params.minimum_width)
      ? params.minimum_width
      : 0.9;

    const result = await calculateAccessibleRouteClean(start, end, {
      maximum_incline,
      minimum_width,
    });

    res.json(result);
  } catch (err) {
    console.error("Routing error:", err);
    res.status(500).json({ error: "routing_failed", message: err.message });
  }
});

// 無障礙設施
app.get("/api/accessible-facilities", (_req, res) => {
  const facilities = {
    ramps: [
      {
        coordinates: [121.605, 23.976],
        type: "ramp",
        description: "無障礙斜坡",
      },
      {
        coordinates: [121.609, 23.975],
        type: "ramp",
        description: "人行道斜坡",
      },
    ],
    elevators: [
      {
        coordinates: [121.607, 23.978],
        type: "elevator",
        description: "公共電梯",
      },
    ],
    toilets: [
      {
        coordinates: [121.606, 23.979],
        type: "toilet",
        description: "無障礙廁所",
      },
    ],
  };
  res.json(facilities);
});

// server.js - 簡化版本（不需要 Redis）

dotenv.config();

// 花蓮市主要道路網路（硬編碼，不需要外部API）
const hualienRoads = {
  nodes: {
    1: { id: 1, lon: 121.602, lat: 23.974, name: "中山路起點" },
    2: { id: 2, lon: 121.603, lat: 23.975, name: "中山路中段" },
    3: { id: 3, lon: 121.604, lat: 23.976, name: "中山路末段" },
    4: { id: 4, lon: 121.605, lat: 23.977, name: "中山路與中正路口" },
    5: { id: 5, lon: 121.606, lat: 23.978, name: "中正路起點" },
    6: { id: 6, lon: 121.607, lat: 23.976, name: "中正路中段" },
    7: { id: 7, lon: 121.608, lat: 23.977, name: "中正路末段" },
    8: { id: 8, lon: 121.609, lat: 23.978, name: "中正路與國聯一路口" },
    9: { id: 9, lon: 121.61, lat: 23.979, name: "國聯一路起點" },
    10: { id: 10, lon: 121.604, lat: 23.98, name: "國聯一路中段" },
    11: { id: 11, lon: 121.605, lat: 23.981, name: "國聯一路末段" },
    12: { id: 12, lon: 121.606, lat: 23.982, name: "林森路起點" },
    13: { id: 13, lon: 121.607, lat: 23.983, name: "林森路中段" },
    14: { id: 14, lon: 121.608, lat: 23.973, name: "花蓮車站附近" },
    15: { id: 15, lon: 121.609, lat: 23.974, name: "舊鐵道園區" },
  },
  edges: [
    { from: 1, to: 2, road: "中山路", type: "main" },
    { from: 2, to: 3, road: "中山路", type: "main" },
    { from: 3, to: 4, road: "中山路", type: "main" },
    { from: 4, to: 5, road: "中山路", type: "main" },
    { from: 5, to: 6, road: "中正路", type: "main" },
    { from: 6, to: 7, road: "中正路", type: "main" },
    { from: 7, to: 8, road: "中正路", type: "main" },
    { from: 8, to: 9, road: "中正路", type: "main" },
    { from: 9, to: 10, road: "國聯一路", type: "main" },
    { from: 10, to: 11, road: "國聯一路", type: "main" },
    { from: 11, to: 12, road: "國聯一路", type: "main" },
    { from: 12, to: 13, road: "林森路", type: "main" },
    { from: 14, to: 15, road: "國聯一路", type: "main" },
    { from: 4, to: 6, road: "連接道路", type: "side" },
    { from: 8, to: 10, road: "連接道路", type: "side" },
  ],
};

// 建立圖形結構
function buildGraph() {
  const graph = {};

  hualienRoads.edges.forEach((edge) => {
    const fromNode = hualienRoads.nodes[edge.from];
    const toNode = hualienRoads.nodes[edge.to];

    const distance = calculateDistance(
      [fromNode.lon, fromNode.lat],
      [toNode.lon, toNode.lat],
    );

    if (!graph[edge.from]) graph[edge.from] = [];
    if (!graph[edge.to]) graph[edge.to] = [];

    graph[edge.from].push({
      node: edge.to,
      distance,
      road: edge.road,
      type: edge.type,
    });

    graph[edge.to].push({
      node: edge.from,
      distance,
      road: edge.road,
      type: edge.type,
    });
  });

  return graph;
}

// 真實道路路線規劃 API
app.post("/api/real-route", async (req, res) => {
  try {
    const { start, end, params = {} } = req.body;

    if (
      !Array.isArray(start) ||
      !Array.isArray(end) ||
      start.length !== 2 ||
      end.length !== 2
    ) {
      return res
        .status(400)
        .json({ error: "bad_coords", hint: "expect start/end as [lon, lat]" });
    }

    const routeData = await calculateRealRoadRoute(start, end, params);
    res.json(routeData);
  } catch (err) {
    console.error("Real route error:", err);
    res.status(500).json({
      error: "real_routing_failed",
      message: err.message,
    });
  }
});

// 計算真實道路路線
async function calculateRealRoadRoute(start, end, params) {
  const graph = buildGraph();

  // 找到最近的節點
  const startNodeId = findNearestNode(start);
  const endNodeId = findNearestNode(end);

  if (!startNodeId || !endNodeId) {
    throw new Error("無法找到附近的道路");
  }

  // 使用 Dijkstra 演算法找最短路徑
  const path = findShortestPath(graph, startNodeId, endNodeId);

  if (!path || path.length === 0) {
    throw new Error("無法找到連接的道路路徑");
  }

  // 轉換為座標陣列
  const coordinates = [start];
  path.forEach((nodeId) => {
    coordinates.push([
      hualienRoads.nodes[nodeId].lon,
      hualienRoads.nodes[nodeId].lat,
    ]);
  });
  coordinates.push(end);

  const distance = calculateRouteDistance(coordinates);
  const duration = calculateRouteDuration(coordinates, params);

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          summary: {
            distance: distance,
            duration: duration,
            accessibility: {
              level: "medium",
              notes: "真實道路路線",
              road_count: path.length,
              road_types: getRoadTypes(path, graph),
            },
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

// Dijkstra 最短路徑演算法
function findShortestPath(graph, startNodeId, endNodeId) {
  const distances = {};
  const previous = {};
  const queue = new Set();

  // 初始化
  for (const nodeId in hualienRoads.nodes) {
    distances[nodeId] = Infinity;
    previous[nodeId] = null;
    queue.add(nodeId);
  }

  distances[startNodeId] = 0;

  while (queue.size > 0) {
    // 找到距離最小的節點
    let current = null;
    let minDistance = Infinity;

    for (const nodeId of queue) {
      if (distances[nodeId] < minDistance) {
        minDistance = distances[nodeId];
        current = nodeId;
      }
    }

    if (current === endNodeId) {
      // 重建路徑
      const path = [];
      let node = endNodeId;
      while (node !== null) {
        path.unshift(node);
        node = previous[node];
      }
      return path;
    }

    queue.delete(current);

    // 更新鄰居節點
    for (const neighbor of graph[current] || []) {
      const alt = distances[current] + neighbor.distance;
      if (alt < distances[neighbor.node]) {
        distances[neighbor.node] = alt;
        previous[neighbor.node] = current;
      }
    }
  }

  return null;
}

// 找到最近的節點
function findNearestNode(point) {
  const [lon, lat] = point;
  let nearestNodeId = null;
  let minDistance = Infinity;

  for (const nodeId in hualienRoads.nodes) {
    const node = hualienRoads.nodes[nodeId];
    const distance = calculateDistance([lon, lat], [node.lon, node.lat]);

    if (distance < minDistance) {
      minDistance = distance;
      nearestNodeId = nodeId;
    }
  }

  return nearestNodeId;
}

// 取得道路類型
function getRoadTypes(path, graph) {
  const types = new Set();

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];

    const edge = graph[from].find((conn) => conn.node == to);
    if (edge) {
      types.add(edge.type);
    }
  }

  return Array.from(types);
}

// 工具函數
function calculateDistance(coord1, coord2) {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  return Math.sqrt(dLon * dLon + dLat * dLat) * 111000;
}

function calculateRouteDistance(coordinates) {
  let totalDistance = 0;
  for (let i = 1; i < coordinates.length; i++) {
    totalDistance += calculateDistance(coordinates[i - 1], coordinates[i]);
  }
  return totalDistance;
}

function calculateRouteDuration(coordinates, params) {
  const distance = calculateRouteDistance(coordinates);
  let speed = 1.0; // m/s

  if (params.maximum_incline <= 0.05) speed = 1.2;
  if (params.minimum_width >= 1.2) speed = 1.3;

  return Math.round(distance / speed);
}

// 原有的簡單路線 API（保持不變）
app.post("/api/route", async (req, res) => {
  try {
    const { start, end, params = {} } = req.body;

    if (
      !Array.isArray(start) ||
      !Array.isArray(end) ||
      start.length !== 2 ||
      end.length !== 2
    ) {
      return res
        .status(400)
        .json({ error: "bad_coords", hint: "expect start/end as [lon, lat]" });
    }

    const maximum_incline = params.maximum_incline ?? 0.08;
    const minimum_width = params.minimum_width ?? 0.9;

    const routeData = await calculateAccessibleRoute(start, end, {
      maximum_incline,
      minimum_width,
    });

    res.json(routeData);
  } catch (err) {
    console.error("Routing error:", err);
    res.status(500).json({
      error: "routing_failed",
      message: err.message,
    });
  }
});

// 簡單路線計算（保持不變）
async function calculateAccessibleRoute(start, end, params) {
  // ... 保持你原有的簡單路線邏輯
}

// -------------------------------------------------------
// Start
// -------------------------------------------------------
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`🚀 花蓮無障礙路線服務啟動於 http://localhost:${port}`);
  console.log(
    "🗺️  路線與單位已統一：distance=meters, duration=seconds, speed=m/s",
  );
});
