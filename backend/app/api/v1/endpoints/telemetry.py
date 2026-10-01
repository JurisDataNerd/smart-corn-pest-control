from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import datetime

router = APIRouter()

class TelemetryPayload(BaseModel):
    trap_id: Optional[str] = "LAHAN-01"
    temperature: float
    humidity: float

# Simpan pembacaan sensor terakhir di memori
latest_sensor_data = {
    "temperature": 29.4,
    "humidity": 72.5,
    "trap_id": "LAHAN-01",
    "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
    "status": "ready"
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
        "trap_id": payload.trap_id or "LAHAN-01",
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
