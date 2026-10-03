from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status
from typing import Optional

from backend.app.schemas.detection import DetectionResponse
from backend.app.services.pest_detector import SmartTrapVisionEngine

router = APIRouter()
vision_engine = SmartTrapVisionEngine()

@router.post("", response_model=DetectionResponse, summary="Analyze uploaded image for pests in real-time (In-Memory)")
async def detect_pests_from_upload(
    file: UploadFile = File(..., description="High-resolution image file (.jpg, .png)"),
    trap_id: Optional[str] = Form(None, description="Optional manual ID override"),
    enable_ocr: bool = Form(False, description="Whether to run OCR for tags and markers"),
    confidence_threshold: float = Form(0.25, description="Detection confidence threshold")
):
    """
    Deteksi hama langsung saat ini dari foto/gambar tanpa menyimpan ke database.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File provided must be an image (JPEG, PNG, WebP)"
        )

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty image payload")

    try:
        # Run computer vision pipeline (in-memory)
        result = vision_engine.process_image(
            image_bytes=image_bytes,
            trap_id=trap_id,
            enable_ocr=enable_ocr,
            confidence_threshold=confidence_threshold,
            save_annotated=True,
            source_type="image_upload"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")

    # Langsung kembalikan hasil deteksi saat ini tanpa menyimpan ke database
    return result
