import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// 導入路由處理器
import { calculateHybridRoute } from "./routes/hybrid-route.js";
import { validLonLatPair } from "./utils/geo.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "app")));

// 健康檢查
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "花蓮無障礙路線規劃",
    version: "1.0.0",
    available_routes: ["/api/route", "/api/real-route", "/api/hybrid-route"],
  });
});

// 混合路線（推薦）
app.post("/api/hybrid-route", async (req, res) => {
  try {
    const { start, end, params = {} } = req.body;

    if (!validLonLatPair(start) || !validLonLatPair(end)) {
      return res.status(400).json({ error: "bad_coords" });
    }

    const result = await calculateHybridRoute(start, end, {
      maximum_incline: params.maximum_incline ?? 0.08,
      minimum_width: params.minimum_width ?? 0.9,
    });

    res.json(result);
  } catch (err) {
    console.error("Hybrid routing error:", err);
    res
      .status(500)
      .json({ error: "hybrid_routing_failed", message: err.message });
  }
});

// 無障礙設施
app.get("/api/accessible-facilities", (req, res) => {
  res.json({
    ramps: [
      {
        coordinates: [121.605, 23.976],
        type: "ramp",
        description: "無障礙斜坡",
      },
    ],
    elevators: [
      {
        coordinates: [121.607, 23.978],
        type: "elevator",
        description: "公共電梯",
      },
    ],
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 伺服器啟動: http://localhost:${port}`);
  console.log(`🗺️  可用路線: /api/route, /api/real-route, /api/hybrid-route`);
});
