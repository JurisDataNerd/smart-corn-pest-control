from fastapi import APIRouter
from backend.app.api.v1.endpoints import detect, ocr, stream, traps, telemetry

api_router = APIRouter()

api_router.include_router(detect.router, prefix="/detect", tags=["Pest Detection & Upload"])
api_router.include_router(ocr.router, prefix="/ocr", tags=["Smart Trap OCR Scanner"])
api_router.include_router(stream.router, prefix="/stream", tags=["Live Camera Stream"])
api_router.include_router(traps.router, prefix="/traps", tags=["Trap Registry & IPM Analytics"])
api_router.include_router(telemetry.router, prefix="/telemetry", tags=["Sensor DHT22 Telemetry"])
