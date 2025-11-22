// backend/src/services/obstacle-service.js - 修正版本
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
    this.dataFile = path.join(process.cwd(), "data", "obstacles.json");
    this.ensureDataDirectory();
    this.loadObstaclesFromFile(); // 啟動時載入資料
  }

  // 確保資料目錄存在
  ensureDataDirectory() {
    const dataDir = path.dirname(this.dataFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // 回報障礙物（修正版本）
  async reportObstacle(reportData) {
    try {
      console.log("📝 收到障礙物回報:", reportData);

      // 基本驗證
      if (!reportData.location || !reportData.type) {
        throw new Error("缺少必要資料：位置和類型");
      }

      const obstacle = new Obstacle(reportData);

      // AI 驗證（可選）
      if (reportData.description) {
        const verification = await this.verifyObstacleReport(obstacle);
        obstacle.confidence = verification.confidence;
        if (verification.suggestedType) {
          obstacle.type = verification.suggestedType;
        }
      }

      // 儲存到記憶體和檔案
      this.obstacles.set(obstacle.id, obstacle);
      await this.saveObstaclesToFile();

      console.log(`✅ 障礙物回報已記錄: ${obstacle.id}`);

      return {
        success: true,
        obstacle: obstacle,
        message: this.generateUserMessage(obstacle),
      };
    } catch (error) {
      console.error("❌ 障礙物回報失敗:", error);
      return {
        success: false,
        error: error.message,
        message: "障礙物回報失敗，請稍後再試",
      };
    }
  }

  // 儲存到檔案（非同步版本）
  async saveObstaclesToFile() {
    try {
      const data = Array.from(this.obstacles.values()).map((obs) => ({
        ...obs,
        // 確保日期是字串格式
        createdAt: obs.createdAt.toISOString(),
        verifiedAt: obs.verifiedAt ? obs.verifiedAt.toISOString() : null,
        resolvedAt: obs.resolvedAt ? obs.resolvedAt.toISOString() : null,
      }));

      await fs.promises.writeFile(this.dataFile, JSON.stringify(data, null, 2));
      console.log(`💾 已儲存 ${data.length} 個障礙物到檔案`);
    } catch (error) {
      console.error("❌ 儲存障礙物資料失敗:", error);
    }
  }

  // 從檔案載入（修正版本）
  async loadObstaclesFromFile() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = await fs.promises.readFile(this.dataFile, "utf-8");
        const obstacles = JSON.parse(data);

        obstacles.forEach((obsData) => {
          // 轉換日期字串回 Date 物件
          const obstacle = new Obstacle({
            ...obsData,
            createdAt: new Date(obsData.createdAt),
            verifiedAt: obsData.verifiedAt
              ? new Date(obsData.verifiedAt)
              : null,
            resolvedAt: obsData.resolvedAt
              ? new Date(obsData.resolvedAt)
              : null,
          });
          this.obstacles.set(obstacle.id, obstacle);
        });

        console.log(`✅ 載入 ${this.obstacles.size} 個障礙物記錄`);
      } else {
        console.log("📁 無障礙物記錄檔案，將建立新檔案");
        // 建立空檔案
        await this.saveObstaclesToFile();
      }
    } catch (error) {
      console.error("❌ 載入障礙物資料失敗:", error);
    }
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
}

export const obstacleService = new ObstacleService();
export { OBSTACLE_TYPES, SEVERITY_LEVELS };
