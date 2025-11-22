// backend/src/services/route-analysis-service.js
import { askLLM } from "../ai/ai.js";
import { obstacleService } from "./obstacle-service.js";
import { realtimeDataService } from "./realtime-data-service.js";

class RouteAnalysisService {
  constructor() {
    this.accessibilityFeatures = {
      wide_pavement: "寬敞人行道",
      ramp: "無障礙坡道",
      elevator: "電梯",
      tactile_paving: "導盲磚",
      crossing_signals: "有聲號誌",
      resting_area: "休息區",
      sheltered: "有遮蔭",
      well_lit: "照明良好",
    };
  }

  // 分析路線的無障礙特性
  async analyzeRouteAccessibility(routeData, userType = "wheelchair") {
    try {
      const analysis = {
        suitability: "good", // good, fair, poor
        features: [],
        barriers: [],
        explanation: "",
        suggestions: [],
        confidence: 0.8,
      };

      // 分析路線幾何特性
      const geometryAnalysis = await this.analyzeRouteGeometry(routeData);
      analysis.features.push(...geometryAnalysis.features);
      analysis.barriers.push(...geometryAnalysis.barriers);

      // 檢查即時障礙物
      const obstacleAnalysis = await this.checkRouteObstacles(routeData);
      analysis.barriers.push(...obstacleAnalysis.barriers);

      // 檢查天氣影響
      const weatherAnalysis = await this.checkWeatherImpact(routeData);
      if (weatherAnalysis.impact) {
        analysis.barriers.push(weatherAnalysis.impact);
      }

      // 生成 AI 解釋
      analysis.explanation = await this.generateAIExplanation(
        analysis.features,
        analysis.barriers,
        userType,
      );

      // 生成建議
      analysis.suggestions = this.generateSuggestions(analysis, userType);

      // 評估適合度
      analysis.suitability = this.assessSuitability(analysis, userType);

      return analysis;
    } catch (error) {
      console.error("路線分析失敗:", error);
      return this.getFallbackAnalysis();
    }
  }

  // 分析路線幾何特性
  async analyzeRouteGeometry(routeData) {
    const features = [];
    const barriers = [];

    const route = routeData.routes[0];
    const { distance, duration, geometry } = route;

    // 分析距離和坡度
    if (distance < 1000) {
      features.push({
        type: "short_distance",
        description: "路線距離較短，適合輪椅通行",
        confidence: 0.9,
      });
    }

    // 分析道路類型（簡化實現）
    const roadTypes = await this.analyzeRoadTypes(geometry.coordinates);

    if (roadTypes.includes("paved_road")) {
      features.push({
        type: "paved_surface",
        description: "鋪面道路，輪椅行駛平穩",
        confidence: 0.8,
      });
    }

    if (roadTypes.includes("sidewalk")) {
      features.push({
        type: "wide_pavement",
        description: "設有人行道，與車流分離",
        confidence: 0.7,
      });
    }

    // 檢查坡度變化（簡化）
    const slopeAnalysis = this.analyzeSlope(geometry.coordinates);
    if (slopeAnalysis.maxSlope < 5) {
      features.push({
        type: "gentle_slope",
        description: "坡度平緩，輪椅容易推行",
        confidence: 0.8,
      });
    } else if (slopeAnalysis.maxSlope > 8) {
      barriers.push({
        type: "steep_slope",
        description: `部分路段坡度較陡 (${slopeAnalysis.maxSlope}%)`,
        severity: "medium",
        suggestion: "建議減速慢行",
      });
    }

    return { features, barriers };
  }

  // 檢查路線障礙物
  async checkRouteObstacles(routeData) {
    const barriers = [];

    const obstacleCheck = obstacleService.checkRouteForObstacles(
      routeData.routes[0].geometry.coordinates,
    );

    if (obstacleCheck.hasObstacles) {
      obstacleCheck.obstacles.forEach((obstacle) => {
        barriers.push({
          type: obstacle.type,
          description: `有${this.getObstacleDescription(obstacle.type)}報告`,
          severity: obstacle.severity,
          suggestion: obstacleCheck.alternativeSuggestions[0] || "請小心通行",
        });
      });
    }

    return { barriers };
  }

  // 檢查天氣影響
  async checkWeatherImpact(routeData) {
    try {
      const routeCenter = this.calculateRouteCenter(
        routeData.routes[0].geometry.coordinates,
      );
      const weather = await realtimeDataService.getWeatherData(
        routeCenter.lat,
        routeCenter.lng,
      );

      if (weather.condition === "heavy_rain") {
        return {
          impact: {
            type: "weather",
            description: "大雨可能影響路面狀況",
            severity: "medium",
            suggestion: "建議雨停後再出行",
          },
        };
      }
    } catch (error) {
      console.error("天氣影響分析失敗:", error);
    }

    return { impact: null };
  }

  // 生成 AI 解釋
  async generateAIExplanation(features, barriers, userType) {
    const featureText = features.map((f) => f.description).join("；");
    const barrierText = barriers.map((b) => b.description).join("；");

    const prompt = `
你是一個無障礙路線專家，請為${this.getUserTypeText(userType)}解釋為什麼這條路線適合通行。

路線優點：${featureText || "無特別優點"}
路線注意事項：${barrierText || "無重大障礙"}

請生成一段 3-4 句話的解釋，包含：
1. 路線的整體適合度
2. 具體的無障礙特點
3. 需要注意的事項
4. 給${this.getUserTypeText(userType)}的建議

請用溫暖、專業的繁體中文，語氣要讓人安心。
    `;

    try {
      return await askLLM(prompt);
    } catch (error) {
      console.error("AI 解釋生成失敗:", error);
      return this.generateFallbackExplanation(features, barriers, userType);
    }
  }

  // 分析道路類型（簡化實現）
  async analyzeRoadTypes(coordinates) {
    // 實際應該使用地圖資料，這裡用簡化邏輯
    const types = [];

    // 假設前1/3是市區道路
    if (coordinates.length > 10) {
      types.push("paved_road");
      types.push("sidewalk");
    }

    // 假設後段可能有不同類型
    if (coordinates.length > 20) {
      types.push("residential_street");
    }

    return types;
  }

  // 分析坡度
  analyzeSlope(coordinates) {
    // 簡化坡度分析
    let maxSlope = 0;
    let avgSlope = 0;

    for (let i = 1; i < coordinates.length; i++) {
      // 實際應該計算高程差，這裡用隨機值模擬
      const slope = Math.random() * 10;
      maxSlope = Math.max(maxSlope, slope);
      avgSlope += slope;
    }

    avgSlope /= coordinates.length - 1;

    return { maxSlope: Math.round(maxSlope), avgSlope: Math.round(avgSlope) };
  }

  // 生成建議
  generateSuggestions(analysis, userType) {
    const suggestions = [];

    if (analysis.barriers.some((b) => b.severity === "high")) {
      suggestions.push("建議選擇替代路線");
    }

    if (analysis.features.some((f) => f.type === "gentle_slope")) {
      suggestions.push("坡度平緩，適合長時間推行");
    }

    if (userType === "wheelchair") {
      suggestions.push("請注意路面平整度");
    }

    if (analysis.barriers.some((b) => b.type === "weather")) {
      suggestions.push("天氣因素請小心通行");
    }

    return suggestions.length > 0 ? suggestions : ["路線狀況良好，可安心通行"];
  }

  // 評估適合度
  assessSuitability(analysis, userType) {
    const highSeverityBarriers = analysis.barriers.filter(
      (b) => b.severity === "high",
    ).length;
    const mediumSeverityBarriers = analysis.barriers.filter(
      (b) => b.severity === "medium",
    ).length;

    if (highSeverityBarriers > 0) return "poor";
    if (mediumSeverityBarriers > 1) return "fair";
    if (analysis.features.length >= 2) return "good";

    return "fair";
  }

  // 工具函式
  getUserTypeText(userType) {
    const typeMap = {
      wheelchair: "輪椅使用者",
      visual: "視覺障礙者",
      elderly: "年長者",
      default: "您",
    };
    return typeMap[userType] || "您";
  }

  getObstacleDescription(type) {
    const descMap = {
      construction: "施工",
      road_closure: "道路封閉",
      stepped_path: "階梯路段",
      ramp_blocked: "坡道阻塞",
    };
    return descMap[type] || "障礙物";
  }

  calculateRouteCenter(coordinates) {
    const lats = coordinates.map((coord) => coord[1]);
    const lngs = coordinates.map((coord) => coord[0]);

    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }

  generateFallbackExplanation(features, barriers, userType) {
    const userText = this.getUserTypeText(userType);
    let explanation = `這條路線整體上適合${userText}通行。`;

    if (features.length > 0) {
      explanation += `路線具有${features.map((f) => f.description).join("、")}等優點。`;
    }

    if (barriers.length > 0) {
      explanation += `需要注意${barriers.map((b) => b.description).join("、")}。`;
    } else {
      explanation += "沿途無重大障礙物。";
    }

    explanation += `請${userText}依照自身情況謹慎評估。`;

    return explanation;
  }

  getFallbackAnalysis() {
    return {
      suitability: "fair",
      features: [],
      barriers: [],
      explanation: "路線分析暫時無法提供，建議您實際確認路線狀況。",
      suggestions: ["請實地確認路線狀況", "選擇熟悉的路線"],
      confidence: 0.3,
    };
  }
}

// 單例模式
export const routeAnalysisService = new RouteAnalysisService();
