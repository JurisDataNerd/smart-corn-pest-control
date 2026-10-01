import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship
from backend.app.db.session import Base

class Trap(Base):
    __tablename__ = "traps"
    
    id = Column(String(64), primary_key=True, index=True) # e.g. TRAP-GH-01
    name = Column(String(128), nullable=False)
    location = Column(String(256), nullable=False)
    crop_type = Column(String(128), default="Mixed Vegetables")
    trap_type = Column(String(128), default="Yellow Sticky Card")
    status = Column(String(32), default="active") # active, needs_replacement, archived
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_inspection_at = Column(DateTime, nullable=True)
    
    inspections = relationship("InspectionLog", back_populates="trap", cascade="all, delete-orphan", order_by="desc(InspectionLog.captured_at)")

class InspectionLog(Base):
    __tablename__ = "inspection_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    trap_id = Column(String(64), ForeignKey("traps.id"), index=True, nullable=True)
    captured_at = Column(DateTime, default=datetime.datetime.utcnow)
    source_type = Column(String(32), default="image_upload") # image_upload, camera_stream
    image_url = Column(String(512), nullable=True)
    annotated_image_url = Column(String(512), nullable=True)
    
    total_pests = Column(Integer, default=0)
    risk_level = Column(String(32), default="LOW") # LOW, MEDIUM, HIGH, CRITICAL
    primary_action = Column(Text, nullable=True)
    
    # OCR Data
    ocr_detected_id = Column(String(128), nullable=True)
    ocr_raw_text = Column(Text, nullable=True)
    ocr_confidence = Column(Float, nullable=True)
    
    # Detailed counts and coordinates
    species_counts = Column(JSON, default=dict)
    detections_json = Column(JSON, default=list) # [{id, class_name, confidence, box_xyxy, quadrant}]
    metrics_json = Column(JSON, default=dict)
    
    trap = relationship("Trap", back_populates="inspections")
