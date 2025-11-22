// backend/src/services/realtime-data-service.js
import axios from "axios";

class RealtimeDataService {
  constructor() {
    // TDX API 設定（交通部運輸資料流通服務）
    this.tdxBaseURL = "https://tdx.transportdata.tw/api/basic/v2";
    this.tdxAuth = null;

    // 中央氣象局 API
    this.weatherBaseURL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";
    this.weatherAPIKey = process.env.CWA_API_KEY || "您的氣象局API金鑰";

    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5分鐘快取
  }

  // 取得 TDX API 存取權杖
  async getTdxAccessToken() {
    if (this.tdxAuth && this.tdxAuth.expires > Date.now()) {
      return this.tdxAuth.access_token;
    }

    try {
      const response = await axios.post(
        "https://tdx.transportdata.tw/auth/realms/TDX/protocol/openid-connect/token",
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: process.env.TDX_CLIENT_ID || "您的TDX用戶ID",
          client_secret: process.env.TDX_CLIENT_SECRET || "您的TDX用戶密鑰",
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      this.tdxAuth = {
        access_token: response.data.access_token,
        expires: Date.now() + response.data.expires_in * 1000,
      };

      return this.tdxAuth.access_token;
    } catch (error) {
      console.error("TDX 權杖取得失敗:", error);
      return null;
    }
  }

  // 取得即時天氣資料
  async getWeatherData(lat, lon) {
    const cacheKey = `weather_${lat}_${lon}`;
    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // 取得位置所在縣市
      const locationInfo = await this.getLocationInfo(lat, lon);
      const city = locationInfo.city || "花蓮縣";

      // 取得天氣預報
      const forecast = await this.getWeatherForecast(city);

      // 取得即時觀測
      const observation = await this.getWeatherObservation(lat, lon);

      const weatherData = {
        location: city,
        temperature: observation.temperature || forecast.temperature,
        condition: this.mapWeatherCondition(
          observation.weather || forecast.weather,
        ),
        precipitation: observation.precipitation || forecast.precipitation,
        humidity: observation.humidity,
        windSpeed: observation.windSpeed,
        updateTime: new Date(),
        alerts: await this.getWeatherAlerts(city),
      };

      this.cache.set(cacheKey, weatherData);
      return weatherData;
    } catch (error) {
      console.error("天氣資料取得失敗:", error);
      return this.getFallbackWeather(lat, lon);
    }
  }

  // 取得天氣預報
  async getWeatherForecast(city) {
    const cityMapping = {
      花蓮縣: "F-D0047-011",
      台北市: "F-D0047-061",
      台中市: "F-D0047-075",
      高雄市: "F-D0047-067",
    };

    const datasetId = cityMapping[city] || "F-D0047-011";

    const response = await axios.get(`${this.weatherBaseURL}/${datasetId}`, {
      params: {
        Authorization: this.weatherAPIKey,
        format: "JSON",
      },
    });

    // 解析氣象局回傳資料
    return this.parseWeatherData(response.data);
  }

  // 取得即時天氣觀測
  async getWeatherObservation(lat, lon) {
    try {
      // 找最近的气象站
      const stationsResponse = await axios.get(
        `${this.weatherBaseURL}/O-A0001-001`,
        {
          params: {
            Authorization: this.weatherAPIKey,
            format: "JSON",
          },
        },
      );

      const nearestStation = this.findNearestStation(
        lat,
        lon,
        stationsResponse.data.records.Station,
      );

      return {
        temperature: nearestStation.Temperature,
        humidity: nearestStation.Humidity,
        weather: nearestStation.Weather,
        precipitation: nearestStation.Precipitation,
        windSpeed: nearestStation.WindSpeed,
      };
    } catch (error) {
      console.error("即時觀測取得失敗:", error);
      return {};
    }
  }

  // 取得即時路況資料
  async getTrafficData(lat, lon, radius = 2000) {
    const cacheKey = `traffic_${lat}_${lon}_${radius}`;
    if (this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const token = await this.getTdxAccessToken();
      if (!token) {
        throw new Error("無法取得TDX存取權杖");
      }

      // 取得即時交通事件
      const events = await this.getTrafficEvents(lat, lon, radius, token);

      // 取得道路壅塞情況
      const congestion = await this.getRoadCongestion(lat, lon, radius, token);

      // 取得施工資訊
      const construction = await this.getConstructionInfo(
        lat,
        lon,
        radius,
        token,
      );

      const trafficData = {
        events: events,
        congestion: congestion,
        construction: construction,
        summary: this.generateTrafficSummary(events, congestion, construction),
        updateTime: new Date(),
      };

      this.cache.set(cacheKey, trafficData);
      return trafficData;
    } catch (error) {
      console.error("路況資料取得失敗:", error);
      return this.getFallbackTraffic();
    }
  }

  // 取得交通事件
  async getTrafficEvents(lat, lon, radius, token) {
    const response = await axios.get(
      `${this.tdxBaseURL}/Road/Traffic/Live/Map`,
      {
        params: {
          $spatialFilter: `nearby(${lat}, ${lon}, ${radius})`,
          $format: "JSON",
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return response.data.map((event) => ({
      type: event.IncidentType,
      description: event.IncidentDescription,
      severity: event.Severity,
      location: {
        lat: event.Latitude,
        lng: event.Longitude,
      },
      startTime: event.StartTime,
      endTime: event.EndTime,
    }));
  }

  // 取得道路壅塞情況
  async getRoadCongestion(lat, lon, radius, token) {
    const response = await axios.get(
      `${this.tdxBaseURL}/Road/Traffic/Live/Congestion`,
      {
        params: {
          $spatialFilter: `nearby(${lat}, ${lon}, ${radius})`,
          $format: "JSON",
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return response.data.map((road) => ({
      roadName: road.RoadName,
      congestionLevel: road.CongestionLevel,
      speed: road.AverageSpeed,
      direction: road.Direction,
    }));
  }

  // 取得施工資訊
  async getConstructionInfo(lat, lon, radius, token) {
    const response = await axios.get(
      `${this.tdxBaseURL}/Road/Traffic/Live/Construction`,
      {
        params: {
          $spatialFilter: `nearby(${lat}, ${lon}, ${radius})`,
          $format: "JSON",
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    return response.data.map((construction) => ({
      type: "construction",
      description: construction.WorkContent,
      location: {
        lat: construction.Latitude,
        lng: construction.Longitude,
      },
      startDate: construction.StartDate,
      endDate: construction.EndDate,
      impact: construction.ImpactLevel,
    }));
  }

  // 取得天氣警報
  async getWeatherAlerts(city) {
    try {
      const response = await axios.get(`${this.weatherBaseURL}/W-C0033-001`, {
        params: {
          Authorization: this.weatherAPIKey,
          format: "JSON",
        },
      });

      return response.data.records.Location.filter(
        (loc) => loc.LocationName === city,
      ).flatMap((loc) => loc.WeatherElement);
    } catch (error) {
      console.error("天氣警報取得失敗:", error);
      return [];
    }
  }

  // 取得綜合即時資料（路線規劃用）
  async getRealtimeContext(routeGeometry, userContext) {
    const routeCenter = this.calculateRouteCenter(routeGeometry);

    const [weather, traffic] = await Promise.all([
      this.getWeatherData(routeCenter.lat, routeCenter.lng),
      this.getTrafficData(routeCenter.lat, routeCenter.lng),
    ]);

    return {
      weather,
      traffic,
      routeImpact: this.assessRouteImpact(routeGeometry, weather, traffic),
      suggestions: this.generateRealtimeSuggestions(
        weather,
        traffic,
        userContext,
      ),
      timestamp: new Date(),
    };
  }

  // 評估路線影響
  assessRouteImpact(routeGeometry, weather, traffic) {
    const impacts = [];

    // 天氣影響
    if (weather.condition === "heavy_rain") {
      impacts.push({
        type: "weather",
        severity: "high",
        message: "大雨可能影響輪椅通行",
        suggestion: "建議選擇有遮蔭的路線",
      });
    }

    if (weather.temperature > 32) {
      impacts.push({
        type: "temperature",
        severity: "medium",
        message: "高溫天氣，建議補充水分",
        suggestion: "選擇有休息點的路線",
      });
    }

    // 交通影響
    traffic.events.forEach((event) => {
      if (this.isEventOnRoute(event, routeGeometry)) {
        impacts.push({
          type: "traffic",
          severity: event.severity,
          message: `交通事件：${event.description}`,
          suggestion: "建議改道行駛",
        });
      }
    });

    traffic.construction.forEach((construction) => {
      if (this.isEventOnRoute(construction, routeGeometry)) {
        impacts.push({
          type: "construction",
          severity: "high",
          message: `施工：${construction.description}`,
          suggestion: "已自動避開施工路段",
        });
      }
    });

    return impacts;
  }

  // 生成即時建議
  generateRealtimeSuggestions(weather, traffic, userContext) {
    const suggestions = [];

    if (weather.condition === "heavy_rain") {
      suggestions.push("雨天路滑，建議減速慢行");
    }

    if (traffic.congestion.some((road) => road.congestionLevel === 4)) {
      suggestions.push("部分路段壅塞，已為您選擇替代路線");
    }

    if (userContext.userType === "wheelchair" && weather.condition === "rain") {
      suggestions.push("雨天坡道濕滑，請小心通行");
    }

    return suggestions;
  }

  // 工具函式
  findNearestStation(targetLat, targetLng, stations) {
    let nearest = stations[0];
    let minDistance = Infinity;

    stations.forEach((station) => {
      const distance = this.calculateDistance(
        targetLat,
        targetLng,
        station.Latitude,
        station.Longitude,
      );
      if (distance < minDistance) {
        minDistance = distance;
        nearest = station;
      }
    });

    return nearest;
  }

  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  calculateRouteCenter(routeGeometry) {
    const lats = routeGeometry.map((coord) => coord[1]);
    const lngs = routeGeometry.map((coord) => coord[0]);

    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }

  isEventOnRoute(event, routeGeometry) {
    // 簡化實現：檢查事件是否在路線附近
    for (const point of routeGeometry) {
      const distance = this.calculateDistance(
        point[1],
        point[0],
        event.location.lat,
        event.location.lng,
      );
      if (distance < 100) {
        // 100公尺內視為在路線上
        return true;
      }
    }
    return false;
  }

  mapWeatherCondition(weatherCode) {
    const conditionMap = {
      "01": "sunny",
      "02": "partly_cloudy",
      "03": "cloudy",
      "04": "cloudy",
      "05": "rain",
      "06": "rain",
      "07": "rain",
      "08": "heavy_rain",
      "09": "thunderstorm",
      10: "fog",
      11: "fog",
    };
    return conditionMap[weatherCode] || "unknown";
  }

  isCacheValid(key) {
    const cached = this.cache.get(key);
    return cached && Date.now() - cached.updateTime < this.cacheTTL;
  }

  // 降級方案
  getFallbackWeather(lat, lon) {
    return {
      location: "花蓮縣",
      temperature: 20,
      condition: "partly_cloudy",
      precipitation: 0,
      humidity: 75,
      windSpeed: 2,
      updateTime: new Date(),
      alerts: [],
      isFallback: true,
    };
  }

  getFallbackTraffic() {
    return {
      events: [],
      congestion: [],
      construction: [],
      summary: "路況資訊暫時無法取得",
      updateTime: new Date(),
      isFallback: true,
    };
  }

  parseWeatherData(weatherData) {
    // 簡化解析，實際需要根據氣象局格式調整
    try {
      const records = weatherData.records;
      const location = records.locations[0].location[0];

      return {
        temperature: location.weatherElement.find((e) => e.elementName === "T")
          .time[0].elementValue.value,
        weather: location.weatherElement.find((e) => e.elementName === "Wx")
          .time[0].elementValue[0].value,
        precipitation: location.weatherElement.find(
          (e) => e.elementName === "PoP",
        ).time[0].elementValue.value,
      };
    } catch (error) {
      console.error("天氣資料解析失敗:", error);
      return {
        temperature: 25,
        weather: "01",
        precipitation: 0,
      };
    }
  }

  getLocationInfo(lat, lon) {
    // 簡化實現，實際應該使用逆地理編碼
    return {
      city: "花蓮縣",
      district: "花蓮市",
    };
  }
}

// 單例模式
export const realtimeDataService = new RealtimeDataService();
