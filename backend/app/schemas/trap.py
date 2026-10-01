from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

class TrapBase(BaseModel):
    id: str = Field(..., description="Unique alphanumeric identifier (e.g. TRAP-GH-01)")
    name: str = Field(..., description="Descriptive name")
    location: str = Field(..., description="Physical greenhouse/field zone")
    crop_type: str = Field("Mixed Crops", description="Host crop species")
    trap_type: str = Field("Yellow Sticky Card", description="Physical trap format")
    status: str = Field("active", description="active, needs_replacement, archived")

class TrapCreate(TrapBase):
    pass

class TrapUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    crop_type: Optional[str] = None
    trap_type: Optional[str] = None
    status: Optional[str] = None

class InspectionLogItem(BaseModel):
    id: int
    trap_id: Optional[str]
    captured_at: datetime
    source_type: str
    image_url: Optional[str]
    annotated_image_url: Optional[str]
    total_pests: int
    risk_level: str
    primary_action: Optional[str]
    species_counts: Dict[str, int]
    ocr_detected_id: Optional[str]

    class Config:
        from_attributes = True

class TrapDetail(TrapBase):
    created_at: datetime
    last_inspection_at: Optional[datetime]
    recent_inspections: List[InspectionLogItem] = []

    class Config:
        from_attributes = True

class TrapAnalytics(BaseModel):
    total_traps: int
    active_traps: int
    critical_traps: int
    total_pests_monitored: int
    top_pest_species: Dict[str, int]
    species_trend: List[Dict[str, Any]]
    recent_alerts: List[Dict[str, Any]]
