import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function classifyUserIntent(message) {
  const prompt = `
使用者輸入一句話，判斷他想做哪一種功能。

功能包含：
- nlq: 自然語言查詢地點
- route: 問路、找路線
- summary: 要求總結、報表
- guide: 要互動式指導
- advice: 無障礙適應建議

僅回傳分類代號。
使用者訊息：「${message}」
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0].message.content.trim();
}
