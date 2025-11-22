import { askLLM } from "./ai.js";
import fs from "fs";
import path from "path";

class AccessibilityAnalytics {
  constructor() {
    this.usageData = [];
    this.reportsCache = new Map();
  }

  // 收集使用數據
  async collectUsageData(routeData, userContext) {
    const dataPoint = {
      timestamp: new Date(),
      routeType: userContext.routeType || "normal",
      distance:
        routeData.normal?.features[0]?.properties?.summary?.distance || 0,
      duration:
        routeData.normal?.features[0]?.properties?.summary?.duration || 0,
      hasAccessibleAlternative: routeData.has_accessible_alternative || false,
      userType: userContext.userType || "wheelchair",
      start: userContext.start,
      end: userContext.end,
      weather: userContext.weather,
      traffic: userContext.traffic,
    };

    this.usageData.push(dataPoint);

    // 保存到檔案（實際應用應該用資料庫）
    this.saveDataToFile();

    return dataPoint;
  }

  // 生成每日摘要報告
  async generateDailyReport(date = new Date()) {
    const dateStr = date.toISOString().split("T")[0];

    // 檢查快取
    if (this.reportsCache.has(dateStr)) {
      return this.reportsCache.get(dateStr);
    }

    const dailyData = this.getDailyData(date);

    if (dailyData.length === 0) {
      return {
        date: dateStr,
        summary: "今日尚無使用數據",
        insights: [],
        recommendations: [],
      };
    }

    // 使用 AI 生成自然語言摘要
    const aiReport = await this.generateAIReport(dailyData, dateStr);

    this.reportsCache.set(dateStr, aiReport);
    return aiReport;
  }

  // AI 生成報告
  async generateAIReport(dailyData, dateStr) {
    const stats = this.calculateDailyStats(dailyData);

    const prompt = `
你是一個無障礙路線分析專家。請根據以下數據生成一份簡潔的每日報告：

日期：${dateStr}
使用統計：
- 總路線規劃次數：${stats.totalRoutes}
- 無障礙路線使用率：${stats.accessibleUsageRate}%
- 平均路線距離：${stats.avgDistance} 公尺
- 平均行程時間：${stats.avgDuration} 分鐘
- 熱門時段：${stats.peakHours.join(", ")}
- 主要使用者類型：${stats.mainUserType}

請用繁體中文生成包含以下部分的報告：
1. 今日使用概況（2-3句話）
2. 重要發現（2-3個要點）
3. 改善建議（基於數據的具體建議）

請用自然、專業的語氣，避免技術術語。
    `;

    try {
      const aiSummary = await askLLM(prompt);

      return {
        date: dateStr,
        summary: aiSummary,
        statistics: stats,
        rawData: dailyData.slice(0, 10), // 只回傳部分原始數據
      };
    } catch (error) {
      console.error("AI 報告生成失敗:", error);
      return this.generateFallbackReport(stats, dateStr);
    }
  }

  // 計算統計數據
  calculateDailyStats(dailyData) {
    const totalRoutes = dailyData.length;
    const accessibleRoutes = dailyData.filter(
      (d) => d.hasAccessibleAlternative,
    ).length;
    const totalDistance = dailyData.reduce((sum, d) => sum + d.distance, 0);
    const totalDuration = dailyData.reduce((sum, d) => sum + d.duration, 0);

    // 分析熱門時段
    const hours = dailyData.map((d) => new Date(d.timestamp).getHours());
    const hourCounts = {};
    hours.forEach((hour) => {
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const peakHours = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => `${hour}:00`);

    // 分析主要使用者類型
    const userTypes = dailyData.map((d) => d.userType);
    const userTypeCounts = {};
    userTypes.forEach((type) => {
      userTypeCounts[type] = (userTypeCounts[type] || 0) + 1;
    });
    const mainUserType =
      Object.entries(userTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      "unknown";

    return {
      totalRoutes,
      accessibleUsageRate:
        totalRoutes > 0
          ? Math.round((accessibleRoutes / totalRoutes) * 100)
          : 0,
      avgDistance: Math.round(totalDistance / totalRoutes),
      avgDuration: Math.round(totalDuration / totalRoutes),
      peakHours,
      mainUserType,
    };
  }

  // 取得指定日期的數據
  getDailyData(date) {
    const dateStr = date.toISOString().split("T")[0];
    return this.usageData.filter((data) => {
      const dataDate = new Date(data.timestamp).toISOString().split("T")[0];
      return dataDate === dateStr;
    });
  }

  // 保存數據到檔案
  saveDataToFile() {
    const filePath = path.join(process.cwd(), "data", "analytics.json");
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.usageData, null, 2));
    } catch (error) {
      console.error("保存分析數據失敗:", error);
    }
  }

  // 載入歷史數據
  loadHistoricalData() {
    const filePath = path.join(process.cwd(), "data", "analytics.json");
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        this.usageData = JSON.parse(data);
        console.log(`✅ 載入 ${this.usageData.length} 筆歷史分析數據`);
      }
    } catch (error) {
      console.error("載入分析數據失敗:", error);
    }
  }

  // 降級方案報告
  generateFallbackReport(stats, dateStr) {
    return {
      date: dateStr,
      summary: `今日共規劃 ${stats.totalRoutes} 條路線，無障礙路線使用率 ${stats.accessibleUsageRate}%。熱門時段為 ${stats.peakHours.join(", ")}。`,
      statistics: stats,
      insights: [
        `主要使用者類型：${stats.mainUserType}`,
        `平均行程距離：${stats.avgDistance} 公尺`,
      ],
      recommendations: [
        "建議在熱門時段加強無障礙設施維護",
        "考慮根據使用者類型優化路線推薦",
      ],
    };
  }
}

// 單例模式
export const analyticsService = new AccessibilityAnalytics();

// 初始化時載入歷史數據
analyticsService.loadHistoricalData();
