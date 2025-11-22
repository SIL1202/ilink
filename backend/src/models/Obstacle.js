// backend/src/models/Obstacle.js
class Obstacle {
  constructor(data = {}) {
    this.id = data.id || generateObstacleId();
    this.type = data.type || "unknown"; // obstacle_type 中的類型
    this.location = data.location; // { lat, lng }
    this.description = data.description || "";
    this.severity = data.severity || "medium"; // low, medium, high, critical
    this.reporter = data.reporter || "anonymous";
    this.status = data.status || "reported"; // reported, verified, resolved, false_alarm
    this.evidence = data.evidence || []; // 照片、語音等證據
    this.impactedUsers = data.impactedUsers || 0;
    this.createdAt = data.createdAt || new Date();
    this.verifiedAt = data.verifiedAt || null;
    this.resolvedAt = data.resolvedAt || null;
    this.confidence = data.confidence || 0.5; // AI 驗證可信度
  }
}

// 障礙物類型定義
export const OBSTACLE_TYPES = {
  CONSTRUCTION: "construction",
  ROAD_CLOSURE: "road_closure",
  STEPPED_PATH: "stepped_path",
  NARROW_PASSAGE: "narrow_passage",
  SURFACE_ISSUE: "surface_issue",
  ELEVATOR_OUTAGE: "elevator_outage",
  RAMP_BLOCKED: "ramp_blocked",
  OTHER: "other",
};

// 嚴重程度
export const SEVERITY_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

function generateObstacleId() {
  return `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default Obstacle;
