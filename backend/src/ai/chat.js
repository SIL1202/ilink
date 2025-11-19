import express from "express";
import { naturalLanguageToPlace } from "./ai.js";
import ramps from "../data/ramps.json" assert { type: "json" };
import { classifyUserIntent } from "./intent.js";

const router = express.Router();

router.post("/chat", async (req, res) => {
  const message = req.body.message;

  const intent = await classifyUserIntent(message);

  if (intent === "nlq") {
    // === 用 message 當 query ===
    const ai = await naturalLanguageToPlace(message, ramps);

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
    });
  }

  // 其他 intent
  return res.json({
    reply: "目前只實作 NLQ，其餘功能開發中。",
  });
});

export default router;import express from "express";
import { naturalLanguageToPlace } from "./ai.js";
import ramps from "../data/ramps.json" assert { type: "json" };
import { classifyUserIntent } from "./intent.js";

const router = express.Router();

router.post("/chat", async (req, res) => {
  const message = req.body.message;

  const intent = await classifyUserIntent(message);

  if (intent === "nlq") {
    // === 用 message 當 query ===
    const ai = await naturalLanguageToPlace(message, ramps);

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
    });
  }

  // 其他 intent
  return res.json({
    reply: "目前只實作 NLQ，其餘功能開發中。",
  });
});

export default router;
