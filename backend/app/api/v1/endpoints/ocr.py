from fastapi import APIRouter, UploadFile, File, HTTPException
import cv2
import numpy as np
import time

from backend.app.schemas.detection import OCRScanResponse
from backend.app.services.ocr_service import TrapOCRService

router = APIRouter()
ocr_service = TrapOCRService()

@router.post("", response_model=OCRScanResponse, summary="Perform standalone OCR and QR code scan on trap tag")
async def scan_trap_ocr(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Provided file must be an image")

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty image data")

    start_time = time.time()
    nparr = np.frombuffer(image_bytes, np.uint8)
    image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    result = ocr_service.scan_trap(image_bgr)
    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    raw_text = result.get("raw_text", "")
    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]

    return OCRScanResponse(
        status="success",
        trap_id=result.get("detected_trap_id"),
        raw_lines=lines,
        qr_payload=result.get("detected_qr"),
        confidence=result.get("confidence", 0.0),
        grid_detected=result.get("grid_detected", False),
        processing_time_ms=elapsed_ms
    )
