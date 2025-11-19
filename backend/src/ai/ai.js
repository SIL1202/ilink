// This file is for specific function
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function askLLM(prompt) {
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  return res.choices[0].message.content;
}

export async function naturalLanguageToPlace(query, ramps) {
  const rampList = ramps.map((r, i) => `${i}: ${r.name}`).join("\n");

  const prompt = `
使用者輸入一句自然語言描述地點，例如「我要去圖書館旁邊的坡道」。
請從下面的坡道清單中，選出**語意最接近**的一個地點。

你只能從列表中挑選，不能自己編造不存在的地點。

坡道清單：
${rampList}

請回傳 JSON，格式如下：
{
  "index": number,   // 在清單中的 index，若找不到請傳 -1
  "name": string,    // 坡道名稱
  "reason": string   // 為什麼選這個
}

使用者輸入：
"${query}"
`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  // Safe parsing
  let result;
  try {
    result = JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    return {
      index: -1,
      name: "",
      reason: "Invalid AI JSON response",
    };
  }

  // Defensive fallback
  if (
    typeof result.index !== "number" ||
    result.index < -1 ||
    result.index >= ramps.length
  ) {
    return {
      index: -1,
      name: "",
      reason: "AI returned invalid index",
    };
  }

  return result;
}
