const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const RANGE_DAYS = { "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365 };
const DEFAULT_LOCATION = { name: "Berlin", lat: 52.52, lon: 13.41 };

let currentLocation = loadLocation();
let chart;
let activeRange = "1w";
let forecastChart;
let forecastData = [];
let activeForecastHours = 24;
let actionCardsLoaded = false;

function loadLocation() {
  try {
    const saved = localStorage.getItem("pressure-location");
    if (saved) return JSON.parse(saved);
  } catch {}
  return { ...DEFAULT_LOCATION };
}

function saveLocation(loc) {
  currentLocation = loc;
  localStorage.setItem("pressure-location", JSON.stringify(loc));
}

// --- Body Weather Index ---

const BODY_WEATHER_LEVELS = [
  { max: 2,  level: 1, label: "Calm",     color: "#4caf50" },
  { max: 4,  level: 2, label: "Mild",     color: "#26c6da" },
  { max: 6,  level: 3, label: "Moderate", color: "#fdd835" },
  { max: 8,  level: 4, label: "High",     color: "#ff9800" },
  { max: 10, level: 5, label: "Severe",   color: "#f44336" },
];

function computePressureFlux(slice) {
  if (!slice || slice.length < 2) return 0;
  const recent = slice.slice(0, Math.min(4, slice.length));
  const pMax = Math.max(...recent.map(d => d.pressure_hpa));
  const pMin = Math.min(...recent.map(d => d.pressure_hpa));
  const drop = pMax - pMin;
  const rate = Math.abs(recent[recent.length - 1].pressure_hpa - recent[0].pressure_hpa) / (recent.length - 1);
  const dropScore = Math.min(10, (drop / 6) * 10);
  const rateScore = Math.min(10, (rate / 2) * 10);
  return Math.min(10, Math.round(Math.max(dropScore, rateScore)));
}

function computeDampCold(humidity, temp) {
  if (humidity <= 60 || temp >= 20) return 0;
  const rhFactor = Math.min(1, (humidity - 60) / 25);
  const coldFactor = Math.min(1, (20 - temp) / 15);
  return Math.min(10, Math.round(rhFactor * coldFactor * 10));
}

function computeThermalShock(slice) {
  if (!slice || slice.length < 2) return 0;
  const window6h = slice.slice(0, Math.min(7, slice.length));
  const tMax = Math.max(...window6h.map(d => d.temperature_c));
  const tMin = Math.min(...window6h.map(d => d.temperature_c));
  const swing = tMax - tMin;
  if (swing <= 3) return 0;
  return Math.min(10, Math.round(((swing - 3) / 9) * 10));
}

function computeBodyWeather(slice) {
  if (!slice || slice.length === 0) return null;
  const latest = slice[slice.length - 1];
  const pFlux = computePressureFlux(slice);
  const damp = computeDampCold(latest.humidity_pct, latest.temperature_c);
  const thermal = computeThermalShock(slice);
  const maxScore = Math.max(pFlux, damp, thermal);
  const bwLevel = BODY_WEATHER_LEVELS.find(l => maxScore <= l.max);

  const reasons = [
    { score: pFlux, text: "Pressure shifting" },
    { score: damp, text: "Cold & damp" },
    { score: thermal, text: "Temperature swinging" },
  ].filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  const reason = reasons.length > 0 ? reasons[0].text : "Conditions stable";

  return {
    level: bwLevel.level, label: bwLevel.label, color: bwLevel.color, reason,
    sub: { pFlux, damp, thermal },
  };
}

function enrichWithComfort(data) {
  for (let i = 0; i < data.length; i++) {
    const windowStart = Math.max(0, i - 6);
    const w = data.slice(windowStart, i + 1);
    const bw = computeBodyWeather(w);
    data[i].comfort_score = bw ? (5 - bw.level + 1) * 20 : null;
    data[i].body_weather = bw;
  }
  return data;
}

function updateBodyWeatherDisplay(bw) {
  const card = document.getElementById("comfort-card");
  const scoreEl = document.getElementById("bw-level");
  const labelEl = document.getElementById("bw-label");
  const reasonEl = document.getElementById("bw-reason");
  const barsEl = document.getElementById("bw-bars");

  if (!bw) {
    scoreEl.textContent = "--";
    labelEl.textContent = "Loading...";
    reasonEl.textContent = "";
    card.style.borderColor = "#333";
    scoreEl.style.color = "#eee";
    labelEl.style.color = "#aaa";
    return;
  }

  scoreEl.textContent = bw.level;
  scoreEl.style.color = bw.color;
  labelEl.textContent = bw.label;
  labelEl.style.color = bw.color;
  reasonEl.textContent = bw.reason;
  card.style.borderColor = bw.color;

  const barColor = v => BODY_WEATHER_LEVELS.find(l => v <= l.max)?.color ?? "#333";
  barsEl.innerHTML = [
    { label: "Joint Pressure", value: bw.sub.pFlux },
    { label: "Stiffness Risk", value: bw.sub.damp },
    { label: "Muscle Tension", value: bw.sub.thermal },
  ].map(b => `
    <div class="bw-bar-row">
      <span class="bw-bar-label">${b.label}</span>
      <div class="bw-bar-track"><div class="bw-bar-fill" style="width:${b.value * 10}%;background:${barColor(b.value)}"></div></div>
      <span class="bw-bar-value">${b.value}</span>
    </div>
  `).join("");
}

function initBodyWeatherCard() {
  const card = document.getElementById("comfort-card");
  card.addEventListener("click", () => card.classList.toggle("expanded"));
}

// --- Action cards ---

function getActions(bw) {
  if (!bw) return [];

  const actions = [];
  const { pFlux, damp, thermal } = bw.sub;

  if (pFlux >= 7) {
    actions.push({ icon: "\ud83d\udeb6", text: "10-min walk now \u2014 move before it stiffens", priority: "high" });
    actions.push({ icon: "\ud83e\uddd8", text: "Cat-cow stretches for spinal mobility", priority: "high" });
  } else if (pFlux >= 4) {
    actions.push({ icon: "\ud83d\udeb6", text: "Light walk recommended", priority: "medium" });
  }

  if (damp >= 7) {
    actions.push({ icon: "\ud83d\udd25", text: "Heat pad on lower back", priority: "high" });
    actions.push({ icon: "\ud83e\udde3", text: "Merino layer \u2014 keep lumbar warm", priority: "medium" });
  } else if (damp >= 4) {
    actions.push({ icon: "\ud83e\udde3", text: "Merino layer \u2014 keep lumbar warm", priority: "medium" });
  }

  if (thermal >= 4) {
    actions.push({ icon: "\ud83e\uddd8", text: "Stretch first thing \u2014 muscles tightened overnight", priority: "medium" });
  }

  if (actions.length === 0) {
    actions.push({ icon: "\ud83c\udfc3", text: "Good day \u2014 your body will thank you for moving", priority: "low" });
  }

  return actions;
}

function renderActionCards(actions) {
  const container = document.getElementById("action-cards");
  container.innerHTML = actions.map(a =>
    `<div class="action-card action-${a.priority}"><span class="action-icon">${a.icon}</span><span class="action-text">${a.text}</span></div>`
  ).join("");
}

// --- Current conditions ---

async function loadCurrent() {
  try {
    const url = `${FORECAST_URL}?latitude=${currentLocation.lat}&longitude=${currentLocation.lon}&current=surface_pressure,relative_humidity_2m,temperature_2m&hourly=surface_pressure,relative_humidity_2m,temperature_2m&forecast_days=1&timezone=auto`;
    const r = await fetch(url);
    const data = await r.json();

    const current = data.current.surface_pressure;
    const currentHumidity = data.current.relative_humidity_2m;
    const currentTemp = data.current.temperature_2m;

    const times = data.hourly?.time ?? [];
    const pressures = data.hourly?.surface_pressure ?? [];
    const humidities = data.hourly?.relative_humidity_2m ?? [];
    const temps = data.hourly?.temperature_2m ?? [];

    const now = Date.now();
    const hourly = times.map((t, i) => ({
      time: t,
      pressure_hpa: pressures[i],
      humidity_pct: humidities[i],
      temperature_c: temps[i],
    })).filter(d => d.pressure_hpa != null);

    let nowIdx = 0;
    let minDiff = Infinity;
    hourly.forEach((d, i) => {
      const diff = Math.abs(new Date(d.time).getTime() - now);
      if (diff < minDiff) { minDiff = diff; nowIdx = i; }
    });

    // Trend arrows: compare now vs 3 hours ahead
    const futureIdx = Math.min(nowIdx + 3, hourly.length - 1);
    const trend = (nowVal, futureVal) => {
      const diff = futureVal - nowVal;
      if (Math.abs(diff) < 0.3) return "";
      return diff > 0 ? " \u2197" : " \u2198";
    };

    const pTrend = futureIdx > nowIdx ? trend(hourly[nowIdx].pressure_hpa, hourly[futureIdx].pressure_hpa) : "";
    const hTrend = futureIdx > nowIdx ? trend(hourly[nowIdx].humidity_pct, hourly[futureIdx].humidity_pct) : "";
    const tTrend = futureIdx > nowIdx ? trend(hourly[nowIdx].temperature_c, hourly[futureIdx].temperature_c) : "";

    document.getElementById("current").textContent = (current?.toFixed(1) ?? "--") + pTrend;
    document.getElementById("current-humidity").textContent = (currentHumidity != null ? `${currentHumidity}%` : "--") + hTrend;
    document.getElementById("current-temp").textContent = (currentTemp != null ? `${currentTemp.toFixed(1)}°` : "--") + tTrend;

    const comfortWindow = hourly.slice(Math.max(0, nowIdx - 6), nowIdx + 1);
    const bw = computeBodyWeather(comfortWindow);
    updateBodyWeatherDisplay(bw);
    renderActionCards(getActions(bw));
    actionCardsLoaded = true;
  } catch {
    console.error("Failed to load current conditions");
  }
}

// --- Multi-line chart helpers ---

function makeMultiLineDatasets(data) {
  return [
    {
      label: "Pressure (hPa)",
      data: data.map(r => r.pressure_hpa),
      borderColor: "#4fc3f7",
      backgroundColor: "transparent",
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 1.5,
      yAxisID: "yLeft",
    },
    {
      label: "Humidity (%)",
      data: data.map(r => r.humidity_pct),
      borderColor: "#81c784",
      backgroundColor: "transparent",
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 1.5,
      yAxisID: "yRight",
    },
    {
      label: "Temperature (°C)",
      data: data.map(r => r.temperature_c),
      borderColor: "#ffb74d",
      backgroundColor: "transparent",
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 1.5,
      yAxisID: "yTemp",
    },
  ];
}

function dualAxisScales(xCallback) {
  return {
    x: {
      ticks: {
        color: "#888",
        maxTicksLimit: 8,
        callback: xCallback,
      },
    },
    yLeft: {
      type: "linear",
      position: "left",
      ticks: { color: "#4fc3f7" },
    },
    yRight: {
      type: "linear",
      position: "right",
      ticks: { color: "#81c784" },
      grid: { drawOnChartArea: false },
    },
    yTemp: {
      type: "linear",
      position: "right",
      ticks: { color: "#ffb74d" },
      grid: { drawOnChartArea: false },
    },
  };
}

// --- Forecast ---

async function loadForecast(hours) {
  activeForecastHours = hours || activeForecastHours;
  document.querySelectorAll("#forecast-buttons button").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.hours) === activeForecastHours);
  });

  try {
    if (!forecastData.length) {
      const url = `${FORECAST_URL}?latitude=${currentLocation.lat}&longitude=${currentLocation.lon}&hourly=surface_pressure,relative_humidity_2m,temperature_2m&forecast_days=16&timezone=auto`;
      const r = await fetch(url);
      const data = await r.json();
      const times = data.hourly?.time ?? [];
      const pressures = data.hourly?.surface_pressure ?? [];
      const humidities = data.hourly?.relative_humidity_2m ?? [];
      const temps = data.hourly?.temperature_2m ?? [];
      forecastData = enrichWithComfort(times.map((t, i) => ({
        time: t,
        pressure_hpa: pressures[i],
        humidity_pct: humidities[i],
        temperature_c: temps[i],
      })).filter(d => d.pressure_hpa != null));
    }

    if (!actionCardsLoaded) {
      const now = Date.now();
      let ni = 0, md = Infinity;
      forecastData.forEach((d, i) => { const diff = Math.abs(new Date(d.time).getTime() - now); if (diff < md) { md = diff; ni = i; } });
      const w = forecastData.slice(Math.max(0, ni - 6), ni + 1);
      if (w.length) {
        const bw = computeBodyWeather(w);
        updateBodyWeatherDisplay(bw);
        renderActionCards(getActions(bw));
      }
    }

    renderForecastChart();
  } catch {
    console.error("Failed to load forecast");
  }
}

function renderForecastChart() {
  const sliced = forecastData.slice(0, activeForecastHours);
  if (!sliced.length) return;

  const labels = sliced.map(r => r.time);
  const datasets = makeMultiLineDatasets(sliced);

  const now = Date.now();
  let nowIndex = 0;
  let minDiff = Infinity;
  sliced.forEach((d, i) => {
    const diff = Math.abs(new Date(d.time).getTime() - now);
    if (diff < minDiff) { minDiff = diff; nowIndex = i; }
  });

  const nowLinePlugin = {
    id: "nowLine",
    afterDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      const pt = meta.data[nowIndex];
      if (!pt) return;
      const { ctx, chartArea: { top, bottom } } = chart;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pt.x, top);
      ctx.lineTo(pt.x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Now", pt.x, top - 4);
      ctx.restore();
    },
  };

  if (forecastChart) forecastChart.destroy();
  forecastChart = new Chart(document.getElementById("forecast-chart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      layout: { padding: { top: 16 } },
      plugins: {
        legend: {
          display: true,
          labels: { color: "#ccc", boxWidth: 12, font: { size: 11 } },
        },
      },
      scales: dualAxisScales(function (val) {
        const label = this.getLabelForValue(val);
        if (!label) return "";
        const [date, time] = label.split("T");
        return activeForecastHours <= 24 ? time : date;
      }),
    },
    plugins: [nowLinePlugin],
  });
}

// --- History ---

let historyData = [];

async function loadHistory(range) {
  activeRange = range || activeRange;
  document.querySelectorAll("#range-buttons button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.range === activeRange);
  });

  try {
    const days = RANGE_DAYS[activeRange];
    if (!days) return;
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    const fmt = d => d.toISOString().split("T")[0];

    const url = `${ARCHIVE_URL}?latitude=${currentLocation.lat}&longitude=${currentLocation.lon}&hourly=surface_pressure,relative_humidity_2m,temperature_2m&timezone=auto&start_date=${fmt(start)}&end_date=${fmt(end)}`;
    const r = await fetch(url);
    const data = await r.json();
    const times = data.hourly?.time ?? [];
    const pressures = data.hourly?.surface_pressure ?? [];
    const humidities = data.hourly?.relative_humidity_2m ?? [];
    const temps = data.hourly?.temperature_2m ?? [];
    historyData = enrichWithComfort(times.map((t, i) => ({
      time: t,
      pressure_hpa: pressures[i],
      humidity_pct: humidities[i],
      temperature_c: temps[i],
    })).filter(d => d.pressure_hpa != null));

    renderHistoryChart();
  } catch {
    console.error("Failed to load history");
  }
}

function renderHistoryChart() {
  if (!historyData.length) return;

  const labels = historyData.map(r => r.time);
  const datasets = makeMultiLineDatasets(historyData);

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById("chart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          labels: { color: "#ccc", boxWidth: 12, font: { size: 11 } },
        },
      },
      scales: dualAxisScales(function (val) {
        const label = this.getLabelForValue(val);
        return label ? label.split("T")[0] : "";
      }),
    },
  });
}

// --- Helpers ---

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// --- Event listeners ---

document.getElementById("forecast-buttons").addEventListener("click", e => {
  if (e.target.dataset.hours) loadForecast(Number(e.target.dataset.hours));
});

document.getElementById("range-buttons").addEventListener("click", e => {
  if (e.target.dataset.range) loadHistory(e.target.dataset.range);
});

function reloadAll() {
  forecastData = [];
  historyData = [];
  actionCardsLoaded = false;
  document.getElementById("location-name").innerHTML = "Body Weather<br>" + currentLocation.name;
  document.title = `${currentLocation.name} Pressure Monitor`;
  loadCurrent();
  loadForecast();
  loadHistory();
}

let searchTimeout = null;

function initLocationUI() {
  const editBtn = document.getElementById("location-edit-btn");
  const searchDiv = document.getElementById("location-search");
  const input = document.getElementById("location-input");
  const results = document.getElementById("location-results");

  document.getElementById("location-name").innerHTML = "Body Weather<br>" + currentLocation.name;
  document.title = `${currentLocation.name} Pressure Monitor`;

  editBtn.addEventListener("click", () => {
    searchDiv.classList.toggle("hidden");
    if (!searchDiv.classList.contains("hidden")) {
      input.value = "";
      input.focus();
      results.innerHTML = "";
    }
  });

  input.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const query = input.value.trim();
    if (query.length < 2) {
      results.innerHTML = "";
      return;
    }
    searchTimeout = setTimeout(() => searchCity(query, results), 300);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Escape") searchDiv.classList.add("hidden");
  });

  document.addEventListener("click", e => {
    if (!searchDiv.contains(e.target) && e.target !== editBtn) {
      searchDiv.classList.add("hidden");
    }
  });
}

async function searchCity(query, resultsEl) {
  try {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=5&language=en`;
    const r = await fetch(url);
    const data = await r.json();
    const items = data.results || [];

    resultsEl.innerHTML = "";
    items.forEach(item => {
      const li = document.createElement("li");
      const secondary = [item.admin1, item.country].filter(Boolean).join(", ");
      li.innerHTML = `${item.name} <small>${secondary}</small>`;
      li.addEventListener("click", () => {
        saveLocation({ name: item.name, lat: item.latitude, lon: item.longitude });
        document.getElementById("location-search").classList.add("hidden");
        reloadAll();
      });
      resultsEl.appendChild(li);
    });
  } catch {
    console.error("Geocoding search failed");
  }
}

initLocationUI();
initBodyWeatherCard();
loadCurrent();
loadForecast();
loadHistory("1w");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
