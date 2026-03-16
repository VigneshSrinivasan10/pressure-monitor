from datetime import date, timedelta

import httpx
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles

BERLIN_LAT = 52.52
BERLIN_LON = 13.41
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

RANGE_DAYS = {
    "1w": 7,
    "1m": 30,
    "3m": 90,
    "6m": 180,
    "1y": 365,
}

app = FastAPI()


async def fetch_pressure() -> dict:
    params = {
        "latitude": BERLIN_LAT,
        "longitude": BERLIN_LON,
        "current": "surface_pressure",
        "daily": "surface_pressure_mean",
        "timezone": "Europe/Berlin",
        "forecast_days": 2,
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(OPEN_METEO_URL, params=params)
        r.raise_for_status()
        return r.json()


@app.get("/api/current")
async def current_pressure():
    data = await fetch_pressure()
    current = data["current"]["surface_pressure"]
    daily = data.get("daily", {})
    dates = daily.get("time", [])
    means = daily.get("surface_pressure_mean", [])

    today_mean = means[0] if len(means) > 0 else None
    tomorrow_mean = means[1] if len(means) > 1 else None

    trend = None
    if today_mean is not None and tomorrow_mean is not None:
        diff = tomorrow_mean - today_mean
        if diff > 1:
            trend = "rising"
        elif diff < -1:
            trend = "falling"
        else:
            trend = "stable"

    return {
        "current_hpa": current,
        "today_date": dates[0] if dates else None,
        "today_mean": today_mean,
        "tomorrow_date": dates[1] if len(dates) > 1 else None,
        "tomorrow_mean": tomorrow_mean,
        "trend": trend,
    }


@app.get("/api/history")
async def history(range: str = Query("1m")):
    days = RANGE_DAYS.get(range)
    if days is None:
        return {"error": f"Invalid range. Use one of: {', '.join(RANGE_DAYS)}"}

    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=days)

    params = {
        "latitude": BERLIN_LAT,
        "longitude": BERLIN_LON,
        "hourly": "surface_pressure",
        "timezone": "Europe/Berlin",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(ARCHIVE_URL, params=params)
        r.raise_for_status()
        data = r.json()

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    pressures = hourly.get("surface_pressure", [])

    return [
        {"time": t, "pressure_hpa": p}
        for t, p in zip(times, pressures)
        if p is not None
    ]


@app.get("/api/forecast")
async def forecast():
    params = {
        "latitude": BERLIN_LAT,
        "longitude": BERLIN_LON,
        "hourly": "surface_pressure",
        "timezone": "Europe/Berlin",
        "forecast_days": 16,
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(OPEN_METEO_URL, params=params)
        r.raise_for_status()
        data = r.json()

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    pressures = hourly.get("surface_pressure", [])

    return [
        {"time": t, "pressure_hpa": p}
        for t, p in zip(times, pressures)
        if p is not None
    ]


app.mount("/", StaticFiles(directory="static", html=True), name="static")
