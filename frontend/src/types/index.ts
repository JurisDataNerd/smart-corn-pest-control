export interface DetectionBox {
  id: string;
  class_name: string;
  confidence: number;
  box_xyxy: [number, number, number, number];
  quadrant?: string;
}

export interface OCRMetadata {
  detected_trap_id?: string | null;
  raw_text?: string | null;
  confidence: number;
  detected_qr?: string | null;
  grid_quadrants_found: number;
  grid_detected: boolean;
}

export interface DetectionSummary {
  total_pests: number;
  species_counts: Record<string, number>;
  ipm_risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  ipm_action_recommended: string;
  saturation_pct: number;
  highest_risk_species?: string | null;
}

export interface DetectionResponse {
  status: string;
  inspection_id?: number | null;
  trap_id: string;
  source_type: 'image_upload' | 'camera_stream';
  image_url?: string | null;
  annotated_image_url?: string | null;
  trap_metadata: OCRMetadata;
  summary: DetectionSummary;
  detections: DetectionBox[];
  processing_time_ms: number;
}

export interface InspectionLogItem {
  id: number;
  trap_id?: string;
  captured_at: string;
  source_type: string;
  image_url?: string;
  annotated_image_url?: string;
  total_pests: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  primary_action?: string;
  species_counts: Record<string, number>;
  ocr_detected_id?: string;
}

export interface TrapDetail {
  id: string;
  name: string;
  location: string;
  crop_type: string;
  trap_type: string;
  status: 'active' | 'needs_replacement' | 'archived';
  created_at: string;
  last_inspection_at?: string | null;
  recent_inspections: InspectionLogItem[];
}

export interface TrapAnalytics {
  total_traps: number;
  active_traps: number;
  critical_traps: number;
  total_pests_monitored: number;
  top_pest_species: Record<string, number>;
  species_trend: Array<{ species: string; count: number }>;
  recent_alerts: Array<{
    trap_id?: string;
    timestamp?: string;
    risk_level: string;
    total_pests: number;
    action?: string;
  }>;
}

export interface TelemetryData {
  temperature: number | null;
  humidity: number | null;
  trap_id?: string;
  updated_at?: string | null;
  status?: string;
}
