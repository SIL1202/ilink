// backend/src/routes/obstacles.js
import express from "express";
import {
  obstacleService,
  OBSTACLE_TYPES,
  SEVERITY_LEVELS,
} from "../services/obstacle-service.js";

const router = express.Router();

// 回報障礙物
router.post("/report", async (req, res) => {
  try {
    const { type, location, description, severity, reporter } = req.body;

    if (!location || !type) {
      return res.status(400).json({
        error: "missing_params",
        message: "請提供障礙物類型和位置",
      });
    }

    const result = await obstacleService.reportObstacle({
      type,
      location,
      description,
      severity,
      reporter,
    });

    res.json(result);
  } catch (error) {
    console.error("障礙物回報失敗:", error);
    res.status(500).json({
      error: "obstacle_report_failed",
      message: "障礙物回報失敗",
    });
  }
});

// 取得區域障礙物
router.get("/nearby", async (req, res) => {
  try {
    const { lat, lng, radius = 500 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        error: "missing_params",
        message: "請提供位置座標",
      });
    }

    const obstacles = obstacleService.getObstaclesInArea(
      { lat: parseFloat(lat), lng: parseFloat(lng) },
      parseFloat(radius),
    );

    res.json({
      count: obstacles.length,
      obstacles: obstacles,
    });
  } catch (error) {
    console.error("取得附近障礙物失敗:", error);
    res.status(500).json({
      error: "get_obstacles_failed",
      message: "取得障礙物資訊失敗",
    });
  }
});

// 檢查路線障礙物
router.post("/check-route", async (req, res) => {
  try {
    const { routeGeometry, userType } = req.body;

    if (!routeGeometry) {
      return res.status(400).json({
        error: "missing_params",
        message: "請提供路線幾何資料",
      });
    }

    const result = obstacleService.checkRouteForObstacles(
      routeGeometry,
      userType,
    );

    res.json(result);
  } catch (error) {
    console.error("檢查路線障礙物失敗:", error);
    res.status(500).json({
      error: "check_route_failed",
      message: "路線檢查失敗",
    });
  }
});

// 標記障礙物為已解決
router.post("/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;
    const { resolvedBy } = req.body;

    const success = obstacleService.resolveObstacle(id, resolvedBy);

    if (success) {
      res.json({
        success: true,
        message: "障礙物已標記為已解決",
      });
    } else {
      res.status(404).json({
        error: "obstacle_not_found",
        message: "找不到指定的障礙物",
      });
    }
  } catch (error) {
    console.error("解決障礙物失敗:", error);
    res.status(500).json({
      error: "resolve_obstacle_failed",
      message: "標記障礙物失敗",
    });
  }
});

// 取得障礙物類型列表
router.get("/types", (req, res) => {
  res.json({
    types: OBSTACLE_TYPES,
    severity_levels: SEVERITY_LEVELS,
  });
});

export default router;
