// backend/src/services/obstacle-service.js
import Obstacle, {
  OBSTACLE_TYPES,
  SEVERITY_LEVELS,
} from "../models/Obstacle.js";
import { askLLM } from "../ai/ai.js";
import fs from "fs";
import path from "path";

class ObstacleService {
  constructor() {
    this.obstacles = new Map();
    this.loadObstaclesFromFile();
  }

  // 回報障礙物
  async reportObstacle(reportData) {
    const obstacle = new Obstacle(reportData);

    // AI 驗證回報可信度
    const verification = await this.verifyObstacleReport(obstacle);
    obstacle.confidence = verification.confidence;

    if (verification.suggestedType) {
      obstacle.type = verification.suggestedType;
    }

    // 儲存障礙物
    this.obstacles.set(obstacle.id, obstacle);
    this.saveObstaclesToFile();

    // 通知可能受影響的使用者
    await this.notifyImpactedUsers(obstacle);

    console.log(`✅ 障礙物回報已記錄: ${obstacle.id}`, obstacle);

    return {
      success: true,
      obstacle: obstacle,
      message: this.generateUserMessage(obstacle),
    };
  }

  // AI 驗證回報
  async verifyObstacleReport(obstacle) {
    const prompt = `
請分析這個障礙物回報的可信度和類型：

回報內容：${obstacle.description}
回報類型：${obstacle.type}
嚴重程度：${obstacle.severity}

請回傳 JSON：
{
  "confidence": 0.0-1.0,
  "suggestedType": "construction|road_closure|stepped_path|...",
  "reason": "分析原因",
  "suggestedSeverity": "low|medium|high|critical"
}
    `;

    try {
      const analysis = await askLLM(prompt);
      const result = JSON.parse(analysis);

      return {
        confidence: result.confidence || 0.5,
        suggestedType: result.suggestedType || obstacle.type,
        reason: result.reason || "AI 分析完成",
        suggestedSeverity: result.suggestedSeverity || obstacle.severity,
      };
    } catch (error) {
      console.error("AI 障礙物驗證失敗:", error);
      return {
        confidence: 0.3,
        suggestedType: obstacle.type,
        reason: "AI 分析失敗，使用預設值",
        suggestedSeverity: obstacle.severity,
      };
    }
  }

  // 取得區域內的障礙物
  getObstaclesInArea(center, radiusMeters = 500) {
    const obstaclesInArea = [];

    for (const obstacle of this.obstacles.values()) {
      if (
        obstacle.status !== "resolved" &&
        this.calculateDistance(center, obstacle.location) <= radiusMeters
      ) {
        obstaclesInArea.push(obstacle);
      }
    }

    return obstaclesInArea.sort((a, b) => b.confidence - a.confidence);
  }

  // 檢查路線是否受障礙影響
  checkRouteForObstacles(routeGeometry, userType = "wheelchair") {
    const obstaclesOnRoute = [];
    const alternativeSuggestions = [];

    for (const obstacle of this.obstacles.values()) {
      if (
        obstacle.status !== "resolved" &&
        this.isObstacleOnRoute(obstacle, routeGeometry)
      ) {
        obstaclesOnRoute.push(obstacle);

        // 根據障礙類型生成建議
        const suggestion = this.generateAlternativeSuggestion(
          obstacle,
          userType,
        );
        if (suggestion) {
          alternativeSuggestions.push(suggestion);
        }
      }
    }

    return {
      hasObstacles: obstaclesOnRoute.length > 0,
      obstacles: obstaclesOnRoute,
      alternativeSuggestions: alternativeSuggestions,
      warning:
        obstaclesOnRoute.length > 0
          ? `路線上有 ${obstaclesOnRoute.length} 個障礙物報告`
          : null,
    };
  }

  // 標記障礙物為已解決
  resolveObstacle(obstacleId, resolvedBy = "system") {
    const obstacle = this.obstacles.get(obstacleId);
    if (obstacle) {
      obstacle.status = "resolved";
      obstacle.resolvedAt = new Date();
      obstacle.resolvedBy = resolvedBy;
      this.saveObstaclesToFile();
      return true;
    }
    return false;
  }

  // 通知受影響使用者
  async notifyImpactedUsers(obstacle) {
    // 這裡可以實作推播通知
    console.log(
      `📢 新障礙物通知: ${obstacle.type} at ${JSON.stringify(obstacle.location)}`,
    );

    // 可以整合到現有的聊天系統
    // 或者發送推播通知給附近的使用者
  }

  // 生成使用者訊息
  generateUserMessage(obstacle) {
    const messages = {
      construction: `🏗️ 已記錄施工障礙物，將提醒其他使用者避開此路段。`,
      road_closure: `🚧 已記錄道路封閉資訊，路線規劃將自動避開。`,
      stepped_path: `📶 已記錄階梯路段，無障礙路線將重新規劃。`,
      ramp_blocked: `♿ 已記錄坡道阻塞，正在尋找替代路線。`,
      default: `⚠️ 已記錄障礙物回報，感謝您的協助！`,
    };

    return messages[obstacle.type] || messages.default;
  }

  // 計算距離
  calculateDistance(point1, point2) {
    const R = 6371000; // 地球半徑(公尺)
    const dLat = ((point2.lat - point1.lat) * Math.PI) / 180;
    const dLng = ((point2.lng - point1.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((point1.lat * Math.PI) / 180) *
        Math.cos((point2.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // 檢查障礙物是否在路線上
  isObstacleOnRoute(obstacle, routeGeometry) {
    // 簡化實現：檢查障礙物是否接近路線的任一節點
    for (const point of routeGeometry) {
      const distance = this.calculateDistance(
        { lat: point[1], lng: point[0] },
        obstacle.location,
      );
      if (distance < 50) {
        // 50公尺內視為在路線上
        return true;
      }
    }
    return false;
  }

  // 生成替代建議
  generateAlternativeSuggestion(obstacle, userType) {
    const suggestions = {
      construction: `前方施工中，建議改走替代道路`,
      road_closure: `道路封閉，已為您規劃繞道路線`,
      stepped_path: `此路段有階梯，輪椅無法通行，建議改道`,
      ramp_blocked: `無障礙坡道阻塞，尋找其他入口`,
      narrow_passage: `通道狹窄，建議選擇較寬敞路線`,
    };

    return suggestions[obstacle.type] || `前方有障礙物，建議改道`;
  }

  // 儲存到檔案
  saveObstaclesToFile() {
    const filePath = path.join(process.cwd(), "data", "obstacles.json");
    const data = Array.from(this.obstacles.values());
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("儲存障礙物資料失敗:", error);
    }
  }

  // 從檔案載入
  loadObstaclesFromFile() {
    const filePath = path.join(process.cwd(), "data", "obstacles.json");
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        const obstacles = JSON.parse(data);
        obstacles.forEach((obs) => {
          const obstacle = new Obstacle(obs);
          this.obstacles.set(obstacle.id, obstacle);
        });
        console.log(`✅ 載入 ${this.obstacles.size} 個障礙物記錄`);
      }
    } catch (error) {
      console.error("載入障礙物資料失敗:", error);
    }
  }
}

// 單例模式
export const obstacleService = new ObstacleService();
export { OBSTACLE_TYPES, SEVERITY_LEVELS };
