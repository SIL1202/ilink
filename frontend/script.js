// 全域變數
let map;
let normalRouteLayer = null; // 一般路線圖層
let accessibleRouteLayer = null; // 無障礙路線圖層
let startMarker = null;
let endMarker = null;
let rampMarkers = [];
let markersLayer = L.layerGroup();
let clickCount = 0;
let currentRouteType = "accessible"; // 預設顯示無障礙路線

let ramps = [];
// 在全域變數區域添加
let highlightedRamps = []; // 儲存高亮的坡道標記

// 初始化地圖
function initMap() {
  map = L.map("map").setView([23.898068, 121.541587], 14);

  L.tileLayer(
    "https://wmts.nlsc.gov.tw/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
      "&LAYER=EMAP&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible" +
      "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png",
    { attribution: "© 國土測繪中心", maxZoom: 19 },
  ).addTo(map);

  markersLayer.addTo(map);

  map.zoomControl.setPosition("topright");

  loadRamps();
}

async function loadRamps() {
  try {
    const res = await fetch("http://localhost:3000/api/ramps");
    if (!res.ok) throw new Error("HTTP FAIL " + res.status);

    const rampData = await res.json();

    ramps = rampData;

    console.log("載入坡道資料成功:", ramps.length, "個坡道");

    displayRampsOnMap(ramps);
  } catch (err) {
    console.error("載入坡道資料失敗:", err);
  }
}

async function drawRoute() {
  const routeInfo = document.getElementById("routeInfo");
  const routeDetails = document.getElementById("routeDetails");

  routeInfo.style.display = "block";
  routeDetails.innerHTML =
    '<div style="text-align: center;">規劃路線中...</div>';

  let startValue = document.getElementById("start").value;
  let endValue = document.getElementById("end").value;

  console.log("📍 規劃路線從:", startValue, "到:", endValue);

  try {
    const [slon, slat] = startValue.split(",").map(Number);
    let [elon, elat] = endValue.split(",").map(Number);

    const routeData = await resonse.json();
    console.log("後端回傳路線資料:", routeData);

    window.currentRoute = routeData;

    if (isNaN(slon) || isNaN(slat) || isNaN(elon) || isNaN(elat)) {
      throw new Error("無效的座標格式，請使用 經度,緯度 格式");
    }

    let mode = "normal"; // 預設為一般模式
    let rampPoint = null;
    let originalEnd = [elon, elat]; // 保存原始終點
    let accessibleEnd = [elon, elat]; // 無障礙路線終點

    // 檢查坡道資料是否已載入
    if (ramps.length === 0) {
      console.warn("⚠️ 坡道資料尚未載入，重新載入...");
      await loadRamps();
    }

    // 自動判斷目的地附近是否有人工坡道
    const { ramp, distance } = findNearestRamp(elat, elon);

    console.log(`📍 最近坡道距離: ${distance.toFixed(1)} 公尺`);

    if (ramp && distance < 100) {
      console.log("♿ 終點附近有坡道 → 啟動無障礙路線模式");

      accessibleEnd = [ramp.lon, ramp.lat];

      rampPoint = {
        lon: ramp.lon,
        lat: ramp.lat,
        name: ramp.name,
        original_end: originalEnd, // 保存原始終點用於顯示
      };

      console.log("➡️ 無障礙入口：", rampPoint);
      console.log("🎯 無障礙路線終點已重新導向至坡道位置");
      console.log("🚶 一般路線保持原終點位置");
    } else {
      console.log("🚶‍♂️ 終點沒有坡道 → 使用一般導航模式");
      mode = "normal";
      rampPoint = null;
    }

    // ✅ 修正：傳送不同的終點給後端
    const body = {
      start: [slon, slat],
      end: [elon, elat], // 一般路線使用原終點
      accessible_end: accessibleEnd, // 無障礙路線使用坡道終點
      mode: mode,
      ramp: rampPoint,
      original_end: originalEnd, // 傳送原始終點給後端
    };

    console.log("📤 傳送到後端:", body);

    const response = await fetch("http://localhost:3000/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const routeData = await response.json();
    console.log("✅ 後端回傳路線資料:", routeData);

    // 收集分析數據
    await collectRouteAnalytics(routeData, {
      start: [slon, slat],
      end: [elon, elat],
      routeType: mode,
      userType: "wheelchair", // 可從使用者設定取得
    });

    // 清除舊路線
    clearRouteLayers();

    // 繪製路線
    drawRoutesOnMap(routeData);

    // 顯示路線資訊
    displayRouteInfo(routeData, originalEnd, rampPoint);
  } catch (e) {
    console.error("❌ 路線規劃失敗:", e);
    routeDetails.innerHTML = `
      <div style="color: #dc3545; text-align: center;">
        路線規劃失敗<br>
        <small>${e.message}</small>
      </div>
    `;
  }
}

// 解釋當前路線
async function explainCurrentRoute() {
  if (!window.currentRoute) {
    addMessage("請先規劃一條路線，我可以為您分析無障礙特性。", false);
    return;
  }

  const typingIndicator = addTypingIndicator();

  try {
    const res = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "解釋這條路線為什麼適合輪椅通行",
        userContext: {
          userType: "wheelchair",
          currentRoute: window.currentRoute,
        },
      }),
    });

    const data = await res.json();
    removeTypingIndicator(typingIndicator);

    if (data.type === "explain_route") {
      addMessage(data.reply, false);

      // 顯示詳細分析（可選）
      if (data.analysis) {
        showRouteAnalysisDetails(data.analysis);
      }
    }
  } catch (error) {
    removeTypingIndicator(typingIndicator);
    console.error("路線解釋失敗:", error);
    addMessage("抱歉，無法分析路線。請稍後再試。", false);
  }
}

// 顯示詳細路線分析
function showRouteAnalysisDetails(analysis) {
  const details = `
<div class="route-analysis-details">
  <h4>路線詳細分析</h4>
  <div class="suitability ${analysis.suitability}">
    適合度: ${getSuitabilityText(analysis.suitability)}
  </div>
  
  ${
    analysis.features.length > 0
      ? `
  <div class="features">
    <strong>優點：</strong>
    <ul>
      ${analysis.features.map((f) => `<li>${f.description}</li>`).join("")}
    </ul>
  </div>
  `
      : ""
  }
  
  ${
    analysis.barriers.length > 0
      ? `
  <div class="barriers">
    <strong>注意：</strong>
    <ul>
      ${analysis.barriers.map((b) => `<li>${b.description} - ${b.suggestion}</li>`).join("")}
    </ul>
  </div>
  `
      : ""
  }
  
  <div class="suggestions">
    <strong>建議：</strong>
    ${analysis.suggestions.map((s) => `<span class="suggestion-tag">${s}</span>`).join("")}
  </div>
</div>
  `;

  const detailsElement = document.createElement("div");
  detailsElement.innerHTML = details;
  chatMessages.appendChild(detailsElement);
  scrollToBottom();
}

function getSuitabilityText(suitability) {
  const textMap = {
    good: "良好",
    fair: "普通",
    poor: "不佳",
  };
  return textMap[suitability] || suitability;
}

// 收集路線分析數據
async function collectRouteAnalytics(routeData, userContext) {
  try {
    const response = await fetch("http://localhost:3000/api/analytics/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeData: routeData,
        userContext: userContext,
      }),
    });

    if (response.ok) {
      console.log("✅ 路線數據記錄成功");
    }
  } catch (error) {
    console.warn("⚠️ 路線數據記錄失敗:", error);
  }
}

function displayRampsOnMap(ramps) {
  // 清除舊的坡道標記
  rampMarkers.forEach((marker) => map.removeLayer(marker));
  rampMarkers = [];

  ramps.forEach((ramp) => {
    const marker = L.marker([ramp.lat, ramp.lon], {
      icon: L.divIcon({
        className: "ramp-marker",
        html: "♿",
        iconSize: [20, 20],
      }),
    }).addTo(map).bindPopup(`
      <div style="min-width: 200px;">
        <strong>${ramp.name}</strong><br>
        <small>${ramp.campus || ""}</small><br>
        <em>${ramp.description || "無障礙坡道"}</em>
      </div>
    `);

    rampMarkers.push(marker);
  });
}

// 在地圖上繪製路線 - 支援新舊兩種格式
function drawRoutesOnMap(routeData) {
  console.log("🔄 繪製路線資料:", routeData);

  const layers = []; // 儲存所有圖層用於計算邊界

  // 檢查是新格式還是舊格式
  const isNewFormat = routeData.normal !== undefined;

  if (isNewFormat) {
    console.log("📝 檢測到新格式（雙路線）");

    // 繪製一般路線（黃色）- 到原終點
    if (
      routeData.normal &&
      routeData.normal.features &&
      routeData.normal.features.length > 0
    ) {
      normalRouteLayer = L.geoJSON(routeData.normal, {
        style: {
          color: "#ffc107", // 黃色
          weight: 5,
          opacity: 0.7,
          dashArray: "5, 5", // 虛線表示一般路線
        },
        onEachFeature: function (feature, layer) {
          const props = feature.properties;
          const destination = routeData.metadata?.normal_destination;
          const popupContent = `
            <div style="min-width: 200px;">
              <strong>🚶 一般路線</strong><br>
              距離: ${props.summary.distance.toFixed(0)} 公尺<br>
              時間: ${props.summary.duration} 分鐘<br>
              <small>最短路徑到原始目的地</small>
              ${destination ? `<br><small>目的地: [${destination[0].toFixed(6)}, ${destination[1].toFixed(6)}]</small>` : ""}
            </div>
          `;
          layer.bindPopup(popupContent);
        },
      }).addTo(map);
      layers.push(normalRouteLayer);
      console.log("✅ 一般路線繪製完成（到原終點）");
    }

    // 繪製無障礙路線（綠色）- 到坡道位置
    if (
      routeData.accessible &&
      routeData.accessible.features &&
      routeData.accessible.features.length > 0
    ) {
      accessibleRouteLayer = L.geoJSON(routeData.accessible, {
        style: {
          color: "#28a745", // 綠色
          weight: 6,
          opacity: 0.8,
        },
        onEachFeature: function (feature, layer) {
          const props = feature.properties;
          const accessibility = props.accessibility;
          const destination = routeData.metadata?.accessible_destination;
          const popupContent = `
            <div style="min-width: 220px;">
              <strong>無障礙路線</strong><br>
              距離: ${props.summary.distance.toFixed(0)} 公尺<br>
              時間: ${props.summary.duration} 分鐘<br>
              ${accessibility?.ramp_used ? `坡道: ${accessibility.ramp_used}<br>` : ""}
              <small>${accessibility?.suitable_for_wheelchair ? "適合輪椅" : "可能有障礙"}</small>
              ${destination ? `<br><small>無障礙入口: [${destination[0].toFixed(6)}, ${destination[1].toFixed(6)}]</small>` : ""}
            </div>
          `;
          layer.bindPopup(popupContent);
        },
      }).addTo(map);
      layers.push(accessibleRouteLayer);
      console.log("✅ 無障礙路線繪製完成（到坡道位置）");
    }
  } else {
    // 舊格式處理（單一路線）
    console.log("📝 檢測到舊格式（單一路線）");

    if (routeData.features && routeData.features.length > 0) {
      // 繪製單一路線（藍色）
      normalRouteLayer = L.geoJSON(routeData, {
        style: {
          color: "#007aff", // 藍色
          weight: 6,
          opacity: 0.8,
        },
        onEachFeature: function (feature, layer) {
          const props = feature.properties;
          if (props.summary) {
            const popupContent = `
              <div style="min-width: 200px;">
                <strong>規劃路線</strong><br>
                距離: ${props.summary.distance.toFixed(0)} 公尺<br>
                時間: ${props.summary.duration} 分鐘<br>
                <small>單一路線模式</small>
              </div>
            `;
            layer.bindPopup(popupContent);
          }
        },
      }).addTo(map);
      layers.push(normalRouteLayer);
      console.log("✅ 單一路線繪製完成");
    }
  }

  // 自動縮放到路線範圍
  if (layers.length > 0) {
    try {
      const group = L.featureGroup(layers);
      const bounds = group.getBounds();

      // 在第 280 行附近修改
      if (bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 16,
        });
        console.log("✅ 地圖縮放到路線範圍");
      } else {
        console.warn("⚠️ 無效的邊界，使用預設視圖");
        // 移除有問題的 showNavigationButton 呼叫
        // showNavigationButton(routeData); // 這行會導致錯誤

        // 改用安全的方式設定視圖
        const startCoords = document
          .getElementById("start")
          .value.split(",")
          .map(Number);
        const endCoords = document
          .getElementById("end")
          .value.split(",")
          .map(Number);

        const safeBounds = L.latLngBounds([
          [startCoords[1], startCoords[0]],
          [endCoords[1], endCoords[0]],
        ]);

        if (safeBounds.isValid()) {
          map.fitBounds(safeBounds, { padding: [50, 50] });
        }
      }
    } catch (error) {
      console.error("❌ 縮放地圖時發生錯誤:", error);
      map.setView([23.898068, 121.541587], 14);
    }
  } else {
    console.warn("⚠️ 沒有有效的路線圖層可縮放");
  }
}

// ==================== Chat 功能完整實作（終極版）====================
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");

// 自動滾到最底
function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 加入訊息到聊天視窗
function addMessage(text, isUser = false) {
  const div = document.createElement("div");
  div.style.margin = "8px 0";
  div.style.padding = "10px 12px";
  div.style.borderRadius = "12px";
  div.style.maxWidth = "80%";
  div.style.wordWrap = "break-word";

  if (isUser) {
    div.style.background = "#4a90e2";
    div.style.color = "white";
    div.style.alignSelf = "flex-end";
    div.style.marginLeft = "auto";
  } else {
    div.style.background = "#e9ecef";
    div.style.color = "#333";
  }

  div.textContent = text;
  chatMessages.appendChild(div);
  scrollToBottom();
}

async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  addMessage(message, true);
  chatInput.value = "";

  const typingIndicator = addTypingIndicator();

  try {
    let userLocation = null;
    if (navigator.geolocation) {
      userLocation = await getCurrentLocation();
    }

    const res = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        userLocation: userLocation,
      }),
    });

    const data = await res.json();
    console.log("AI 回傳:", data);

    removeTypingIndicator(typingIndicator);

    // 根據不同回應類型處理
    switch (data.type) {
      case "daily_report":
      case "report":
        // 處理報告類型的回應
        handleReportResponse(data);
        break;

      case "list_facilities":
        // 處理列出設施的回應
        handleListFacilitiesResponse(data);
        break;

      case "general_question":
        // 處理一般問題回應
        handleGeneralResponse(data);
        break;

      case "general":
        // 處理一般問題回應
        handleGeneralResponse(data);
        break;

      case "navigation":
        // 處理導航相關回應
        handleNavigationResponse(data);
        break;

      default:
        // 預設處理（保持向後兼容）
        handleDefaultResponse(data);
    }
  } catch (err) {
    removeTypingIndicator(typingIndicator);
    console.error("Chat 錯誤:", err);
    addMessage("⚠️ 連線失敗，請檢查網路", false);
  }
}

// 取得使用者位置
function getCurrentLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        resolve(null); // 使用者拒絕或錯誤
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 300000, // 5分鐘快取
      },
    );
  });
}

// 處理報告回應
function handleReportResponse(data) {
  // 顯示主要報告訊息
  addMessage(data.reply, false);

  // 如果有詳細統計數據，顯示在第二條訊息
  if (data.data && data.data.statistics) {
    const stats = data.data.statistics;
    const details = `
詳細統計：
• 規劃次數: ${stats.totalRoutes || 0} 次
• 無障礙使用率: ${stats.accessibleUsageRate || 0}%
• 平均距離: ${stats.avgDistance || 0} 公尺
• 熱門時段: ${stats.peakHours ? stats.peakHours.join(", ") : "無數據"}
    `.trim();

    addMessage(details, false);
  }

  // 顯示建議按鈕
  if (data.suggestions && data.suggestions.length > 0) {
    showChatSuggestions(data.suggestions);
  }
}

// 處理一般問題回應
function handleGeneralResponse(data) {
  addMessage(data.reply, false);

  // 顯示建議按鈕
  if (data.suggestions && data.suggestions.length > 0) {
    showChatSuggestions(data.suggestions);
  }
}

// 處理導航回應
function handleNavigationResponse(data) {
  addMessage(data.reply, false);

  if (data.suggestions && data.suggestions.length > 0) {
    showChatSuggestions(data.suggestions);
  }
}

// 清除坡道高亮標記
function clearRampHighlights() {
  highlightedRamps.forEach((marker) => {
    if (marker && map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });
  highlightedRamps = [];
  console.log("✅ 已清除坡道高亮標記");
}

// 完整的 handleListFacilitiesResponse 函式
function handleListFacilitiesResponse(data) {
  addMessage(data.reply, false);

  // 清除舊的高亮，然後顯示新的
  clearRampHighlights();

  // 如果有坡道數據，在地圖上高亮顯示
  if (data.data && data.data.ramps) {
    highlightAllRampsOnMap(data.data.ramps);
  }

  if (data.suggestions && data.suggestions.length > 0) {
    showChatSuggestions(data.suggestions);
  }
}

// 在地圖上高亮顯示所有坡道
function highlightAllRampsOnMap(ramps) {
  console.log(`🗺️ 在地圖上高亮顯示 ${ramps.length} 個坡道`);

  ramps.forEach((ramp, index) => {
    // 創建高亮標記（使用醒目的顏色）
    const marker = L.marker([ramp.lat, ramp.lon], {
      icon: L.divIcon({
        className: "ramp-highlight-marker",
        html: `
          <div style="
            font-size: 24px; 
            color: #ff6b6b; 
            text-shadow: 0 0 8px white, 0 0 8px white;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 3px solid #ff6b6b;
          ">♿</div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
      }),
    })
      .addTo(map)
      .bindPopup(
        `
        <div style="min-width: 200px;">
          <strong>${ramp.name}</strong><br>
          <small>座標: [${ramp.lon.toFixed(6)}, ${ramp.lat.toFixed(6)}]</small><br>
          <button onclick="planToRamp(${ramp.lon}, ${ramp.lat}, '${ramp.name}')" 
                  style="margin-top: 8px; padding: 5px 10px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">
            規劃到這裡
          </button>
        </div>
      `,
      )
      .openPopup(); // 自動打開第一個彈出窗

    highlightedRamps.push(marker);
  });

  // 自動縮放到顯示所有坡道
  if (ramps.length > 0) {
    const group = L.featureGroup(highlightedRamps);
    const bounds = group.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 15,
      });
    }

    console.log("✅ 地圖已縮放到顯示所有坡道");
  }
}

// 規劃到指定坡道的函式
function planToRamp(lon, lat, name) {
  // 設定為終點
  document.getElementById("end").value = `${lon},${lat}`;

  // 顯示提示
  addMessage(`已設定「${name}」為目的地，點擊「規劃路線」開始規劃！`, false);

  // 自動規劃路線（可選）
  // drawRoute();

  console.log(`🎯 設定目的地: ${name} [${lon}, ${lat}]`);
}

// 也可以在清除所有時清除坡道高亮
function clearAll() {
  // 清除路線
  clearRouteLayers();

  // 清除標記（保留坡道標記）
  markersLayer.clearLayers();
  startMarker = null;
  endMarker = null;

  // 清除坡道高亮
  clearRampHighlights();

  // 清除顯示
  document.getElementById("routeInfo").style.display = "none";
  clickCount = 0;

  console.log("🧹 已清除所有標記和高亮");
}

// 處理預設回應（保持向後兼容）
function handleDefaultResponse(data) {
  if (data.found && data.lat && data.lon) {
    // 地點查詢成功的處理
    const lat = parseFloat(data.lat);
    const lon = parseFloat(data.lon);

    map.setView([lat, lon], 18);

    // 清除舊的終點標記
    if (endMarker) map.removeLayer(endMarker);

    // 加一個超顯眼的藍色大 ♿
    endMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        className: "chat-target-marker",
        html: `<div style="font-size: 40px; text-shadow: 0 0 10px white;">♿</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
      }),
    })
      .addTo(map)
      .bindPopup(
        `<strong>${data.place || "目標地點"}</strong><br>AI 帶您來這裡！`,
      )
      .openPopup();

    document.getElementById("end").value = `${lon},${lat}`;

    addMessage(`${data.reply || "已幫您標記在地圖上！"}`, false);

    // 顯示地點相關建議
    if (data.suggestions && data.suggestions.length > 0) {
      showChatSuggestions(data.suggestions);
    }
  } else {
    // 一般回應或找不到地點
    addMessage(data.reply || "我還在學習中...請再說一次～", false);

    if (data.suggestions && data.suggestions.length > 0) {
      showChatSuggestions(data.suggestions);
    }
  }
}

// 顯示聊天建議按鈕
function showChatSuggestions(suggestions) {
  const suggestionsHTML = suggestions
    .map(
      (suggestion) =>
        `<button class="chat-suggestion" onclick="handleSuggestion('${suggestion}')">${suggestion}</button>`,
    )
    .join("");

  const suggestionDiv = document.createElement("div");
  suggestionDiv.className = "chat-suggestions";
  suggestionDiv.innerHTML = suggestionsHTML;

  chatMessages.appendChild(suggestionDiv);
  scrollToBottom();
}

// 處理建議點擊
function handleSuggestion(suggestion) {
  document.getElementById("chat-input").value = suggestion;
  sendMessage();
}

function addTypingIndicator() {
  const div = document.createElement("div");
  div.id = "typing-indicator";
  div.style.margin = "8px 0";
  div.style.padding = "10px 12px";
  div.style.borderRadius = "12px";
  div.style.maxWidth = "80%";
  div.style.background = "#e9ecef";
  div.style.color = "#666";
  div.style.fontStyle = "italic";
  div.style.display = "flex";
  div.style.alignItems = "center";
  div.style.gap = "8px";

  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.innerHTML = `
    <span></span>
    <span></span>
    <span></span>
  `;

  div.appendChild(document.createTextNode("AI 正在思考"));
  div.appendChild(dots);

  chatMessages.appendChild(div);
  scrollToBottom();

  return div;
}

// ✅ 新增：移除正在輸入指示器
function removeTypingIndicator(typingIndicator) {
  if (typingIndicator && typingIndicator.parentNode) {
    typingIndicator.parentNode.removeChild(typingIndicator);
  }
}

// 綁定事件
sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

// 初始化
document.addEventListener("DOMContentLoaded", function () {
  initMap();
  initSidebar();
  initMapClick();
  bindEvents();
  initNavigation();

  document
    .getElementById("chat-toggle-btn")
    .addEventListener("click", function () {
      const chatContainer = document.getElementById("chat-container");
      chatContainer.classList.toggle("show");

      // 聚焦到輸入框
      if (chatContainer.classList.contains("show")) {
        setTimeout(() => {
          document.getElementById("chat-input").focus();
        }, 100);
      }
    });

  // 頁面載入時歡迎訊息
  addMessage(
    "您好！我是 WheelWay AI 小助手\n請問您想去哪裡？（例如：我要去圖書館）",
    false,
  );

  console.log("花蓮無障礙坡道路線規劃系統已啟動");
});

function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("toggleSidebar");

  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    toggleBtn.textContent = sidebar.classList.contains("collapsed")
      ? "☰"
      : "✕";
    console.log(
      "側邊欄狀態:",
      sidebar.classList.contains("collapsed") ? "收起" : "展開",
    );
  });
}

// 地圖點擊事件
function initMapClick() {
  map.on("click", (e) => {
    const lng = e.latlng.lng.toFixed(6);
    const lat = e.latlng.lat.toFixed(6);

    // 清除舊標記
    markersLayer.clearLayers();

    if (clickCount === 0) {
      // 設定起點
      document.getElementById("start").value = `${lng},${lat}`;
      startMarker = L.marker([lat, lng], {
        draggable: true,
        icon: L.divIcon({
          className: "marker-start",
          html: "🟢",
          iconSize: [24, 24],
        }),
      })
        .on("dragend", (ev) => {
          const p = ev.target.getLatLng();
          document.getElementById("start").value =
            `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
        })
        .addTo(markersLayer)
        .bindPopup("起點 (可拖曳調整)");

      clickCount = 1;
    } else {
      // 設定終點
      document.getElementById("end").value = `${lng},${lat}`;
      endMarker = L.marker([lat, lng], {
        draggable: true,
        icon: L.divIcon({
          className: "marker-end",
          html: "🔴",
          iconSize: [24, 24],
        }),
      })
        .on("dragend", (ev) => {
          const p = ev.target.getLatLng();
          document.getElementById("end").value =
            `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
        })
        .addTo(markersLayer)
        .bindPopup("終點 (可拖曳調整)");

      clickCount = 0;
    }
  });
}

// 顯示路線資訊 - 支援新舊兩種格式
function displayRouteInfo(routeData, originalEnd = null, rampPoint = null) {
  console.log("📊 顯示路線資訊:", routeData);

  const isNewFormat = routeData.normal !== undefined;

  let redirectInfo = "";
  if (rampPoint && originalEnd) {
    redirectInfo = `
      <div class="route-redirect-info">
        <small>終點已導向至無障礙入口：${rampPoint.name}</small>
      </div>
    `;
  }

  if (isNewFormat) {
    let normalHTML = "";
    let accessibleHTML = "";

    // 處理一般路線
    if (
      routeData.normal &&
      routeData.normal.features &&
      routeData.normal.features.length > 0
    ) {
      const normalFeature = routeData.normal.features[0];
      const normalSummary = normalFeature.properties.summary;

      normalHTML = `
        <div class="route-option ${currentRouteType === "normal" ? "active" : ""}" 
             onclick="toggleRouteDisplay('normal')">
          <div class="route-header">
            <span class="route-icon">🚶</span>
            <span class="route-title">一般路線</span>
            <span class="badge">最短路徑</span>
          </div>
          <div class="route-details">
            <span>${normalSummary.distance ? normalSummary.distance.toFixed(0) : "N/A"} 公尺</span>
            <span>${normalSummary.duration || "N/A"} 分鐘</span>
            <span>可能含障礙</span>
          </div>
        </div>
      `;
    }

    // 處理無障礙路線
    if (
      routeData.accessible &&
      routeData.accessible.features &&
      routeData.accessible.features.length > 0
    ) {
      const accessibleFeature = routeData.accessible.features[0];
      const accessibleProps = accessibleFeature.properties;
      const accessibleSummary = accessibleProps.summary;
      const accessibility = accessibleProps.accessibility;

      accessibleHTML = `
        <div class="route-option ${currentRouteType === "accessible" ? "active" : ""}" 
             onclick="toggleRouteDisplay('accessible')">
          <div class="route-header">
            <span class="route-icon">♿</span>
            <span class="route-title">無障礙路線</span>
            ${
              accessibility && accessibility.suitable_for_wheelchair
                ? '<span class="badge success">適合輪椅</span>'
                : '<span class="badge warning">可能有障礙</span>'
            }
          </div>
          <div class="route-details">
            <span>${accessibleSummary.distance ? accessibleSummary.distance.toFixed(0) : "N/A"} 公尺</span>
            <span>${accessibleSummary.duration || "N/A"} 分鐘</span>
            <span>${accessibility ? accessibility.barrier_count : "N/A"} 個障礙點</span>
          </div>
        </div>
      `;
    }

    const warningHTML = routeData.has_accessible_alternative
      ? '<div class="route-success">已找到無障礙替代路線</div>'
      : '<div class="route-warning">無法找到無障礙替代路線</div>';

    document.getElementById("routeDetails").innerHTML = `
      <div class="route-selection">
        <div class="route-selection-title">選擇路線類型：</div>
        ${redirectInfo}
        ${accessibleHTML}
        ${normalHTML}
        ${warningHTML}
      </div>
    `;
  } else {
    // 舊格式的顯示邏輯
    console.log("📝 使用舊格式顯示");

    if (routeData.features && routeData.features.length > 0) {
      const feature = routeData.features[0];
      const summary = feature.properties.summary;

      document.getElementById("routeDetails").innerHTML = `
        <div class="route-selection">
          <div class="route-selection-title">路線資訊：</div>
          ${redirectInfo}
          <div class="route-option active">
            <div class="route-header">
              <span class="route-icon">🗺️</span>
              <span class="route-title">規劃路線</span>
              <span class="badge">單一路線</span>
            </div>
            <div class="route-details">
              <span>${summary.distance ? summary.distance.toFixed(0) : "N/A"} 公尺</span>
              <span>${summary.duration || "N/A"} 分鐘</span>
              <span>基礎路線</span>
            </div>
          </div>
          <div class="route-warning">
            ⚠️ 後端服務尚未更新至雙路線版本
          </div>
        </div>
      `;
    }
  }

  showNavigationButton(routeData);
}

function toggleRouteDisplay(routeType) {
  currentRouteType = routeType;
  console.log("切換到路線類型:", routeType);

  if (normalRouteLayer && accessibleRouteLayer) {
    if (routeType === "normal") {
      // 顯示一般路線，隱藏無障礙路線
      map.removeLayer(accessibleRouteLayer);
      map.addLayer(normalRouteLayer);
    } else {
      // 顯示無障礙路線，隱藏一般路線
      map.removeLayer(normalRouteLayer);
      map.addLayer(accessibleRouteLayer);
    }

    // 更新按鈕狀態
    updateRouteButtons(routeType);
  }
}

// ✅ 新增: 更新按鈕狀態
function updateRouteButtons(activeType) {
  const options = document.querySelectorAll(".route-option");
  options.forEach((option) => {
    if (option.getAttribute("onclick")?.includes(activeType)) {
      option.classList.add("active");
    } else {
      option.classList.remove("active");
    }
  });
}

// 計算兩點間距離（公尺）
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 找出最近的坡道
function findNearestRamp(lat, lon) {
  let best = null;
  let bestDist = Infinity;

  ramps.forEach((r) => {
    const d = distanceMeters(lat, lon, r.lat, r.lon);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  });

  return { ramp: best, distance: bestDist };
}

// 清除路線圖層
function clearRouteLayers() {
  if (normalRouteLayer) {
    map.removeLayer(normalRouteLayer);
    normalRouteLayer = null;
  }
  if (accessibleRouteLayer) {
    map.removeLayer(accessibleRouteLayer);
    accessibleRouteLayer = null;
  }
}

// 清除所有
function clearAll() {
  // 清除路線
  clearRouteLayers();

  // 清除標記（保留坡道標記）
  markersLayer.clearLayers();
  startMarker = null;
  endMarker = null;

  // 清除顯示
  document.getElementById("routeInfo").style.display = "none";
  clickCount = 0;
}

// 綁定事件
function bindEvents() {
  document.getElementById("routeBtn").addEventListener("click", drawRoute);
  document.getElementById("clearBtn").addEventListener("click", clearAll);
  document.getElementById("backBtn").addEventListener("click", function () {
    window.location.href = "main.html";
  });
}

// ==================== 前端導航功能實作 =====================
// 導航相關全域變數
let navigationData = null;
let currentStep = 0;
let isNavigating = false;
let userLocationMarker = null;
let watchId = null;

// 初始化導航功能
function initNavigation() {
  bindNavigationEvents();
}

// 綁定導航事件
function bindNavigationEvents() {
  document.getElementById("nextStepBtn").addEventListener("click", () => {
    if (!isNavigating) return;

    if (currentStep < navigationData.steps.length - 1) {
      currentStep++;
      updateNavigationDisplay();
    } else {
      // 完成導航
      alert("🎉 您已到達目的地！");
      stopNavigation();
    }
  });

  document.getElementById("prevStepBtn").addEventListener("click", () => {
    if (!isNavigating) return;

    if (currentStep > 0) {
      currentStep--;
      updateNavigationDisplay();
    }
  });

  document.getElementById("exitNavBtn").addEventListener("click", () => {
    if (isNavigating) {
      const confirmStop = confirm("確定要結束導航嗎？");
      if (confirmStop) {
        stopNavigation();
      }
    }
  });
}

// 顯示導航按鈕（在路線規劃完成後）
function showNavigationButton(routeData) {
  const routeDetails = document.getElementById("routeDetails");

  // 移除舊的導航按鈕（如果存在）
  const oldButton = document.getElementById("startNavigationBtn");
  if (oldButton) {
    oldButton.removeEventListener("click", startNavigationHandler); // 移除舊的事件監聽器
    oldButton.remove();
  }

  // 添加新的導航按鈕
  const navButton = document.createElement("div");
  navButton.innerHTML = `
    <div style="text-align: center; margin-top: 15px;">
      <button class="btn-primary" id="startNavigationBtn" style="background: #28a745;">
        開始導航
      </button>
    </div>
  `;
  routeDetails.appendChild(navButton);

  // 使用命名函數以便後續移除
  function startNavigationHandler() {
    startNavigation(routeData);
  }

  // 綁定開始導航事件
  document
    .getElementById("startNavigationBtn")
    .addEventListener("click", startNavigationHandler);
}

// 開始導航 - 呼叫後端API獲取詳細導航步驟
async function startNavigation(routeData) {
  try {
    const startValue = document.getElementById("start").value;
    const endValue = document.getElementById("end").value;

    const [slon, slat] = startValue.split(",").map(Number);
    const [elon, elat] = endValue.split(",").map(Number);

    // ✅ 呼叫後端獲取詳細導航步驟
    const response = await fetch("http://localhost:3000/api/navigation/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: [slon, slat],
        end: [elon, elat],
        route_type: currentRouteType,
        route_data: routeData,
      }),
    });

    if (!response.ok) {
      throw new Error("導航服務暫時無法使用");
    }

    navigationData = await response.json();

    // 開始導航流程
    isNavigating = true;
    currentStep = 0;

    // 顯示導航控制面板
    document.getElementById("navigationControls").style.display = "block";
    document.getElementById("startNavigationBtn").style.display = "none";

    // 開始GPS追蹤
    startGPSTracking();

    // 更新導航顯示
    updateNavigationDisplay();

    console.log("🧭 導航開始", navigationData);
  } catch (error) {
    console.error("開始導航失敗:", error);
    alert("導航服務暫時無法使用，請稍後再試");
  }
}

// 更新導航顯示
function updateNavigationDisplay() {
  if (!navigationData || !isNavigating) return;

  const currentStepData = navigationData.steps[currentStep];
  const nextInstruction = document.getElementById("nextInstruction");
  const distanceToNext = document.getElementById("distanceToNext");
  const progressText = document.getElementById("progressText");
  const progressFill = document.getElementById("progressFill");

  // 更新指令和距離
  nextInstruction.textContent = currentStepData.instruction;
  distanceToNext.textContent =
    currentStepData.distance > 0
      ? `還有 ${currentStepData.distance} 公尺`
      : "即將到達";

  // 更新進度條
  const progress = ((currentStep + 1) / navigationData.steps.length) * 100;
  progressText.textContent = `${Math.round(progress)}% 完成`;
  progressFill.style.width = `${progress}%`;

  // 更新按鈕狀態
  document.getElementById("prevStepBtn").disabled = currentStep === 0;
  document.getElementById("nextStepBtn").textContent =
    currentStep === navigationData.steps.length - 1 ? "完成導航" : "下一步";

  // 語音提示
  speakNavigation(currentStepData.instruction);
}

// GPS 位置追蹤
function startGPSTracking() {
  if ("geolocation" in navigator) {
    watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        // 更新使用者位置標記
        updateUserPosition(lat, lng, accuracy);

        // ✅ 呼叫後端檢查位置和更新導航
        if (isNavigating) {
          await checkPositionWithBackend(lat, lng);
        }
      },
      (error) => {
        console.error("GPS 錯誤:", error);
        speakNavigation("GPS信號不穩定");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      },
    );
  } else {
    alert("您的裝置不支援GPS定位");
  }
}

// 更新使用者位置標記
function updateUserPosition(lat, lng, accuracy) {
  if (!userLocationMarker) {
    userLocationMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "user-location-marker",
        html: "📍",
        iconSize: [30, 30],
      }),
    }).addTo(map);

    // 添加精度圓圈
    L.circle([lat, lng], {
      radius: accuracy,
      color: "blue",
      fillColor: "#007aff",
      fillOpacity: 0.1,
    }).addTo(map);
  } else {
    userLocationMarker.setLatLng([lat, lng]);
  }
}

// ✅ 呼叫後端檢查位置
async function checkPositionWithBackend(lat, lng) {
  try {
    const response = await fetch(
      "http://localhost:3000/api/navigation/position",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_position: [lng, lat],
          current_step: currentStep,
          navigation_id: navigationData.navigation_id,
        }),
      },
    );

    if (response.ok) {
      const positionData = await response.json();

      // 處理後端回傳的導航更新
      handleNavigationUpdate(positionData);
    }
  } catch (error) {
    console.error("位置檢查失敗:", error);
  }
}

// 處理後端回傳的導航更新
function handleNavigationUpdate(positionData) {
  if (positionData.step_completed) {
    // 步驟完成，自動下一步
    if (currentStep < navigationData.steps.length - 1) {
      currentStep++;
      updateNavigationDisplay();
    } else {
      completeNavigation();
    }
  }

  if (positionData.off_route) {
    // 偏離路線，重新規劃
    handleOffRoute(positionData);
  }

  if (positionData.next_instruction) {
    // 更新下一個指令
    document.getElementById("nextInstruction").textContent =
      positionData.next_instruction;
  }
}

// 語音提示
function speakNavigation(instruction) {
  if ("speechSynthesis" in window) {
    // 停止之前的語音
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(instruction);
    utterance.lang = "zh-TW";
    utterance.rate = 0.9; // 稍微放慢速度
    utterance.volume = 0.8;
    utterance.pitch = 1;

    utterance.onerror = function (event) {
      console.error("語音合成錯誤:", event);
    };

    speechSynthesis.speak(utterance);
  }
}

// 處理偏離路線
function handleOffRoute(positionData) {
  speakNavigation("您已偏離路線，正在重新規劃");

  // 顯示重新規劃提示
  const nextInstruction = document.getElementById("nextInstruction");
  nextInstruction.textContent = "偏離路線，重新規劃中...";
  nextInstruction.style.color = "#dc3545";

  // 可以選擇自動重新規劃或等待使用者確認
  setTimeout(() => {
    recalculateRoute(positionData.current_position);
  }, 3000);
}

// 重新規劃路線
async function recalculateRoute(currentPosition) {
  try {
    const endValue = document.getElementById("end").value;
    const [elon, elat] = endValue.split(",").map(Number);

    const response = await fetch(
      "http://localhost:3000/api/navigation/recalculate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_position: currentPosition,
          end: [elon, elat],
          route_type: currentRouteType,
        }),
      },
    );

    if (response.ok) {
      const newRouteData = await response.json();

      // 更新路線顯示
      clearRouteLayers();
      drawRoutesOnMap(newRouteData.route_geometry);

      // 重新開始導航
      startNavigation(newRouteData);

      speakNavigation("路線重新規劃完成");
    }
  } catch (error) {
    console.error("重新規劃失敗:", error);
    speakNavigation("重新規劃失敗，請手動操作");
  }
}

function completeNavigation() {
  speakNavigation("恭喜您已到達目的地");
  alert("🎉 您已到達目的地！");
  stopNavigation();
}

function stopNavigation() {
  isNavigating = false;

  // 停止 GPS 追蹤
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  // 停止語音
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }

  // 隱藏導航控制面板
  document.getElementById("navigationControls").style.display = "none";

  // 清除使用者位置標記
  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
    userLocationMarker = null;
  }

  console.log("🧭 導航結束");
}
