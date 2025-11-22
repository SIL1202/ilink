// backend/src/services/route-context-service.js
class RouteContextService {
  constructor() {
    this.userRoutes = new Map(); // userId -> currentRoute
  }

  // 儲存使用者當前路線
  setUserRoute(userId, routeData) {
    this.userRoutes.set(userId, {
      route: routeData,
      timestamp: new Date(),
      expires: Date.now() + 30 * 60 * 1000, // 30分鐘過期
    });
    console.log(`🗺️ 使用者 ${userId} 的路線已儲存`);
  }

  // 取得使用者當前路線
  getCurrentRoute(userId) {
    const context = this.userRoutes.get(userId);

    if (!context) {
      console.log(`❌ 使用者 ${userId} 沒有儲存的路線`);
      return null;
    }

    // 檢查是否過期
    if (Date.now() > context.expires) {
      this.userRoutes.delete(userId);
      console.log(`⏰ 使用者 ${userId} 的路線已過期`);
      return null;
    }

    console.log(`✅ 取得使用者 ${userId} 的當前路線`);
    return context.route;
  }

  // 清除過期路線
  cleanupExpiredRoutes() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [userId, context] of this.userRoutes.entries()) {
      if (now > context.expires) {
        this.userRoutes.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 已清理 ${cleanedCount} 個過期路線`);
    }
  }
}

// 單例模式
export const routeContextService = new RouteContextService();

// 定期清理（每小時一次）
setInterval(
  () => {
    routeContextService.cleanupExpiredRoutes();
  },
  60 * 60 * 1000,
);
