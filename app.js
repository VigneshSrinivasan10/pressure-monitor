const LAT = 52.52;
const LON = 13.41;
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const RANGE_DAYS = { "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365 };
const TREND_ICONS = { rising: "\u2197\ufe0f Rising", falling: "\u2198\ufe0f Falling", stable: "\u2194\ufe0f Stable" };

let chart;
let activeRange = "1w";
let forecastChart;
let forecastData = [];
let activeForecastHours = 24;

async function loadCurrent() {
  try {
    const url = `${FORECAST_URL}?latitude=${LAT}&longitude=${LON}&current=surface_pressure&daily=surface_pressure_mean&forecast_days=2&timezone=Europe%2FBerlin`;
    const r = await fetch(url);
    const data = await r.json();

    const current = data.current.surface_pressure;
    const means = data.daily?.surface_pressure_mean ?? [];
    const todayMean = means[0] ?? null;
    const tomorrowMean = means[1] ?? null;

    let trend = null;
    if (todayMean != null && tomorrowMean != null) {
      const diff = tomorrowMean - todayMean;
      trend = diff > 1 ? "rising" : diff < -1 ? "falling" : "stable";
    }

    document.getElementById("current").textContent = current?.toFixed(1) ?? "--";
    document.getElementById("tomorrow").textContent = tomorrowMean?.toFixed(1) ?? "--";
    document.getElementById("trend").textContent = TREND_ICONS[trend] ?? "--";
  } catch {
    console.error("Failed to load current pressure");
  }
}

async function loadForecast(hours) {
  activeForecastHours = hours || activeForecastHours;
  document.querySelectorAll("#forecast-buttons button").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.hours) === activeForecastHours);
  });

  try {
    if (!forecastData.length) {
      const url = `${FORECAST_URL}?latitude=${LAT}&longitude=${LON}&hourly=surface_pressure&forecast_days=16&timezone=Europe%2FBerlin`;
      const r = await fetch(url);
      const data = await r.json();
      const times = data.hourly?.time ?? [];
      const pressures = data.hourly?.surface_pressure ?? [];
      forecastData = times.map((t, i) => ({ time: t, pressure_hpa: pressures[i] }))
        .filter(d => d.pressure_hpa != null);
    }

    const sliced = forecastData.slice(0, activeForecastHours);
    const labels = sliced.map(r => r.time);
    const values = sliced.map(r => r.pressure_hpa);

    // Find the data point closest to "now"
    const now = Date.now();
    let nowIndex = 0;
    let minDiff = Infinity;
    sliced.forEach((d, i) => {
      const diff = Math.abs(new Date(d.time).getTime() - now);
      if (diff < minDiff) { minDiff = diff; nowIndex = i; }
    });

    const pointRadii = values.map((_, i) => i === nowIndex ? 5 : 0);
    const pointColors = values.map((_, i) => i === nowIndex ? "#fff" : "transparent");
    const pointBorders = values.map((_, i) => i === nowIndex ? "#4fc3f7" : "transparent");

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
          label: "Forecast Pressure (hPa)",
          data: values,
          borderColor: "#4fc3f7",
          backgroundColor: "rgba(79,195,247,0.1)",
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
  } catch {
    console.error("Failed to load forecast");
  }
}

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

    const url = `${ARCHIVE_URL}?latitude=${LAT}&longitude=${LON}&hourly=surface_pressure&timezone=Europe%2FBerlin&start_date=${fmt(start)}&end_date=${fmt(end)}`;
    const r = await fetch(url);
    const data = await r.json();
    const times = data.hourly?.time ?? [];
    const pressures = data.hourly?.surface_pressure ?? [];
    const series = times.map((t, i) => ({ time: t, pressure_hpa: pressures[i] }))
      .filter(d => d.pressure_hpa != null);

    const labels = series.map(r => r.time);
    const values = series.map(r => r.pressure_hpa);

    if (chart) chart.destroy();
    chart = new Chart(document.getElementById("chart"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Pressure (hPa)",
          data: values,
          borderColor: "#4fc3f7",
          backgroundColor: "rgba(79,195,247,0.1)",
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
  } catch {
    console.error("Failed to load history");
  }
}

document.getElementById("forecast-buttons").addEventListener("click", e => {
  if (e.target.dataset.hours) loadForecast(Number(e.target.dataset.hours));
});

document.getElementById("range-buttons").addEventListener("click", e => {
  if (e.target.dataset.range) loadHistory(e.target.dataset.range);
});

loadCurrent();
loadForecast();
loadHistory("1w");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
