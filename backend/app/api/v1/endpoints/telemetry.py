from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional
import datetime
from urllib.parse import urlparse
import httpx

router = APIRouter()

class TelemetryPayload(BaseModel):
    temperature: float
    humidity: float

# Simpan pembacaan sensor terakhir di memori (dimulai kosong/None, bukan nilai statis)
latest_sensor_data = {
    "temperature": None,
    "humidity": None,
    "updated_at": None,
    "status": "waiting"
}

@router.post("")
def receive_telemetry(payload: TelemetryPayload):
    """
    Endpoint untuk menerima data suhu & kelembapan dari ESP32 + DHT22.
    Format JSON: {"temperature": 28.5, "humidity": 70.2}
    """
    global latest_sensor_data
    latest_sensor_data = {
        "temperature": round(payload.temperature, 1),
        "humidity": round(payload.humidity, 1),
        "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
        "status": "active"
    }
    return {"status": "success", "data": latest_sensor_data}

@router.get("/latest")
def get_latest_telemetry():
    """
    Endpoint untuk mengambil pembacaan suhu & kelembapan terakhir dari sensor DHT22.
    """
    return latest_sensor_data

@router.get("/device")
async def fetch_device_telemetry(device_url: Optional[str] = Query(None, description="URL Stream atau IP ESP32")):
    """
    Proxy endpoint untuk mengambil telemetry langsung dari ESP32 di port 81 (/telemetry).
    Menghindari blokir CORS / Private Network Access (PNA) di browser.
    """
    global latest_sensor_data
    if not device_url or not device_url.strip():
        return latest_sensor_data

    clean_url = device_url.strip()
    if not clean_url.startswith(("http://", "https://")):
        clean_url = f"http://{clean_url}"

    try:
        parsed = urlparse(clean_url)
        host = parsed.hostname
        port = parsed.port or 81
        if not host:
            return latest_sensor_data

        target_url = f"http://{host}:{port}/telemetry"

        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(target_url)
            if resp.status_code == 200:
                data = resp.json()
                temp = data.get("temperature")
                hum = data.get("humidity")
                if temp is not None and hum is not None:
                    latest_sensor_data = {
                        "temperature": round(float(temp), 1),
                        "humidity": round(float(hum), 1),
                        "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
                        "status": "active"
                    }
                    return latest_sensor_data
    except Exception:
        pass

    return latest_sensor_data

@router.get("/flash")
async def toggle_device_flash(
    device_url: Optional[str] = Query(None, description="URL Stream atau IP ESP32"),
    state: str = Query("on", description="on atau off")
):
    """
    Proxy endpoint untuk mengontrol LED Flash di ESP32 port 81 (/flash?state=on/off).
    """
    if not device_url or not device_url.strip():
        return {"flash": "unknown"}

    clean_url = device_url.strip()
    if not clean_url.startswith(("http://", "https://")):
        clean_url = f"http://{clean_url}"

    try:
        parsed = urlparse(clean_url)
        host = parsed.hostname
        port = parsed.port or 81
        if not host:
            return {"flash": "unknown"}

        target_url = f"http://{host}:{port}/flash?state={state}"

        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(target_url)
            if resp.status_code == 200:
                return resp.json()
    except Exception:
        pass

    return {"flash": state}
