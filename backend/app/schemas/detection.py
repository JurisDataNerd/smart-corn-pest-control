from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field

class DetectionBox(BaseModel):
    id: str = Field(..., description="Unique detection identifier")
    class_name: str = Field(..., description="Pest or disease category")
    confidence: float = Field(..., description="Classification / detection confidence score between 0 and 1")
    box_xyxy: List[float] = Field(..., description="Bounding box [xmin, ymin, xmax, ymax]")
    quadrant: Optional[str] = Field(None, description="Trap quadrant grid coordinate (e.g. A1, B2)")

class OCRMetadata(BaseModel):
    detected_trap_id: Optional[str] = None
    raw_text: Optional[str] = None
    confidence: float = 0.0
    detected_qr: Optional[str] = None
    grid_quadrants_found: int = 0
    grid_detected: bool = False

class DetectionSummary(BaseModel):
    total_pests: int
    species_counts: Dict[str, int]
    ipm_risk_level: str
    ipm_action_recommended: str
    saturation_pct: float
    highest_risk_species: Optional[str] = None

class DetectionResponse(BaseModel):
    status: str = "success"
    inspection_id: Optional[int] = None
    trap_id: Optional[str] = None
    source_type: str = "image_upload"
    image_url: Optional[str] = None
    annotated_image_url: Optional[str] = None
    trap_metadata: OCRMetadata
    summary: DetectionSummary
    detections: List[DetectionBox]
    processing_time_ms: float

class StreamFrameRequest(BaseModel):
    frame_base64: str = Field(..., description="Base64 encoded JPEG/PNG frame")
    trap_id: Optional[str] = None
    enable_ocr: bool = False
    confidence_threshold: Optional[float] = 0.35

class OCRScanResponse(BaseModel):
    status: str = "success"
    trap_id: Optional[str] = None
    raw_lines: List[str] = []
    qr_payload: Optional[str] = None
    confidence: float = 0.0
    grid_detected: bool = False
    processing_time_ms: float
