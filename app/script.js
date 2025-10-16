// 全域變數
let map;
let routeLayer = null;
let startMarker = null;
let endMarker = null;
let clickCount = 0;
let markersLayer = L.layerGroup();

// 初始化地圖
function initMap() {
  map = L.map("map").setView([23.975, 121.606], 14);

  L.tileLayer(
    "https://wmts.nlsc.gov.tw/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
      "&LAYER=EMAP&STYLE=default&TILEMATRIXSET=EPSG:3857" +
      "&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png",
    { attribution: "© 國土測繪中心", maxZoom: 19, crossOrigin: true },
  ).addTo(map);

  markersLayer.addTo(map);
}

// 側邊欄控制
function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("toggleSidebar");

  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    toggleBtn.textContent = sidebar.classList.contains("collapsed")
      ? "☰"
      : "✕";
  });
}

// 滑桿控制
function initSliders() {
  const inclineSlider = document.getElementById("incline");
  const inclineDisplay = document.getElementById("inclineDisplay");
  const inclineValue = document.getElementById("inclineValue");

  const widthSlider = document.getElementById("width");
  const widthDisplay = document.getElementById("widthDisplay");
  const widthValue = document.getElementById("widthValue");

  function updateSliders() {
    const incline = parseFloat(inclineSlider.value);
    const width = parseFloat(widthSlider.value);

    inclineDisplay.textContent = Math.round(incline * 100) + "%";
    inclineValue.textContent = Math.round(incline * 100) + "%";

    widthDisplay.textContent = Math.round(width * 100) + "cm";
    widthValue.textContent = Math.round(width * 100) + "cm";

    updateAccessibilityBadge(incline, width);
  }

  inclineSlider.addEventListener("input", updateSliders);
  widthSlider.addEventListener("input", updateSliders);
  updateSliders();
}

// 預設按鈕
function initPresetButtons() {
  const presetButtons = document.querySelectorAll(".btn-preset");
  presetButtons.forEach((btn) => {
    btn.addEventListener("click", function () {
      presetButtons.forEach((b) => b.classList.remove("active"));
      this.classList.add("active");

      const incline = parseFloat(this.dataset.incline);
      const width = parseFloat(this.dataset.width);

      document.getElementById("incline").value = incline;
      document.getElementById("width").value = width;

      // 觸發滑桿更新
      document.getElementById("incline").dispatchEvent(new Event("input"));
    });
  });
}

// 更新無障礙等級標籤
function updateAccessibilityBadge(incline, width) {
  const badge = document.getElementById("accessibilityBadge");
  let level = "basic";
  let text = "基本";
  let className = "badge-basic";

  if (incline <= 0.05 && width >= 1.2) {
    level = "high";
    text = "高";
    className = "badge-high";
  } else if (incline <= 0.08 && width >= 0.9) {
    level = "medium";
    text = "中";
    className = "badge-medium";
  }

  badge.textContent = text;
  badge.className = `accessibility-badge ${className}`;
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

// 智能路線規劃（推薦）
async function drawHybridRoute() {
  const routeInfo = document.getElementById("routeInfo");
  const routeDetails = document.getElementById("routeDetails");

  routeInfo.style.display = "block";
  routeDetails.innerHTML =
    '<div style="text-align: center;">🛣️ 規劃智能路線中...</div>';

  const [slon, slat] = document
    .getElementById("start")
    .value.split(",")
    .map(Number);
  const [elon, elat] = document
    .getElementById("end")
    .value.split(",")
    .map(Number);
  const maximum_incline = parseFloat(document.getElementById("incline").value);
  const minimum_width = parseFloat(document.getElementById("width").value);

  try {
    const r = await fetch("/api/hybrid-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: [slon, slat],
        end: [elon, elat],
        params: { maximum_incline, minimum_width },
      }),
    });

    const geo = await r.json();
    if (!r.ok) throw new Error(geo?.error || "routing_failed");

    drawRouteOnMap(geo, "智能路線");

    const summary = geo.features[0].properties.summary;
    routeDetails.innerHTML = `
            <div style="line-height: 1.6;">
                <div>🛣️ <strong>智能路線規劃</strong></div>
                <div>📏 距離: <strong>${summary.distance.toFixed(0)} 公尺</strong></div>
                <div>⏱️ 時間: <strong>${Math.round(summary.duration / 60)} 分鐘</strong></div>
                <div>♿ 無障礙等級: <strong>${summary.accessibility.level}</strong></div>
                <div>💡 ${summary.accessibility.notes}</div>
                <div style="font-size: 12px; color: #666; margin-top: 8px;">
                    來源: ${summary.accessibility.source || "本地計算"}
                </div>
            </div>
        `;
  } catch (e) {
    console.error(e);
    routeDetails.innerHTML = `<div style="color: #dc3545;">❌ 智能路線規劃失敗：${e.message}</div>`;
  }
}

// 在地圖上畫出路線
function drawRouteOnMap(geo, routeType) {
  // 清除舊路線
  if (routeLayer) {
    map.removeLayer(routeLayer);
  }

  const isRealRoute = routeType === "智能路線";
  const routeStyle = isRealRoute
    ? { color: "#28a745", weight: 6, opacity: 0.8 }
    : { color: "#007aff", weight: 5, opacity: 0.7 };

  routeLayer = L.geoJSON(geo, {
    style: routeStyle,
    onEachFeature: function (feature, layer) {
      const props = feature.properties;
      if (props.summary) {
        const popupContent = `
                    <div style="min-width: 200px;">
                        <strong>${routeType}</strong><br>
                        距離: ${props.summary.distance.toFixed(0)} 公尺<br>
                        時間: ${Math.round(props.summary.duration / 60)} 分鐘<br>
                        等級: ${props.summary.accessibility.level}<br>
                        <small>${props.summary.accessibility.notes}</small>
                    </div>
                `;
        layer.bindPopup(popupContent);
      }
    },
  }).addTo(map);

  // 自動縮放到路線範圍
  map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
}

// 清除所有
function clearAll() {
  // 清除路線
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  // 清除標記
  markersLayer.clearLayers();
  startMarker = null;
  endMarker = null;

  // 清除顯示
  document.getElementById("routeInfo").style.display = "none";
  clickCount = 0;

  // 重置輸入框
  document.getElementById("start").value = "121.606,23.975";
  document.getElementById("end").value = "121.611,23.979";

  console.log("🗑️ 已清除所有路線和標記");
}

// 綁定事件
function bindEvents() {
  document
    .getElementById("hybridRouteBtn")
    .addEventListener("click", drawHybridRoute);
  document
    .getElementById("simpleRouteBtn")
    .addEventListener("click", drawSimpleRoute);
  document.getElementById("clearBtn").addEventListener("click", clearAll);
}

// 初始化
document.addEventListener("DOMContentLoaded", function () {
  initMap();
  initSidebar();
  initSliders();
  initPresetButtons();
  initMapClick();
  bindEvents();

  console.log("🗺️ 花蓮無障礙路線規劃系統已啟動");
});
