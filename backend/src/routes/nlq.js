import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { naturalLanguageToPlace } from "../ai/ai.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rampsPath = path.join(__dirname, "../data/ramps.json");
const ramps = JSON.parse(fs.readFileSync(rampsPath, "utf-8"));

console.log(`已載入坡道資料，共 ${ramps.length} 筆`);


router.post("/nlq", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "missing_query" });

    // throw query and ramps datas to ai
    const ai = await naturalLanguageToPlace(query, ramps);

    // AI should return
    // { index: 3, name: "...", reason: "..." }
    if (ai.index === -1 || ai.index == null) {
      return res.json({
        found: false,
        reason: "資料缺失（AI 無法判斷）",
        ai_reason: ai.reason,
        ai_guess: ai.name || null,
      });
    }

    const matched = ramps[ai.index];

    return res.json({
      found: true,
      place: matched.name,
      lat: matched.lat,
      lon: matched.lon,
      ai_reason: ai.reason,
    });
  } catch (e) {
    console.error("NLQ 查詢錯誤:", e);
    res.status(500).json({ error: "nlq_failed" });
  }
});

export default router; 
