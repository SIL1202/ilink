import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { calculateRoute } from "./routes/route.js";
import { validLonLatPair } from "./utils/geo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "app")));

// 健康檢查
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "花蓮無障礙坡道路線規劃",
    version: "1.0.0",
  });
});

// 坡道資料 API
app.get("/api/ramps", (req, res) => {
  const filePath = path.join(process.cwd(), "data", "ramps.json");
  try {
    const json = fs.readFileSync(filePath, "utf-8");
    const ramps = JSON.parse(json);
    res.json(ramps);
  } catch (err) {
    console.error("讀取 ramps.json 失敗:", err);
    res.status(500).json({ error: "無法讀取坡道資料" });
  }
});

// 路線規劃 API - 新增這個端點！
app.post("/api/route", async (req, res) => {
  try {
    const { start, end } = req.body;
    console.log("📍 收到路線規劃請求:", { start, end });

    if (!validLonLatPair(start) || !validLonLatPair(end)) {
      return res.status(400).json({
        error: "bad_coords",
        hint: "請提供有效的 [經度,緯度] 座標",
      });
    }

    const result = await calculateRoute(start, end);
    console.log("✅ 路線規劃成功，回傳雙路線格式");
    res.json(result);
  } catch (err) {
    console.error("路線規劃錯誤:", err);
    res.status(500).json({
      error: "routing_failed",
      message: "路線規劃服務暫時無法使用",
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 花蓮路線規劃服務啟動: http://localhost:${PORT}`);
});
