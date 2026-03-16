# Berlin Pressure Monitor

Real-time barometric pressure monitor for Berlin with forecast and historical data. Built as a client-side PWA — no backend required. Hosted on GitHub Pages.

**Live:** https://vigneshsrinivasan10.github.io/pressure-monitor/

## Stack

- **Frontend:** Vanilla JS + Chart.js (client-side only)
- **Data:** [Open-Meteo API](https://open-meteo.com/) called directly from the browser (CORS-friendly)
- **Hosting:** GitHub Pages

## Features

- Current pressure + tomorrow's forecast + trend indicator
- Hourly forecast chart (1D / 3D / 1W / 2W)
- Historical chart (1W / 1M / 3M / 6M / 1Y)
- Installable PWA with offline shell caching

## Install as Android App

1. Open the live URL in Chrome on Android
2. Tap menu (⋮) → **Add to Home Screen**
3. App runs fullscreen like a native app

## Local Development

```bash
npx serve
```
