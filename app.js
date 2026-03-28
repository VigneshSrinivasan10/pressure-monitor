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

// --- Comfort score ---

const COMFORT_LEVELS = [
  { min: 80, label: "Good day",    cls: "comfort-green" },
  { min: 60, label: "Moderate",    cls: "comfort-yellow" },
  { min: 40, label: "Take it easy", cls: "comfort-orange" },
  { min: 0,  label: "Flare risk",  cls: "comfort-red" },
];

function computeComfort(forecastSlice) {
  if (!forecastSlice || forecastSlice.length < 3) return null;

  let score = 100;

  const recent = forecastSlice.slice(0, Math.min(4, forecastSlice.length));
  const pMax = Math.max(...recent.map(d => d.pressure_hpa));
  const pMin = Math.min(...recent.map(d => d.pressure_hpa));
  const pDrop3h = pMax - pMin;
  if (pDrop3h > 3) score -= Math.min(40, Math.round((pDrop3h / 5) * 20));

  if (recent.length >= 2) {
    const rate = Math.abs(recent[recent.length - 1].pressure_hpa - recent[0].pressure_hpa) / (recent.length - 1);
    if (rate > 1) score -= 10;
  }

  const latest = forecastSlice[0];
  const rh = latest.humidity_pct;
  const temp = latest.temperature_c;
  if (rh > 80 && temp < 8) score -= 15;
  if (rh > 75 && temp > 28) score -= 10;

  const window6h = forecastSlice.slice(0, Math.min(7, forecastSlice.length));
  const tMax = Math.max(...window6h.map(d => d.temperature_c));
  const tMin = Math.min(...window6h.map(d => d.temperature_c));
  if (tMax - tMin > 8) score -= 15;

  return Math.max(0, Math.min(100, score));
}

function enrichWithComfort(data) {
  for (let i = 0; i < data.length; i++) {
    const windowStart = Math.max(0, i - 6);
    const window = data.slice(windowStart, i + 1);
    data[i].comfort_score = computeComfort(window);
  }
  return data;
}

function updateComfortDisplay(score) {
  const el = document.getElementById("comfort-score");
  const labelEl = document.getElementById("comfort-label");
  const card = document.getElementById("comfort-card");

  card.className = "comfort-card";

  if (score == null) {
    el.textContent = "--";
    labelEl.textContent = "Loading...";
    return;
  }

  el.textContent = score;
  const level = COMFORT_LEVELS.find(l => score >= l.min);
  labelEl.textContent = level.label;
  card.classList.add(level.cls);
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

    document.getElementById("current").textContent = current?.toFixed(1) ?? "--";
    document.getElementById("current-humidity").textContent = currentHumidity != null ? `${currentHumidity}%` : "--";
    document.getElementById("current-temp").textContent = currentTemp != null ? `${currentTemp.toFixed(1)}°` : "--";

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

    const comfortWindow = hourly.slice(Math.max(0, nowIdx - 6), nowIdx + 1);
    const score = computeComfort(comfortWindow);
    updateComfortDisplay(score);
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
  document.getElementById("location-name").innerHTML = "Comfort Index<br>" + currentLocation.name;
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

  document.getElementById("location-name").innerHTML = "Comfort Index<br>" + currentLocation.name;
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
loadCurrent();
loadForecast();
loadHistory("1w");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
