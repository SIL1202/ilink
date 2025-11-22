import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function classifyUserIntent(message) {
  const prompt = `
使用者輸入一句話，判斷他想做哪一種功能。

功能包含：
- nlq: 自然語言查詢地點（例如：我要去圖書館、找火車站）
- report: 取得報告或摘要（例如：今日報告、使用統計、分析報告）
- list_facilities: 列出設施或坡道（例如：列出所有坡道、顯示無障礙設施、有哪些地點）
- report_obstacle: 回報障礙物（例如：這裡施工、坡道壞了、有階梯無法通過）
- weather: 天氣相關（例如：今天天氣、會下雨嗎、天氣預報）
- traffic: 路況相關（例如：現在路況、有塞車嗎、施工資訊）
- explain_route: 解釋路線（例如：為什麼這條路可以走、路線說明、這條路安全嗎）
- navigation: 導航相關（例如：開始導航、怎麼走）
- general_question: 一般問題（例如：如何使用、功能說明、幫助）
- other: 其他問題

僅回傳分類代號。
使用者訊息：「${message}」
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0].message.content.trim();
}
