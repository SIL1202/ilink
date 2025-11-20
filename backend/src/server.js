import express from "express";
import cors from "cors";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { calculateRoute } from "./routes/route.js";
import { validLonLatPair } from "./utils/geo.js";
import chatRouter from "./ai/chat.js";
import navigationRouter from "./routes/navigation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", chatRouter);
app.use("/api", navigationRouter);

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "花蓮無障礙坡道路線規劃",
    version: "1.0.0",
    features: ["路線規劃", "AI聊天", "即時導航"],
  });
});

// 坡道資料 API
app.get("/api/ramps", (req, res) => {
  const filePath = path.join(__dirname, "data", "ramps.json");
  try {
    const json = fs.readFileSync(filePath, "utf-8");
    const ramps = JSON.parse(json);
    res.json(ramps);
  } catch (err) {
    console.error("讀取 ramps.json 失敗:", err);
    res.status(500).json({ error: "無法讀取坡道資料" });
  }
});

app.post("/api/route", async (req, res) => {
  try {
    const { start, end, mode, ramp } = req.body;
    console.log("收到路線規劃請求:", { start, end, mode, ramp });
    console.log("後端接收的 ramp 參數:", {
      type: typeof ramp,
      isNull: ramp === null,
      isUndefined: ramp === undefined,
      value: ramp,
    });

    if (!validLonLatPair(start) || !validLonLatPair(end)) {
      return res.status(400).json({
        error: "bad_coords",
        hint: "請提供有效的 [經度,緯度] 座標",
      });
    }

    // 把 mode 和 ramp 都丟進去
    const result = await calculateRoute(start, end, mode, ramp);
    console.log("路線規劃成功，回傳雙路線格式");
    res.json(result);
  } catch (err) {
    console.error("路線規劃錯誤:", err);
    res.status(500).json({
      error: "routing_failed",
      message: "路線規劃服務暫時無法使用",
    });
  }
});

const port = process.env.PORT || PORT;
app.listen(port, "0.0.0.0", () => {
  console.log(`server running ${port}`);
});
