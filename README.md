# Berlin Pressure Monitor

Real-time barometric pressure monitor for Berlin with forecast and historical data. Built as a PWA — installable on Android and desktop.

## Stack

- **Backend:** FastAPI + [Open-Meteo API](https://open-meteo.com/)
- **Frontend:** Vanilla JS + Chart.js
- **Data:** Hourly surface pressure (current, forecast up to 2 weeks, history up to 1 year)

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000

## Install as Android App

1. Open the site in Chrome on Android
2. Tap menu (⋮) → **Add to Home Screen**
3. App runs fullscreen like a native app
