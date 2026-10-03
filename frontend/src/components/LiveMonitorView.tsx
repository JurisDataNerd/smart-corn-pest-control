import React, { useState, useRef, useEffect } from "react";
import { Cctv, Wifi, WifiOff, Play, Square, RefreshCw, Bug, ShieldCheck, AlertTriangle, Settings2, Thermometer, Droplets, Bell, BellRing, Zap, ZapOff } from "lucide-react";
import { detectFromImage, fetchLatestTelemetry, fetchDeviceTelemetry, toggleDeviceFlash } from "../services/api";
import { DetectionResponse, TelemetryData } from "../types";
import { IPMAlertBanner } from "./IPMAlertBanner";
import { notifyPestDetected, notifyDHT22Alert, notifyTemperatureAlert, requestNotificationPermission, isNotificationGranted, sendSystemNotification } from "../services/notificationService";

const INDONESIAN_PEST_NAMES: Record<string, string> = {
  "Asian-Corn-Borer": "Penggerek Batang",
  "Corn Borers": "Penggerek Batang",
  Bollworm: "Ulat Tongkol",
  "Corn Earworms": "Ulat Tongkol",
  "Fall-Armyworm": "Ulat Grayak",
  "Fall Armyworms": "Ulat Grayak",
  Rat: "Hama Tikus",
};

// ==========================================
// KONFIGURASI CAPTURE
// ==========================================
const CAPTURE_COOLDOWN_MS = 4000; // Minimal 4 detik antar capture (ESP32 butuh istirahat)
const AUTO_DETECT_INTERVAL_MS = 20000; // Auto-scan tiap 20 detik (bukan 12)
const CAPTURE_TIMEOUT_MS = 8000; // Timeout capture (backend retry butuh waktu)
const DEFAULT_STREAM_URL = "http://192.168.11.186:81/stream"; // ← IP router, bukan hotspot

export const LiveMonitorView: React.FC = () => {
  const [streamUrl, setStreamUrl] = useState<string>(() => {
    const saved = localStorage.getItem("smart_trap_stream_url");
    // Auto-fix kalau masih pakai default lama (192.168.4.1 atau 192.168.1.100)
    if (!saved || saved.includes("192.168.1.100") || saved.includes("192.168.4.1")) {
      return DEFAULT_STREAM_URL;
    }
    return saved;
  });
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [autoDetect, setAutoDetect] = useState<boolean>(false);
  const [detectionResult, setDetectionResult] = useState<DetectionResponse | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    temperature: 28.5,
    humidity: 70.4,
    updated_at: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    status: "active",
  });
  const [notifGranted, setNotifGranted] = useState<boolean>(isNotificationGranted());
  const [flashOn, setFlashOn] = useState<boolean>(true);
  const [streamError, setStreamError] = useState<boolean>(false);
  const [espBusy, setEspBusy] = useState<boolean>(false); // ⚡ NEW: indikator busy

  const imgRef = useRef<HTMLImageElement>(null);
  const isDetectingRef = useRef<boolean>(false);
  const lastCaptureTimeRef = useRef<number>(0); // ⚡ NEW: cooldown tracker

  useEffect(() => {
    setNotifGranted(isNotificationGranted());
  }, []);

  // ==========================================
  // Helper: ubah URL /stream jadi /capture
  // ==========================================
  const deriveCaptureUrl = (url: string): string | null => {
    try {
      const u = new URL(url);
      u.pathname = u.pathname.replace(/\/stream\/?$/, "/capture");
      return u.toString();
    } catch {
      return null;
    }
  };

  // ==========================================
  // Helper: convert URL ke origin saja (untuk backend)
  // ==========================================
  const toOriginOnly = (url: string): string => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}`;
    } catch {
      return url;
    }
  };

  // ==========================================
  // AMBIL SNAPSHOT — HANYA VIA BACKEND PROXY
  // (Direct fetch ke ESP32 akan CORS block!)
  // ==========================================
  const fetchSnapshot = async (): Promise<Blob | null> => {
    const captureUrl = deriveCaptureUrl(streamUrl) || `${toOriginOnly(streamUrl)}/capture`;

    // Selalu lewat backend — backend punya retry + semaphore + mDNS resolve
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);

      const resp = await fetch(`/api/v1/telemetry/capture?device_url=${encodeURIComponent(captureUrl)}`, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timeoutId);

      if (resp.status === 502 || resp.status === 504) {
        setEspBusy(true);
        setTimeout(() => setEspBusy(false), 5000);
        console.warn(`[Capture] ESP32 busy (${resp.status})`);
        return null;
      }

      if (!resp.ok) {
        console.warn(`[Capture] Backend status: ${resp.status}`);
        return null;
      }

      const blob = await resp.blob();
      console.log(`[Capture] ✅ ${blob.size} bytes dari backend`);
      setEspBusy(false);
      return blob;
    } catch (err) {
      console.warn("[Capture] Backend fetch error:", err);
      return null;
    }
  };

  // ==========================================
  // FALLBACK: ambil frame dari <img> via canvas
  // (kalau backend gagal — paling reliable)
  // ==========================================
  const captureFromImgElement = async (): Promise<Blob | null> => {
    if (!imgRef.current || !imgRef.current.complete || imgRef.current.naturalWidth === 0) {
      return null;
    }
    try {
      const img = imgRef.current;
      const w = Math.min(img.naturalWidth, 640);
      const h = Math.min(img.naturalHeight, 480);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
    } catch (err) {
      console.warn("[Capture] Canvas fallback gagal:", err);
      return null;
    }
  };

  // ==========================================
  // RUN DETECTION — DENGAN RATE LIMIT
  // ==========================================
  const runDetectionOnFrame = async () => {
    if (!isConnected || isDetectingRef.current) return;

    // ⚡ RATE LIMIT — jangan spam ESP32
    const now = Date.now();
    const elapsed = now - lastCaptureTimeRef.current;
    if (elapsed < CAPTURE_COOLDOWN_MS) {
      const remaining = Math.ceil((CAPTURE_COOLDOWN_MS - elapsed) / 1000);
      console.log(`[Detect] Cooldown ${remaining}s — skip`);
      return;
    }
    lastCaptureTimeRef.current = now;

    isDetectingRef.current = true;
    setIsDetecting(true);

    try {
      let imageBlob: Blob | null = null;

      // Coba 1: Backend proxy (dengan retry + semaphore)
      imageBlob = await fetchSnapshot();

      // Coba 2: Fallback canvas dari <img> stream
      if (!imageBlob) {
        console.log("[Capture] Fallback ke canvas dari stream");
        imageBlob = await captureFromImgElement();
      }

      if (!imageBlob) {
        console.warn("[Detect] Tidak bisa dapat snapshot — ESP32 sibuk");
        setIsDetecting(false);
        isDetectingRef.current = false;
        return;
      }

      // Kirim ke backend /detect
      const res = await detectFromImage(imageBlob, undefined, false, 0.25);
      setDetectionResult(res);

      if (res.detections && res.detections.length > 0) {
        const topSpecies = res.detections[0].class_name;
        const translatedName = INDONESIAN_PEST_NAMES[topSpecies] || topSpecies;
        notifyPestDetected(translatedName, res.detections.length);
      }
    } catch (err) {
      console.warn("[Detect] Gagal:", err);
    } finally {
      isDetectingRef.current = false;
      setIsDetecting(false);
    }
  };

  // ==========================================
  // AUTO DETECT — interval lebih longgar (20s)
  // ==========================================
  useEffect(() => {
    if (!isConnected || !autoDetect) return;
    const timer = setInterval(() => {
      runDetectionOnFrame();
    }, AUTO_DETECT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isConnected, autoDetect]);

  // ==========================================
  // Normalisasi URL
  // ==========================================
  const normalizeStreamUrl = (raw: string): string => {
    let url = raw.trim();
    if (!url) return "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `http://${url}`;
    }
    if (!url.includes(":81") && !url.includes("/stream")) {
      url = `${url.replace(/\/+$/, "")}:81/stream`;
    } else if (!url.includes("/stream")) {
      url = `${url.replace(/\/+$/, "")}/stream`;
    }
    return url;
  };

  const handleStreamUrlChange = (val: string) => {
    setStreamUrl(val);
    localStorage.setItem("smart_trap_stream_url", val);
  };

  // ==========================================
  // TELEMETRY — via backend (biar mDNS resolve + fallback)
  // ==========================================
  useEffect(() => {
    let isMounted = true;

    const getTelemetry = async () => {
      if (!isConnected) return;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        // ⚡ Pakai backend /latest (yang fetch ke ESP32 + resolve mDNS)
        const origin = toOriginOnly(streamUrl);
        const resp = await fetch(`/api/v1/telemetry/latest?device_url=${encodeURIComponent(origin)}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data = await resp.json();

        if (isMounted && typeof data.temperature === "number" && data.temperature !== null) {
          const nowStr = new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });

          setTelemetry({
            temperature: data.temperature,
            humidity: data.humidity,
            updated_at: nowStr,
            status: "active",
          });

          notifyDHT22Alert(data.temperature, data.humidity);
        }
      } catch (err) {
        console.warn("[Telemetry] ESP32 tidak terjangkau:", err);
        // JANGAN generate fake data
      }
    };

    getTelemetry();
    const interval = setInterval(getTelemetry, 7000); // 7 detik

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isConnected, streamUrl]);

  const handleToggleNotification = async () => {
    const granted = await requestNotificationPermission();
    setNotifGranted(granted);
    if (granted) {
      sendSystemNotification("Notifikasi Smart Trap Aktif", "Peringatan otomatis aktif untuk deteksi hama kamera dan pemantauan sensor DHT22.", "test-notification");
    }
  };

  const handleToggleFlash = async () => {
    const nextState = !flashOn;
    setFlashOn(nextState);
    try {
      await toggleDeviceFlash(streamUrl, nextState ? "on" : "off");
    } catch (err) {
      console.warn("Gagal mengubah flash LED:", err);
    }
  };

  const handleConnect = () => {
    setConnectionError(null);
    setStreamError(false);
    setEspBusy(false);
    const normalized = normalizeStreamUrl(streamUrl);
    if (!normalized) {
      setConnectionError("Masukkan alamat IP ESP32-CAM terlebih dahulu.");
      return;
    }
    setStreamUrl(normalized);
    localStorage.setItem("smart_trap_stream_url", normalized);
    setIsConnected(true);
    setAutoDetect(false);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setStreamError(false);
    setAutoDetect(false);
    setDetectionResult(null);
    setConnectionError(null);
    setEspBusy(false);
  };

  const applyHotspotPreset = () => {
    setStreamUrl("http://192.168.4.1:81/stream");
    localStorage.setItem("smart_trap_stream_url", "http://192.168.4.1:81/stream");
  };

  const applyRouterPreset = () => {
    setStreamUrl(DEFAULT_STREAM_URL);
    localStorage.setItem("smart_trap_stream_url", DEFAULT_STREAM_URL);
  };

  const currentTemp = telemetry?.temperature ?? 28.5;
  const currentHum = telemetry?.humidity ?? 70.4;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Banner Panduan Koneksi */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
            <Wifi className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">Koneksi Kamera ESP32</h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Mode Station: pastikan laptop & ESP32 di <strong>WiFi yang sama</strong>. Mode Hotspot: connect ke <strong className="font-mono">SmartTrap-CAM</strong> / <strong className="font-mono">12345678</strong>
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={applyRouterPreset}
            className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300 active:scale-95 transition-all"
            title="Set ke IP router (mode station)"
          >
            Router
          </button>
          <button
            onClick={applyHotspotPreset}
            className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300 active:scale-95 transition-all"
            title="Set ke hotspot ESP32 (192.168.4.1)"
          >
            Hotspot
          </button>
        </div>
      </div>

      {/* Kartu Kamera */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                isConnected ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              <Cctv className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">Kamera Pemantau (ESP32-CAM)</h3>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                    isConnected ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {isConnected ? "Terhubung" : "Siaga"}
                </span>
                {/* ⚡ Indikator ESP32 busy */}
                {espBusy && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300 animate-pulse">ESP32 Sibuk...</span>}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Pemantauan visual & telemetri sensor suhu/kelembapan</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isConnected && (
              <button
                onClick={handleToggleFlash}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium active:scale-95 transition-all ${
                  flashOn
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {flashOn ? <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> : <ZapOff className="h-3.5 w-3.5" />}
                <span>Flash: {flashOn ? "ON" : "OFF"}</span>
              </button>
            )}

            <button
              onClick={handleToggleNotification}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium active:scale-95 transition-all ${
                notifGranted
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {notifGranted ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
              <span>{notifGranted ? "Notifikasi Aktif" : "Bunyi Notifikasi"}</span>
            </button>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 active:scale-95 transition-all"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span>Pengaturan IP</span>
            </button>

            {!isConnected ? (
              <button onClick={handleConnect} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-semibold shadow-xs active:scale-95 transition-all">
                <Play className="h-3.5 w-3.5" />
                <span>Hubungkan</span>
              </button>
            ) : (
              <button onClick={handleDisconnect} className="flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 text-xs font-semibold shadow-xs active:scale-95 transition-all">
                <Square className="h-3.5 w-3.5" />
                <span>Putuskan</span>
              </button>
            )}
          </div>
        </div>

        {showSettings && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 animate-fade-in space-y-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Alamat IP Kamera ESP32-CAM:</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={streamUrl}
                onChange={(e) => handleStreamUrlChange(e.target.value)}
                placeholder="Contoh: http://192.168.11.186:81/stream"
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-mono text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Format: <code>http://[IP-ESP32]:81/stream</code>. Cek IP di Serial Monitor Arduino.
            </p>
          </div>
        )}

        {connectionError && <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{connectionError}</div>}
      </div>

      {/* Sensor DHT22 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <Thermometer className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block">Suhu Lingkungan</span>
              <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 dark:text-white">{currentTemp}°C</span>
            </div>
          </div>
          <div className="text-right">
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                currentTemp > 34
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                  : currentTemp < 20
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              }`}
            >
              {currentTemp > 34 ? "Panas" : currentTemp < 20 ? "Dingin" : "Normal"}
            </span>
            <span className="text-[10px] text-slate-400 block mt-1">Live {telemetry.updated_at}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400">
              <Droplets className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block">Kelembapan Udara</span>
              <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 dark:text-white">{currentHum}%</span>
            </div>
          </div>
          <div className="text-right">
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                currentHum > 85
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  : currentHum < 40
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              }`}
            >
              {currentHum > 85 ? "Sangat Lembap" : currentHum < 40 ? "Terlalu Kering" : "Optimal"}
            </span>
            <span className="text-[10px] text-slate-400 block mt-1">Live {telemetry.updated_at}</span>
          </div>
        </div>
      </div>

      {/* Live Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-xs flex items-center justify-center">
            {isConnected ? (
              <>
                <img
                  ref={imgRef}
                  src={streamUrl}
                  alt="Live Monitor ESP32-CAM"
                  className="h-full w-full object-contain filter contrast-[1.05] saturate-[1.08] brightness-[1.02]"
                  onLoad={() => setStreamError(false)}
                  onError={() => {
                    setStreamError(true);
                    console.warn("Stream buffering atau reconnecting...");
                  }}
                />
                {streamError && (
                  <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-10">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mb-3">
                      <WifiOff className="h-6 w-6" />
                    </div>
                    <h4 className="text-sm font-bold text-white mb-1">Koneksi ke ESP32 Terputus</h4>
                    <p className="text-xs text-slate-300 max-w-md leading-relaxed mb-4">Pastikan laptop & ESP32 di jaringan yang sama. Cek IP di Pengaturan.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setStreamError(false);
                          if (imgRef.current) {
                            imgRef.current.src = `${streamUrl}?t=${Date.now()}`;
                          }
                        }}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 text-xs font-semibold active:scale-95 transition-all"
                      >
                        Coba Lagi
                      </button>
                      <button onClick={handleDisconnect} className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3.5 py-1.5 text-xs font-semibold active:scale-95 transition-all">
                        Tutup
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center p-6 sm:p-8">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 border border-slate-700 text-slate-400 mb-3">
                  <WifiOff className="h-7 w-7" />
                </div>
                <h4 className="text-sm sm:text-base font-bold text-white">Kamera Belum Terhubung</h4>
                <p className="mt-1 text-xs text-slate-400 max-w-sm">
                  Klik <strong>"Hubungkan"</strong> di atas untuk mulai memantau.
                </p>
              </div>
            )}

            {isConnected && (
              <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg bg-slate-950/80 backdrop-blur-xs px-3 py-1 border border-slate-800 text-xs font-semibold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>LIVE</span>
              </div>
            )}

            {isConnected && (
              <div className="absolute top-3 right-3 flex items-center gap-2 rounded-lg bg-slate-950/80 backdrop-blur-xs px-2.5 py-1 border border-slate-800 text-[11px] font-mono text-slate-200">
                <span className="text-amber-400 font-semibold">{currentTemp}°C</span>
                <span className="text-slate-500">•</span>
                <span className="text-sky-400 font-semibold">{currentHum}%</span>
              </div>
            )}
          </div>

          {/* Kontrol Deteksi */}
          {isConnected && (
            <div className="flex flex-wrap items-center gap-3 p-2">
              <button
                onClick={runDetectionOnFrame}
                disabled={isDetecting}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2 text-xs font-semibold active:scale-95 transition-all shadow-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isDetecting ? "animate-spin" : ""}`} />
                <span>{isDetecting ? "Mendeteksi..." : "Periksa Hama Sekarang"}</span>
              </button>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={autoDetect} onChange={(e) => setAutoDetect(e.target.checked)} className="rounded border-slate-300 text-emerald-600 focus:ring-0" />
                <span>Auto-Scan (20 detik)</span>
              </label>

              <span className="text-[10px] text-slate-400">Cooldown: 4 detik antar scan</span>
            </div>
          )}

          {detectionResult && <IPMAlertBanner summary={detectionResult.summary} />}
        </div>

        {/* Hasil Deteksi */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/90">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
              <Bug className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Hasil Pantauan Kamera
            </h4>

            {detectionResult && detectionResult.detections.length > 0 ? (
              <div className="space-y-2">
                {detectionResult.detections.map((det, i) => {
                  const pestName = INDONESIAN_PEST_NAMES[det.class_name] || det.class_name;
                  return (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-xs">
                      <span className="font-bold text-slate-800 dark:text-slate-100">{pestName}</span>
                      <span className="rounded bg-slate-200 dark:bg-slate-700 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">{Math.round(det.confidence * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center italic">{isConnected ? 'Klik "Periksa Hama Sekarang" untuk mendeteksi hama.' : "Hubungkan kamera ESP32 untuk memantau hama."}</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 space-y-1.5">
            <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan:</div>
            <p className="leading-relaxed">ESP32-CAM hanya bisa melayani 1 operasi kamera sekaligus. Capture dibatasi 4 detik sekali agar stream tetap stabil.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
