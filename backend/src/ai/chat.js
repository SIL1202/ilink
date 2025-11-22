import express from "express";
import { naturalLanguageToPlace, askLLM } from "./ai.js";
import { analyticsService } from "./analytics.js";
import ramps from "../data/ramps.json" assert { type: "json" };
import { classifyUserIntent } from "./intent.js";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = express.Router();

// 儲存使用者上下文（簡單實現）
const userContexts = new Map();

router.post("/chat", async (req, res) => {
  const { message, userId = "default" } = req.body;

  try {
    const intent = await classifyUserIntent(message);

    // 更新使用者上下文
    const userContext = userContexts.get(userId) || {};
    userContext.lastMessage = message;
    userContexts.set(userId, userContext);

    console.log(`🤖 意圖分類: ${intent}, 使用者: ${userId}`);

    switch (intent) {
      case "nlq":
        return await handleNLQ(message, res);

      case "report":
        return await handleReportRequest(message, res);

      case "list_facilities":
        return await handleListFacilities(message, res);

      case "general_question":
        return await handleGeneralQuestion(message, res);

      case "navigation":
        return res.json({
          type: "navigation",
          reply:
            "導航功能已整合在路線規劃中，請先在地圖上設定起點和終點，然後點擊「規劃路線」按鈕。",
          suggestions: ["點擊地圖設定起點", "點擊地圖設定終點", "開始規劃路線"],
        });

      default:
        return await handleGeneralQuestion(message, res);
    }
  } catch (error) {
    console.error("❌ 聊天處理失敗:", error);
    res.status(500).json({
      reply: "抱歉，處理您的請求時出現問題，請稍後再試。",
      error: error.message,
    });
  }
});

// 處理自然語言查詢地點
async function handleNLQ(message, res) {
  console.log("🔍 處理自然語言查詢:", message);

  const ai = await naturalLanguageToPlace(message, ramps);

  if (ai.index === -1 || ai.index == null) {
    return res.json({
      type: "nlq",
      found: false,
      reply: `抱歉，找不到「${message}」相關的地點。請嘗試其他描述方式，或說「列出所有坡道」查看可用地點。`,
      reason: ai.reason,
      suggestions: ["列出所有坡道", "花蓮火車站", "花蓮醫院", "重新查詢"],
    });
  }

  const matched = ramps[ai.index];

  return res.json({
    type: "nlq",
    found: true,
    place: matched.name,
    lat: matched.lat,
    lon: matched.lon,
    reply: `🗺️ 已找到「${matched.name}」，已為您標記在地圖上！要規劃到這裡的路線嗎？`,
    suggestions: ["規劃路線到此", "查看附近設施", "列出所有坡道"],
  });
}

// 處理報告請求
async function handleReportRequest(message, res) {
  console.log("📊 處理報告請求:", message);

  // 分析使用者想要什麼類型的報告
  const reportType = await analyzeReportType(message);

  switch (reportType) {
    case "daily":
      const dailyReport = await analyticsService.generateDailyReport();
      return res.json({
        type: "daily_report",
        reply: `📊 今日無障礙路線使用報告：\n\n${dailyReport.summary}`,
        data: dailyReport,
        suggestions: ["每週報告", "列出所有坡道", "規劃路線"],
      });

    case "weekly":
      return res.json({
        type: "report",
        reply:
          "📈 週報功能開發中，目前提供每日報告。您可以詢問「今日報告」來查看當天使用統計。",
        suggestions: ["今日報告", "列出所有坡道", "使用統計"],
      });

    default:
      const defaultReport = await analyticsService.generateDailyReport();
      return res.json({
        type: "report",
        reply: `📈 無障礙路線分析：\n${defaultReport.summary}`,
        data: defaultReport.statistics,
        suggestions: ["詳細報告", "列出所有坡道", "熱門地點"],
      });
  }
}

// 處理列出設施請求
async function handleListFacilities(message, res) {
  console.log("📋 處理列出設施請求:", message);

  // 分析使用者想要列出什麼
  const listType = await analyzeListType(message);

  switch (listType) {
    case "ramps":
      return await listAllRamps(res);

    case "facilities":
      return await listAccessibilityFacilities(res);

    default:
      return await listAllRamps(res);
  }
}

// 列出所有坡道
async function listAllRamps(res) {
  if (!ramps || ramps.length === 0) {
    return res.json({
      type: "list_facilities",
      reply: "❌ 目前系統中還沒有坡道資料。",
      suggestions: ["重新載入資料", "聯絡管理員", "使用說明"],
    });
  }

  // 生成坡道列表文字
  const rampList = ramps
    .map(
      (ramp, index) =>
        `${index + 1}. ${ramp.name} - [${ramp.lon.toFixed(6)}, ${ramp.lat.toFixed(6)}]`,
    )
    .join("\n");

  const reply = `🗺️ 目前地圖上標示的無障礙坡道共有 ${ramps.length} 個：\n\n${rampList}\n\n💡 提示：地圖上會高亮顯示所有坡道位置，您可以點擊標記查看詳細資訊或直接規劃路線。`;

  return res.json({
    type: "list_facilities",
    reply: reply,
    data: {
      count: ramps.length,
      ramps: ramps.slice(0, 20), // 只回傳前20個避免過大
    },
    suggestions: ["規劃到最近坡道路線", "顯示坡道詳細資訊", "重新整理坡道列表"],
  });
}

// 列出無障礙設施（擴展用）
async function listAccessibilityFacilities(res) {
  // 這裡可以擴展到其他無障礙設施
  const reply =
    "🛠️ 目前主要提供無障礙坡道資訊。未來將擴充更多無障礙設施資料，如電梯、無障礙廁所、輪椅充電站等。";

  return res.json({
    type: "list_facilities",
    reply: reply,
    suggestions: ["列出所有坡道", "查詢特定地點", "使用說明"],
  });
}

// 處理一般問題
async function handleGeneralQuestion(message, res) {
  console.log("💬 處理一般問題:", message);

  // 先檢查是否是系統相關問題
  const systemAnswer = await checkSystemKnowledge(message);
  if (systemAnswer) {
    return res.json({
      type: "general_question",
      reply: systemAnswer,
      suggestions: ["列出所有坡道", "規劃路線", "今日報告", "使用說明"],
    });
  }

  // 使用 AI 回答其他問題
  const prompt = `
你是一個無障礙路線規劃的AI助手，專門幫助輪椅使用者和行動不便者規劃安全、便捷的路線。

系統資訊：
- 目前有 ${ramps.length} 個無障礙坡道資料
- 提供路線規劃、語音導航、使用報告功能
- 支援自然語言查詢地點
- 可以列出所有坡道位置

請用友善、專業、溫暖的繁體中文回答使用者的問題，並提供實用建議。
保持回答簡潔實用，最多3-4句話，重點是解決使用者的問題。

使用者問題：「${message}」
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const reply = completion.choices[0].message.content;

    return res.json({
      type: "general_question",
      reply: reply,
      suggestions: ["列出所有坡道", "規劃路線", "今日報告", "使用說明"],
    });
  } catch (error) {
    console.error("一般問題處理失敗:", error);
    return res.json({
      type: "general_question",
      reply:
        "🤖 我主要協助無障礙路線規劃，您可以問我關於坡道位置、路線規劃、使用統計等問題。需要什麼幫助呢？",
      suggestions: ["列出所有坡道", "規劃路線", "今日報告", "使用說明"],
    });
  }
}

// 檢查系統知識庫問題
async function checkSystemKnowledge(message) {
  const knowledgeMap = {
    如何使用: `📖 使用說明：
1. 🗺️ 點擊地圖設定起點和終點
2. 🧭 點擊「規劃路線」規劃無障礙路線
3. 💬 使用聊天功能查詢地點或取得報告
4. 🔊 點擊「開始導航」跟隨語音指引
5. 📋 說「列出所有坡道」查看所有地點`,

    功能說明: `🛠️ 系統功能：
• 🗺️ 無障礙路線規劃（自動避開階梯）
• 🔍 自然語言查詢地點（說出想去的地方）
• 🧭 即時語音導航指引
• 📊 使用統計報告分析
• 📋 坡道位置查詢與列表
• 💬 智能對話協助`,

    有哪些功能: `🌟 主要功能：
🗺️ 路線規劃 - 規劃無障礙路線，避開障礙
🔍 地點查詢 - 用自然語言找地點
🧭 即時導航 - 語音導航指引
📊 使用報告 - 統計分析報告
📋 坡道列表 - 查看所有無障礙坡道
💬 智能對話 - 隨時詢問問題`,

    幫助: `🆘 需要什麼幫助？
• 🔍 找地點：直接告訴我您想去哪裡
• 🗺️ 規劃路線：點擊地圖設定起終點
• 📋 查看坡道：說「列出所有坡道」
• 📊 取得報告：說「今日報告」
• 🧭 導航：規劃路線後點擊開始導航
• ❓ 使用說明：說「如何使用」`,

    你好: `👋 您好！我是 WheelWay AI 助手，專門協助無障礙路線規劃。

我可以幫您：
• 查詢無障礙坡道位置
• 規劃避開障礙的路線  
• 提供語音導航指引
• 生成使用統計報告

請告訴我您需要什麼幫助！`,

    謝謝: `🙏 不客氣！很高興能幫助您。

如果有任何其他問題，隨時告訴我。祝您行程順利！♿`,

    哈囉: `👋 哈囉！我是您的無障礙路線助手。

需要找地點、規劃路線，還是查看坡道資訊呢？請儘管告訴我！`,
  };

  // 簡單關鍵字匹配
  const lowerMessage = message.toLowerCase();
  for (const [key, answer] of Object.entries(knowledgeMap)) {
    if (lowerMessage.includes(key.toLowerCase())) {
      return answer;
    }
  }

  return null;
}

// 分析報告類型
async function analyzeReportType(message) {
  const prompt = `
判斷使用者想要什麼類型的報告：

可能類型：
- daily: 今日報告、今天統計、每日摘要、今日使用情況
- weekly: 本週報告、週報、七天統計、每週分析
- general: 一般報告、統計數據、分析報告、使用統計

使用者輸入：「${message}」

僅回傳類型代號。
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error("報告類型分析失敗:", error);
    return "daily"; // 預設回傳日報
  }
}

// 分析列出類型
async function analyzeListType(message) {
  const prompt = `
判斷使用者想要列出什麼類型的設施：

類型：
- ramps: 坡道相關（例如：坡道、無障礙坡道、斜坡、所有坡道、列出坡道）
- facilities: 無障礙設施（例如：無障礙廁所、電梯、設施、無障礙設施）
- all: 所有地點、全部地點、所有位置

使用者輸入：「${message}」

僅回傳類型代號。
  `;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error("列出類型分析失敗:", error);
    return "ramps";
  }
}

// 新增 API：記錄路線規劃數據
router.post("/analytics/route", async (req, res) => {
  try {
    const { routeData, userContext } = req.body;

    const dataPoint = await analyticsService.collectUsageData(
      routeData,
      userContext,
    );

    res.json({
      success: true,
      recorded: dataPoint,
      message: `已記錄第 ${analyticsService.usageData.length} 筆路線數據`,
    });
  } catch (error) {
    console.error("記錄分析數據失敗:", error);
    res.status(500).json({
      success: false,
      error: "數據記錄失敗",
      message: error.message,
    });
  }
});

// 新增 API：取得報告
router.get("/analytics/report/daily", async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    const report = await analyticsService.generateDailyReport(targetDate);

    res.json({
      success: true,
      ...report,
    });
  } catch (error) {
    console.error("生成報告失敗:", error);
    res.status(500).json({
      success: false,
      error: "報告生成失敗",
      message: error.message,
    });
  }
});

// 新增 API：取得坡道列表
router.get("/facilities/ramps", async (req, res) => {
  try {
    res.json({
      success: true,
      count: ramps.length,
      ramps: ramps,
    });
  } catch (error) {
    console.error("取得坡道列表失敗:", error);
    res.status(500).json({
      success: false,
      error: "取得坡道列表失敗",
      message: error.message,
    });
  }
});

// 健康檢查
router.get("/health", (req, res) => {
  res.json({
    service: "AI Chat Service",
    status: "healthy",
    ramps_count: ramps.length,
    analytics_data_count: analyticsService.usageData.length,
    timestamp: new Date().toISOString(),
  });
});

export default router;
