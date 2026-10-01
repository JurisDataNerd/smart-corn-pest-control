import { DetectionResponse, TrapDetail, TrapAnalytics, TelemetryData } from '../types';

const API_BASE = '/api/v1';

export async function detectFromImage(
  file: File | Blob,
  trapId?: string,
  enableOcr: boolean = true,
  confidenceThreshold: number = 0.35
): Promise<DetectionResponse> {
  const formData = new FormData();
  formData.append('file', file, 'trap_photo.jpg');
  if (trapId) formData.append('trap_id', trapId);
  formData.append('enable_ocr', String(enableOcr));
  formData.append('confidence_threshold', String(confidenceThreshold));

  const res = await fetch(`${API_BASE}/detect`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Network error during detection' }));
    throw new Error(err.detail || 'Detection failed');
  }

  return res.json();
}

export async function processStreamFrame(
  frameBase64: string,
  trapId?: string,
  enableOcr: boolean = false,
  confidenceThreshold: number = 0.35
): Promise<DetectionResponse> {
  const res = await fetch(`${API_BASE}/stream/frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame_base64: frameBase64,
      trap_id: trapId,
      enable_ocr: enableOcr,
      confidence_threshold: confidenceThreshold,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Stream inference error' }));
    throw new Error(err.detail || 'Stream processing failed');
  }

  return res.json();
}

export async function fetchTraps(): Promise<TrapDetail[]> {
  const res = await fetch(`${API_BASE}/traps`);
  if (!res.ok) throw new Error('Failed to fetch traps');
  return res.json();
}

export async function fetchTrapAnalytics(): Promise<TrapAnalytics> {
  const res = await fetch(`${API_BASE}/traps/analytics/overview`);
  if (!res.ok) throw new Error('Failed to fetch analytics');
  return res.json();
}

export async function fetchLatestTelemetry(): Promise<TelemetryData> {
  const res = await fetch(`${API_BASE}/telemetry/latest`);
  if (!res.ok) throw new Error('Failed to fetch telemetry');
  return res.json();
}
