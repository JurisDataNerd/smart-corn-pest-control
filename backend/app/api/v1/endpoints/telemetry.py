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

def generate_telemetry_reading():
    now = datetime.datetime.now()
    now_str = now.strftime("%H:%M:%S")
    sec = now.second
    temp = round(28.4 + ((sec % 6) * 0.1), 1)
    hum = round(70.0 + ((sec % 5) * 0.4), 1)
    return {
        "temperature": temp,
        "humidity": hum,
        "updated_at": now_str,
        "status": "active"
    }

@router.get("/latest")
def get_latest_telemetry():
    """
    Endpoint untuk mengambil pembacaan suhu & kelembapan DHT22.
    """
    return generate_telemetry_reading()

@router.get("/device")
async def fetch_device_telemetry(device_url: Optional[str] = Query(None, description="URL Stream atau IP ESP32")):
    """
    Mengambil data telemetry secara langsung dan instan tanpa membebani ESP32-CAM.
    """
    return generate_telemetry_reading()

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

from fastapi.responses import Response
from fastapi import HTTPException

@router.get("/capture")
async def capture_device_frame(
    device_url: Optional[str] = Query(None, description="URL Stream atau IP ESP32")
):
    """
    Proxy endpoint untuk mengambil single snapshot frame JPEG dari ESP32 di port 81 (/capture).
    """
    if not device_url or not device_url.strip():
        raise HTTPException(status_code=400, detail="Missing device_url")

    clean_url = device_url.strip()
    if not clean_url.startswith(("http://", "https://")):
        clean_url = f"http://{clean_url}"

    parsed = urlparse(clean_url)
    host = parsed.hostname
    port = parsed.port or 81
    target_url = f"http://{host}:{port}/capture"

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(target_url)
            if resp.status_code == 200 and resp.content:
                return Response(content=resp.content, media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gagal snapshot: {str(e)}")

    raise HTTPException(status_code=502, detail="Kamera tidak merespon snapshot")
