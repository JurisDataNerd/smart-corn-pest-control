from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
import base64
import time
import json
import cv2
import numpy as np

from backend.app.schemas.detection import StreamFrameRequest, DetectionResponse
from backend.app.services.pest_detector import SmartTrapVisionEngine

router = APIRouter()
vision_engine = SmartTrapVisionEngine()

@router.post("/frame", response_model=DetectionResponse, summary="Process a single camera frame (base64) for real-time HUD")
async def process_camera_frame(req: StreamFrameRequest):
    """Fast in-memory processing for webcam / mobile camera frames."""
    try:
        # Strip header if data URI is sent (e.g. data:image/jpeg;base64,...)
        payload = req.frame_base64
        if "," in payload:
            payload = payload.split(",", 1)[1]
            
        frame_bytes = base64.b64decode(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Base64 frame data")

    try:
        result = vision_engine.process_image(
            image_bytes=frame_bytes,
            trap_id=req.trap_id,
            enable_ocr=req.enable_ocr,
            confidence_threshold=req.confidence_threshold or 0.35,
            save_annotated=False,
            source_type="camera_stream"
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Streaming inference error: {str(e)}")

@router.websocket("/ws")
async def websocket_stream_endpoint(websocket: WebSocket):
    """
    High-frequency WebSocket endpoint for live camera streams.
    Receives JSON payload with { "frame": base64_str, "enable_ocr": bool }
    Sends back real-time detection boxes, species counts, and IPM risk level.
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            req_data = json.loads(data)
            frame_b64 = req_data.get("frame", "")
            enable_ocr = req_data.get("enable_ocr", False)
            trap_id = req_data.get("trap_id")

            if "," in frame_b64:
                frame_b64 = frame_b64.split(",", 1)[1]

            frame_bytes = base64.b64decode(frame_b64)
            result = vision_engine.process_image(
                image_bytes=frame_bytes,
                trap_id=trap_id,
                enable_ocr=enable_ocr,
                save_annotated=False,
                source_type="camera_stream"
            )

            await websocket.send_text(result.model_dump_json())
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"status": "error", "message": str(e)}))
            await websocket.close()
        except Exception:
            pass
