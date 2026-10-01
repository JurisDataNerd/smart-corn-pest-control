from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import Optional

from backend.app.db.session import get_db
from backend.app.models.trap import Trap, InspectionLog
from backend.app.schemas.detection import DetectionResponse
from backend.app.services.pest_detector import SmartTrapVisionEngine

router = APIRouter()
vision_engine = SmartTrapVisionEngine()

@router.post("", response_model=DetectionResponse, summary="Analyze uploaded trap image for pests & OCR metadata")
async def detect_pests_from_upload(
    file: UploadFile = File(..., description="High-resolution image file (.jpg, .png)"),
    trap_id: Optional[str] = Form(None, description="Optional manual Trap ID override"),
    enable_ocr: bool = Form(True, description="Whether to run OCR for trap tags and grid markers"),
    confidence_threshold: float = Form(0.35, description="Detection confidence threshold"),
    db: AsyncSession = Depends(get_db)
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File provided must be an image (JPEG, PNG, WebP)"
        )

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty image payload")

    try:
        # Run computer vision and OCR pipeline
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

    effective_trap_id = result.trap_id

    # Auto-register or update Trap record in Database
    if effective_trap_id:
        stmt = select(Trap).where(Trap.id == effective_trap_id)
        res = await db.execute(stmt)
        trap_obj = res.scalar_one_or_none()

        if not trap_obj:
            trap_obj = Trap(
                id=effective_trap_id,
                name=f"Titik {effective_trap_id}",
                location="Lahan Jagung",
                crop_type="Jagung Pakan",
                trap_type="Perangkap Feromon",
                status="active"
            )
            db.add(trap_obj)

        # Log this inspection
        inspection = InspectionLog(
            trap_id=effective_trap_id,
            source_type="image_upload",
            image_url=result.image_url,
            annotated_image_url=result.annotated_image_url,
            total_pests=result.summary.total_pests,
            risk_level=result.summary.ipm_risk_level,
            primary_action=result.summary.ipm_action_recommended,
            ocr_detected_id=result.trap_metadata.detected_trap_id,
            ocr_raw_text=result.trap_metadata.raw_text,
            ocr_confidence=result.trap_metadata.confidence,
            species_counts=result.summary.species_counts,
            detections_json=[d.model_dump() for d in result.detections]
        )
        db.add(inspection)
        await db.commit()
        await db.refresh(inspection)
        result.inspection_id = inspection.id

    return result
