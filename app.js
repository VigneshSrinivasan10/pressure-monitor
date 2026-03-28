const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const RANGE_DAYS = { "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365 };
const TREND_ICONS = { rising: "\u2197\ufe0f Rising", falling: "\u2198\ufe0f Falling", stable: "\u2194\ufe0f Stable" };
const DEFAULT_LOCATION = { name: "Berlin", lat: 52.52, lon: 13.41 };

const SIGNALS = {
  pressure:    { key: "pressure_hpa",    label: "Pressure",    unit: "hPa",  color: "#4fc3f7" },
  humidity:    { key: "humidity_pct",     label: "Humidity",    unit: "%",    color: "#81c784" },
  temperature: { key: "temperature_c",   label: "Temperature", unit: "°C",   color: "#ffb74d" },
};

let currentLocation = loadLocation();
let chart;
let activeRange = "1w";
let forecastChart;
let forecastData = [];
let activeForecastHours = 24;
let activeSignal = "pressure";

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

function sig() { return SIGNALS[activeSignal]; }

function setActiveSignal(signal) {
  activeSignal = signal;
  document.querySelectorAll("#signal-buttons button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.signal === activeSignal);
  });
  // Re-render charts with new signal (no re-fetch needed)
  renderForecastChart();
  renderHistoryChart();
}

// --- Current conditions ---

async function loadCurrent() {
  try {
    const url = `${FORECAST_URL}?latitude=${currentLocation.lat}&longitude=${currentLocation.lon}&current=surface_pressure,relative_humidity_2m,temperature_2m&daily=surface_pressure_mean,temperature_2m_mean&forecast_days=2&timezone=auto`;
    const r = await fetch(url);
    const data = await r.json();

    const current = data.current.surface_pressure;
    const currentHumidity = data.current.relative_humidity_2m;
    const currentTemp = data.current.temperature_2m;

    const means = data.daily?.surface_pressure_mean ?? [];
    const todayMean = means[0] ?? null;
    const tomorrowMean = means[1] ?? null;

    let trend = null;
    if (todayMean != null && tomorrowMean != null) {
      const diff = tomorrowMean - todayMean;
      trend = diff > 1 ? "rising" : diff < -1 ? "falling" : "stable";
    }

    document.getElementById("current").textContent = current?.toFixed(1) ?? "--";
    document.getElementById("current-humidity").textContent = currentHumidity != null ? `${currentHumidity}%` : "--";
    document.getElementById("current-temp").textContent = currentTemp != null ? `${currentTemp.toFixed(1)}°` : "--";
    document.getElementById("tomorrow").textContent = tomorrowMean?.toFixed(1) ?? "--";
    document.getElementById("trend").textContent = TREND_ICONS[trend] ?? "--";
  } catch {
    console.error("Failed to load current conditions");
  }
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
      forecastData = times.map((t, i) => ({
        time: t,
        pressure_hpa: pressures[i],
        humidity_pct: humidities[i],
        temperature_c: temps[i],
      })).filter(d => d.pressure_hpa != null);
    }

    renderForecastChart();
  } catch {
    console.error("Failed to load forecast");
  }
}

function renderForecastChart() {
  const s = sig();
  const sliced = forecastData.slice(0, activeForecastHours);
  if (!sliced.length) return;

  const labels = sliced.map(r => r.time);
  const values = sliced.map(r => r[s.key]);

  const now = Date.now();
  let nowIndex = 0;
  let minDiff = Infinity;
  sliced.forEach((d, i) => {
    const diff = Math.abs(new Date(d.time).getTime() - now);
    if (diff < minDiff) { minDiff = diff; nowIndex = i; }
  });

  const pointRadii = values.map((_, i) => i === nowIndex ? 5 : 0);
  const pointColors = values.map((_, i) => i === nowIndex ? "#fff" : "transparent");
  const pointBorders = values.map((_, i) => i === nowIndex ? s.color : "transparent");

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
    data: {
      labels,
      datasets: [{
        label: `${s.label} (${s.unit})`,
        data: values,
        borderColor: s.color,
        backgroundColor: hexToRgba(s.color, 0.1),
        fill: true,
        tension: 0.3,
        pointRadius: pointRadii,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointBorders,
        pointBorderWidth: 2,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      layout: { padding: { top: 16 } },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            color: "#888",
            maxTicksLimit: 8,
            callback(val) {
              const label = this.getLabelForValue(val);
              if (!label) return "";
              const [date, time] = label.split("T");
              return activeForecastHours <= 24 ? time : date;
            },
          },
        },
        y: { ticks: { color: "#888" } },
      },
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
    historyData = times.map((t, i) => ({
      time: t,
      pressure_hpa: pressures[i],
      humidity_pct: humidities[i],
      temperature_c: temps[i],
    })).filter(d => d.pressure_hpa != null);

    renderHistoryChart();
  } catch {
    console.error("Failed to load history");
  }
}

function renderHistoryChart() {
  const s = sig();
  if (!historyData.length) return;

  const labels = historyData.map(r => r.time);
  const values = historyData.map(r => r[s.key]);

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById("chart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `${s.label} (${s.unit})`,
        data: values,
        borderColor: s.color,
        backgroundColor: hexToRgba(s.color, 0.1),
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            color: "#888",
            maxTicksLimit: 8,
            callback(val) {
              const label = this.getLabelForValue(val);
              return label ? label.split("T")[0] : "";
            },
          },
        },
        y: { ticks: { color: "#888" } },
      },
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

document.getElementById("signal-buttons").addEventListener("click", e => {
  if (e.target.dataset.signal) setActiveSignal(e.target.dataset.signal);
});

function reloadAll() {
  forecastData = [];
  historyData = [];
  document.getElementById("location-name").innerHTML = "Air pressure<br>" + currentLocation.name;
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

  document.getElementById("location-name").innerHTML = "Air pressure<br>" + currentLocation.name;
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
