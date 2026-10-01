import cv2
import numpy as np
import uuid
import time
from pathlib import Path
from typing import List, Dict, Tuple, Any, Optional

from backend.app.core.config import settings
from backend.app.core.ipm_rules import IPMAdvisor, RiskLevel
from backend.app.services.ocr_service import TrapOCRService
from backend.app.schemas.detection import DetectionBox, DetectionSummary, OCRMetadata, DetectionResponse

# Palette of distinct bounding box colors
CLASS_COLORS = {
    "Asian-Corn-Borer": (0, 200, 255),      # Kuning Terang di BGR
    "Bollworm": (0, 140, 255),              # Oranye di BGR
    "Fall-Armyworm": (0, 220, 0),           # Hijau di BGR
    "Rat": (255, 50, 50),                   # Merah/Biru di BGR
}

class SmartTrapVisionEngine:
    """
    Pure Deep Learning YOLO Object Detection Engine for Corn Pests & Rodents:
    - 0: Asian-Corn-Borer (Penggerek Batang Jagung)
    - 1: Bollworm (Ulat Tongkol Jagung)
    - 2: Fall-Armyworm (Ulat Grayak Jagung)
    - 3: Rat (Hama Tikus)
    """

    def __init__(self):
        self.ocr_service = TrapOCRService()
        self.yolo_model = None
        self._load_yolo()

    def _load_yolo(self):
        weights_paths = [
            settings.WEIGHTS_DIR / "corn_pest_yolo.pt",
            settings.WEIGHTS_DIR / "corn_and_rat_yolo_4cls/weights/best.pt",
            settings.WEIGHTS_DIR / "corn_pest_yolo_3cls/weights/best.pt",
            settings.WEIGHTS_DIR / "best.pt"
        ]
        for wp in weights_paths:
            if wp.exists():
                try:
                    from ultralytics import YOLO
                    self.yolo_model = YOLO(str(wp))
                    print(f"[SmartTrapVisionEngine] Loaded pure YOLO model from {wp}!")
                    print(f"[SmartTrapVisionEngine] Model classes: {self.yolo_model.names}")
                    break
                except Exception as e:
                    print(f"[SmartTrapVisionEngine] Could not load YOLO weights at {wp}: {e}")

        if self.yolo_model is None:
            from ultralytics import YOLO
            self.yolo_model = YOLO("yolov8n.pt")
            print("[SmartTrapVisionEngine] Initialized baseline YOLO detector.")

    def process_image(
        self,
        image_bytes: bytes,
        trap_id: Optional[str] = None,
        enable_ocr: bool = False,
        confidence_threshold: float = settings.CONFIDENCE_THRESHOLD,
        save_annotated: bool = True,
        source_type: str = "image_upload"
    ) -> DetectionResponse:
        start_time = time.time()
        
        # Decode image
        nparr = np.frombuffer(image_bytes, np.uint8)
        image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image_bgr is None:
            raise ValueError("Format gambar tidak valid atau rusak")

        # Resize if dimensions exceed max
        h, w = image_bgr.shape[:2]
        if max(h, w) > settings.MAX_IMAGE_DIMENSION:
            scale = settings.MAX_IMAGE_DIMENSION / max(h, w)
            image_bgr = cv2.resize(image_bgr, (int(w * scale), int(h * scale)))
            h, w = image_bgr.shape[:2]

        total_frame_area = float(w * h)

        # 1. OCR & Trap Metadata (if requested)
        ocr_meta = OCRMetadata()
        if enable_ocr:
            ocr_result = self.ocr_service.scan_trap(image_bgr)
            ocr_meta = OCRMetadata(
                detected_trap_id=ocr_result.get("detected_trap_id"),
                raw_text=ocr_result.get("raw_text"),
                confidence=ocr_result.get("confidence", 0.0),
                detected_qr=ocr_result.get("detected_qr"),
                grid_quadrants_found=ocr_result.get("grid_quadrants_found", 0),
                grid_detected=ocr_result.get("grid_detected", False)
            )
            if not trap_id and ocr_meta.detected_trap_id:
                trap_id = ocr_meta.detected_trap_id

        # 2. Pure End-to-End YOLO Object Detection with Background Rejection
        detections: List[DetectionBox] = []
        species_counts: Dict[str, int] = {cls_name: 0 for cls_name in settings.TARGET_CLASSES}
        
        effective_conf = max(0.35, confidence_threshold)
        yolo_preds = self.yolo_model.predict(image_bgr, conf=effective_conf, verbose=False)
        
        if yolo_preds and len(yolo_preds) > 0:
            boxes = yolo_preds[0].boxes
            for idx, box in enumerate(boxes):
                xyxy = box.xyxy[0].cpu().numpy().tolist()
                cls_idx = int(box.cls[0].item())
                conf_val = float(box.conf[0].item())
                class_name = self.yolo_model.names.get(cls_idx, f"Pest_{cls_idx}")
                
                xmin, ymin, xmax, ymax = map(float, xyxy)
                bw = xmax - xmin
                bh = ymax - ymin
                box_area = bw * bh
                
                # Filter full-screen background noise
                if (box_area / total_frame_area) > 0.82 and conf_val < 0.65:
                    continue

                quadrant = self._calculate_quadrant(int(xmin), int(ymin), int(xmax), int(ymax), w, h)
                
                det = DetectionBox(
                    id=f"det_{idx+1:03d}",
                    class_name=class_name,
                    confidence=round(conf_val, 3),
                    box_xyxy=[xmin, ymin, xmax, ymax],
                    quadrant=quadrant
                )
                detections.append(det)
                species_counts[class_name] = species_counts.get(class_name, 0) + 1

        active_counts = {k: v for k, v in species_counts.items() if v > 0}
        total_pests = sum(active_counts.values())

        # 3. IPM Agronomic Evaluation
        risk_level, action_recommendation, ipm_meta = IPMAdvisor.evaluate(active_counts)

        # 4. Image Annotation & Rendering
        image_url = None
        annotated_image_url = None
        
        if save_annotated:
            unique_id = uuid.uuid4().hex[:10]
            raw_filename = f"raw_{unique_id}.jpg"
            ann_filename = f"ann_{unique_id}.jpg"
            
            raw_path = settings.UPLOAD_DIR / raw_filename
            ann_path = settings.UPLOAD_DIR / ann_filename
            
            cv2.imwrite(str(raw_path), image_bgr)
            
            annotated_bgr = self._render_annotations(
                image_bgr.copy(),
                detections,
                ocr_meta,
                risk_level.value,
                total_pests,
                trap_id
            )
            cv2.imwrite(str(ann_path), annotated_bgr)
            
            image_url = f"/uploads/{raw_filename}"
            annotated_image_url = f"/uploads/{ann_filename}"

        elapsed_ms = round((time.time() - start_time) * 1000, 2)

        summary = DetectionSummary(
            total_pests=total_pests,
            species_counts=active_counts,
            ipm_risk_level=risk_level.value,
            ipm_action_recommended=action_recommendation,
            saturation_pct=ipm_meta.get("saturation_pct", 0.0),
            highest_risk_species=ipm_meta.get("highest_risk_species")
        )

        return DetectionResponse(
            status="success",
            trap_id=trap_id or (ocr_meta.detected_trap_id if ocr_meta and ocr_meta.detected_trap_id else "LAHAN-01"),
            source_type=source_type,
            image_url=image_url,
            annotated_image_url=annotated_image_url,
            trap_metadata=ocr_meta,
            summary=summary,
            detections=detections,
            processing_time_ms=elapsed_ms
        )

    def _calculate_quadrant(self, xmin: int, ymin: int, xmax: int, ymax: int, img_w: int, img_h: int) -> str:
        cx = (xmin + xmax) / 2.0
        cy = (ymin + ymax) / 2.0
        col_idx = min(3, int((cx / img_w) * 4))
        row_idx = min(3, int((cy / img_h) * 4))
        col_letters = ["A", "B", "C", "D"]
        return f"{col_letters[col_idx]}{row_idx + 1}"

    def _render_annotations(
        self,
        image_bgr: np.ndarray,
        detections: List[DetectionBox],
        ocr_meta: OCRMetadata,
        risk_level: str,
        total_pests: int,
        trap_id: Optional[str]
    ) -> np.ndarray:
        h, w = image_bgr.shape[:2]
        
        indonesian_names = {
            "Asian-Corn-Borer": "Penggerek Batang",
            "Bollworm": "Ulat Tongkol",
            "Fall-Armyworm": "Ulat Grayak",
            "Rat": "Tikus"
        }

        for det in detections:
            xmin, ymin, xmax, ymax = map(int, det.box_xyxy)
            color = CLASS_COLORS.get(det.class_name, (0, 165, 255))
            
            # Box outline
            cv2.rectangle(image_bgr, (xmin, ymin), (xmax, ymax), color, 3)
            
            # Label badge
            p_name = indonesian_names.get(det.class_name, det.class_name)
            label = f"{p_name} ({int(det.confidence * 100)}%)"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.55
            thickness = 2
            (tw, th), baseline = cv2.getTextSize(label, font, font_scale, thickness)
            
            badge_y = max(th + 8, ymin - 6)
            cv2.rectangle(image_bgr, (xmin, badge_y - th - 6), (xmin + tw + 10, badge_y + baseline + 2), color, -1)
            cv2.putText(image_bgr, label, (xmin + 5, badge_y - 2), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

        # Top HUD Banner
        hud_h = 44
        hud_overlay = image_bgr.copy()
        cv2.rectangle(hud_overlay, (0, 0), (w, hud_h), (20, 24, 30), -1)
        cv2.addWeighted(hud_overlay, 0.85, image_bgr, 0.15, 0, image_bgr)
        
        risk_colors = {
            "LOW": (0, 200, 0),
            "MEDIUM": (0, 215, 255),
            "HIGH": (0, 140, 255),
            "CRITICAL": (0, 0, 230)
        }
        r_col = risk_colors.get(risk_level, (255, 255, 255))
        
        if detections:
            top_p = indonesian_names.get(detections[0].class_name, detections[0].class_name)
            conf_int = int(detections[0].confidence * 100)
            hud_text = f"DETEKSI HAMA: {top_p} ({conf_int}%) | TOTAL: {total_pests} SASARAN"
        else:
            hud_text = "STATUS: TANAMAN BERSIH / TIDAK DITEMUKAN HAMA"
            
        cv2.putText(image_bgr, hud_text, (16, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.circle(image_bgr, (w - 24, 22), 8, r_col, -1)

        return image_bgr
