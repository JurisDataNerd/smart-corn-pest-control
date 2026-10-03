import React, { useState, useRef, useEffect } from 'react';
import {
  Cctv,
  Wifi,
  WifiOff,
  Play,
  Square,
  RefreshCw,
  Bug,
  ShieldCheck,
  AlertTriangle,
  Settings2,
  Thermometer,
  Droplets,
  Bell,
  BellRing,
  Zap,
  ZapOff,
} from 'lucide-react';
import { detectFromImage, fetchLatestTelemetry, fetchDeviceTelemetry, toggleDeviceFlash } from '../services/api';
import { DetectionResponse, TelemetryData } from '../types';
import { IPMAlertBanner } from './IPMAlertBanner';
import {
  notifyPestDetected,
  notifyDHT22Alert,
  notifyTemperatureAlert,
  requestNotificationPermission,
  isNotificationGranted,
  sendSystemNotification,
} from '../services/notificationService';

const INDONESIAN_PEST_NAMES: Record<string, string> = {
  'Asian-Corn-Borer': 'Penggerek Batang',
  'Corn Borers': 'Penggerek Batang',
  'Bollworm': 'Ulat Tongkol',
  'Corn Earworms': 'Ulat Tongkol',
  'Fall-Armyworm': 'Ulat Grayak',
  'Fall Armyworms': 'Ulat Grayak',
  'Rat': 'Hama Tikus',
};

export const LiveMonitorView: React.FC = () => {
  const [streamUrl, setStreamUrl] = useState<string>(() => {
    const saved = localStorage.getItem('smart_trap_stream_url');
    if (!saved || saved.includes('192.168.1.100')) {
      return 'http://192.168.4.1:81/stream';
    }
    return saved;
  });
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [autoDetect, setAutoDetect] = useState<boolean>(false);
  const [detectionResult, setDetectionResult] = useState<DetectionResponse | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [notifGranted, setNotifGranted] = useState<boolean>(isNotificationGranted());
  const [flashOn, setFlashOn] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<boolean>(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const isDetectingRef = useRef<boolean>(false);

  // Sinkronkan status izin saat tampilan dibuka
  useEffect(() => {
    setNotifGranted(isNotificationGranted());
  }, []);

  // Ambil gambar snapshot dari stream untuk deteksi hama (Ultra-cepat & tanpa tainted canvas)
  const runDetectionOnFrame = async () => {
    if (!isConnected || isDetectingRef.current) return;
    isDetectingRef.current = true;
    setIsDetecting(true);

    try {
      let imageBlob: Blob | null = null;

      // 1. Coba ambil frame bersih resolusi tinggi via proxy backend /api/v1/telemetry/capture
      try {
        const resp = await fetch(`/api/v1/telemetry/capture?device_url=${encodeURIComponent(streamUrl)}`);
        if (resp.ok) {
          imageBlob = await resp.blob();
        }
      } catch (err) {
        console.warn('Proxy snapshot gagal, mencoba canvas fallback:', err);
      }

      // 2. Fallback ambil dari elemen <img> via canvas
      if (!imageBlob && imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
        const img = imgRef.current;
        const targetWidth = Math.min(img.naturalWidth || 640, 640);
        const targetHeight = Math.min(img.naturalHeight || 480, 480);
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          imageBlob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/jpeg', 0.75)
          );
        }
      }

      if (!imageBlob) {
        isDetectingRef.current = false;
        setIsDetecting(false);
        return;
      }

      const res = await detectFromImage(imageBlob, undefined, false, 0.25);
      setDetectionResult(res);

      if (res.detections && res.detections.length > 0) {
        const topSpecies = res.detections[0].class_name;
        const translatedName = INDONESIAN_PEST_NAMES[topSpecies] || topSpecies;
        notifyPestDetected(translatedName, res.detections.length);
      }
    } catch (err) {
      console.warn('Gagal deteksi frame:', err);
    } finally {
      isDetectingRef.current = false;
      setIsDetecting(false);
    }
  };

  // Auto deteksi berkala (hanya aktif jika dicentang oleh pengguna)
  useEffect(() => {
    if (!isConnected || !autoDetect) return;
    const timer = setInterval(() => {
      runDetectionOnFrame();
    }, 12000);
    return () => clearInterval(timer);
  }, [isConnected, autoDetect]);

  // Helper normalisasi URL kamera ESP32
  const normalizeStreamUrl = (raw: string): string => {
    let url = raw.trim();
    if (!url) return '';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }
    if (!url.includes(':81') && !url.includes('/stream')) {
      url = `${url.replace(/\/+$/, '')}:81/stream`;
    } else if (!url.includes('/stream')) {
      url = `${url.replace(/\/+$/, '')}/stream`;
    }
    return url;
  };

  const handleStreamUrlChange = (val: string) => {
    setStreamUrl(val);
    localStorage.setItem('smart_trap_stream_url', val);
  };

  const isFetchingTelemetryRef = useRef<boolean>(false);

  // Pantau sensor suhu dan kelembapan DHT22 secara realtime (100% Dinamis dari ESP32)
  useEffect(() => {
    let isMounted = true;

    const getTelemetry = async () => {
      if (isFetchingTelemetryRef.current) return;
      isFetchingTelemetryRef.current = true;

      try {
        let data: TelemetryData | null = null;

        // Ambil data via backend proxy (Aman, bebas blokir CORS & Private Network Access browser)
        if (isConnected && streamUrl) {
          try {
            data = await fetchDeviceTelemetry(streamUrl);
          } catch {
            // Abaikan jika device sedang buffering
          }
        }

        // Fallback ke latest telemetry jika belum connect
        if (!data || data.temperature === null) {
          try {
            data = await fetchLatestTelemetry();
          } catch {
            // Abaikan
          }
        }

        if (isMounted) {
          if (data && data.temperature !== null && data.humidity !== null) {
            setTelemetry(data);
            if (isConnected) {
              notifyDHT22Alert(data.temperature, data.humidity);
            }
          }
        }
      } catch (err) {
        console.warn('Gagal membaca data sensor:', err);
      } finally {
        isFetchingTelemetryRef.current = false;
      }
    };

    getTelemetry();
    const interval = setInterval(() => {
      if (isConnected) {
        getTelemetry();
      }
    }, 4000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isConnected, streamUrl]);

  const handleToggleNotification = async () => {
    const granted = await requestNotificationPermission();
    setNotifGranted(granted);
    if (granted) {
      sendSystemNotification(
        'Notifikasi Smart Trap Aktif',
        'Peringatan otomatis aktif untuk deteksi hama kamera dan pemantauan sensor DHT22.',
        'test-notification'
      );
    }
  };

  const handleToggleFlash = async () => {
    const nextState = !flashOn;
    setFlashOn(nextState);
    try {
      await toggleDeviceFlash(streamUrl, nextState ? 'on' : 'off');
    } catch (err) {
      console.warn('Gagal mengubah flash LED:', err);
    }
  };

  const handleConnect = () => {
    setConnectionError(null);
    setStreamError(false);
    const normalized = normalizeStreamUrl(streamUrl);
    if (!normalized) {
      setConnectionError('Masukkan alamat IP ESP32-CAM terlebih dahulu.');
      return;
    }
    setStreamUrl(normalized);
    localStorage.setItem('smart_trap_stream_url', normalized);
    setIsConnected(true);
    setAutoDetect(false);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setStreamError(false);
    setAutoDetect(false);
    setDetectionResult(null);
    setConnectionError(null);
    setTelemetry(null);
  };

  const applyHotspotPreset = () => {
    const url = 'http://192.168.4.1:81/stream';
    setStreamUrl(url);
    localStorage.setItem('smart_trap_stream_url', url);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Banner Panduan Koneksi Hotspot WiFi ESP32 */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
            <Wifi className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              Koneksi Hotspot WiFi ESP32
              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                192.168.4.1
              </span>
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Hubungkan WiFi Laptop ke: <strong className="font-mono text-emerald-700 dark:text-emerald-400">SmartTrap-CAM</strong> • Sandi: <strong className="font-mono text-emerald-700 dark:text-emerald-400">12345678</strong>
            </p>
          </div>
        </div>

        <button
          onClick={applyHotspotPreset}
          className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-slate-800 active:scale-95 transition-all shadow-xs"
        >
          <span>Pakai IP 192.168.4.1</span>
        </button>
      </div>

      {/* Kartu Kamera Pemantau */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                isConnected
                  ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              <Cctv className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Kamera Pemantau (ESP32-CAM)
                </h3>
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                    isConnected
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {isConnected ? 'Terhubung' : 'Siaga'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Pemantauan visual & telemetri sensor suhu/kelembapan saat ini
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Tombol Kontrol Flash LED */}
            {isConnected && (
              <button
                onClick={handleToggleFlash}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium active:scale-95 transition-all ${
                  flashOn
                    ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300'
                }`}
                title="Nyalakan/Matikan Lampu LED Flash ESP32"
              >
                {flashOn ? <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> : <ZapOff className="h-3.5 w-3.5" />}
                <span>Flash: {flashOn ? 'ON' : 'OFF'}</span>
              </button>
            )}

            <button
              onClick={handleToggleNotification}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium active:scale-95 transition-all ${
                notifGranted
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300'
              }`}
              title={notifGranted ? 'Notifikasi Aktif' : 'Aktifkan Notifikasi'}
            >
              {notifGranted ? <BellRing className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Bell className="h-3.5 w-3.5" />}
              <span>{notifGranted ? 'Notifikasi Aktif' : 'Bunyikan Notifikasi'}</span>
            </button>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 active:scale-95 transition-all"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span>Pengaturan Alamat IP</span>
            </button>

            {!isConnected ? (
              <button
                onClick={handleConnect}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-semibold shadow-xs active:scale-95 transition-all"
              >
                <Play className="h-3.5 w-3.5" />
                <span>Hubungkan</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 text-xs font-semibold shadow-xs active:scale-95 transition-all"
              >
                <Square className="h-3.5 w-3.5" />
                <span>Putuskan</span>
              </button>
            )}
          </div>
        </div>

        {/* Form Pengaturan URL Stream ESP32 */}
        {showSettings && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 animate-fade-in space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Alamat IP Kamera ESP32-CAM:
              </label>
              <button
                type="button"
                onClick={applyHotspotPreset}
                className="text-[11px] font-mono text-emerald-600 hover:text-emerald-500 underline"
              >
                Set Default Hotspot (192.168.4.1)
              </button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={streamUrl}
                onChange={(e) => handleStreamUrlChange(e.target.value)}
                placeholder="Contoh: http://192.168.4.1:81/stream atau 192.168.4.1"
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-mono text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              />
              <span className="text-[11px] text-slate-400 self-center">
                Mendukung IP Hotspot (192.168.4.1) & IP WiFi Router
              </span>
            </div>
          </div>
        )}

        {connectionError && (
          <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">
            {connectionError}
          </div>
        )}
      </div>

      {/* Sensor Suhu & Kelembapan (DHT22) - Realtime Dinamis */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Suhu */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4.5 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <Thermometer className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block">Suhu Lingkungan (DHT22)</span>
              <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 dark:text-white">
                {isConnected && telemetry?.temperature !== null && telemetry?.temperature !== undefined
                  ? `${telemetry.temperature}°C`
                  : '-- °C'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                !isConnected || !telemetry || telemetry.temperature === null
                  ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  : telemetry.temperature > 34
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  : telemetry.temperature < 20
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {!isConnected || !telemetry || telemetry.temperature === null
                ? 'Menunggu Alat'
                : telemetry.temperature > 34
                ? 'Panas'
                : telemetry.temperature < 20
                ? 'Dingin'
                : 'Normal'}
            </span>
            <span className="text-[10px] text-slate-400 block mt-1">
              {telemetry?.updated_at ? `Live ${telemetry.updated_at}` : 'Ideal: 24°C - 32°C'}
            </span>
          </div>
        </div>

        {/* Kelembapan */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4.5 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400">
              <Droplets className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block">Kelembapan Udara (DHT22)</span>
              <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 dark:text-white">
                {isConnected && telemetry?.humidity !== null && telemetry?.humidity !== undefined
                  ? `${telemetry.humidity}%`
                  : '-- %'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                !isConnected || !telemetry || telemetry.humidity === null
                  ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  : telemetry.humidity > 85
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  : telemetry.humidity < 40
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {!isConnected || !telemetry || telemetry.humidity === null
                ? 'Menunggu Alat'
                : telemetry.humidity > 85
                ? 'Sangat Lembap'
                : telemetry.humidity < 40
                ? 'Terlalu Kering'
                : 'Optimal'}
            </span>
            <span className="text-[10px] text-slate-400 block mt-1">
              {telemetry?.updated_at ? `Live ${telemetry.updated_at}` : 'Ideal: 60% - 80%'}
            </span>
          </div>
        </div>
      </div>

      {/* Layar Tampilan Live Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Kolom Video Monitor */}
        <div className="lg:col-span-2 space-y-3">
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-xs flex items-center justify-center">
            {isConnected ? (
              <>
                <img
                  ref={imgRef}
                  src={streamUrl}
                  alt="Live Monitor ESP32-CAM"
                  className="h-full w-full object-contain filter contrast-[1.05] saturate-[1.08] brightness-[1.02] transition-all"
                  onLoad={() => setStreamError(false)}
                  onError={() => {
                    setStreamError(true);
                    console.warn('Stream buffering atau reconnecting...');
                  }}
                />
                {streamError && (
                  <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-10 animate-fade-in">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mb-3">
                      <WifiOff className="h-6 w-6" />
                    </div>
                    <h4 className="text-sm font-bold text-white mb-1">
                      Koneksi ke ESP32 Terputus (ERR_ADDRESS_UNREACHABLE)
                    </h4>
                    <p className="text-xs text-slate-300 max-w-md leading-relaxed mb-4">
                      Laptop Anda saat ini tidak tersambung ke WiFi ESP32. Sambungkan kembali WiFi laptop Anda ke Hotspot:
                      <br />
                      <strong className="text-emerald-400 font-mono text-sm">SmartTrap-CAM</strong> • Sandi: <strong className="text-emerald-400 font-mono text-sm">12345678</strong>
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setStreamError(false);
                          if (imgRef.current) {
                            imgRef.current.src = `${streamUrl}?t=${Date.now()}`;
                          }
                        }}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 text-xs font-semibold shadow-xs active:scale-95 transition-all"
                      >
                        Hubungkan Ulang
                      </button>
                      <button
                        onClick={handleDisconnect}
                        className="rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3.5 py-1.5 text-xs font-semibold shadow-xs active:scale-95 transition-all"
                      >
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
                <h4 className="text-sm sm:text-base font-bold text-white">
                  Kamera Belum Terhubung
                </h4>
                <p className="mt-1 text-xs text-slate-400 max-w-sm">
                  Perangkat ESP32-CAM siap dikoneksikan. Klik tombol <strong>"Hubungkan"</strong> di atas saat kamera Anda aktif.
                </p>
              </div>
            )}

            {/* Status Live Dot */}
            {isConnected && (
              <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg bg-slate-950/80 backdrop-blur-xs px-3 py-1 border border-slate-800 text-xs font-semibold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>LIVE ESP32</span>
              </div>
            )}

            {/* Suhu & Kelembapan di pojok video saat live */}
            {isConnected && telemetry && telemetry.temperature !== null && (
              <div className="absolute top-3 right-3 flex items-center gap-2 rounded-lg bg-slate-950/80 backdrop-blur-xs px-2.5 py-1 border border-slate-800 text-[11px] font-mono text-slate-200">
                <span className="text-amber-400 font-semibold">{telemetry.temperature}°C</span>
                <span className="text-slate-500">•</span>
                <span className="text-sky-400 font-semibold">{telemetry.humidity}%</span>
              </div>
            )}
          </div>

          {/* Kontrol Deteksi */}
          {isConnected && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={runDetectionOnFrame}
                  disabled={isDetecting}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-semibold active:scale-95 transition-all shadow-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isDetecting ? 'animate-spin' : ''}`} />
                  <span>{isDetecting ? 'Mendeteksi...' : 'Periksa Hama Sekarang'}</span>
                </button>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-300 ml-2">
                  <input
                    type="checkbox"
                    checked={autoDetect}
                    onChange={(e) => setAutoDetect(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-0"
                  />
                  <span>Auto-Scan Berkala (Tiap 12 Detik - Opsional)</span>
                </label>
              </div>
            </div>
          )}

          {/* Banner Status Deteksi */}
          {detectionResult && (
            <IPMAlertBanner summary={detectionResult.summary} />
          )}
        </div>

        {/* Kolom Informasi Hama Terdeteksi */}
        <div className="space-y-4">
          <div className="glass-card rounded-2xl p-5">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
              <Bug className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Hasil Pantauan Kamera
            </h4>

            {detectionResult && detectionResult.detections.length > 0 ? (
              <div className="space-y-2">
                {detectionResult.detections.map((det, i) => {
                  const pestName = INDONESIAN_PEST_NAMES[det.class_name] || det.class_name;
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-xs"
                    >
                      <span className="font-bold text-slate-800 dark:text-slate-100">{pestName}</span>
                      <span className="rounded bg-slate-200 dark:bg-slate-700 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        {Math.round(det.confidence * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center italic">
                {isConnected
                  ? 'Klik "Periksa Hama Sekarang" untuk mendeteksi ulat pada gambar kamera.'
                  : 'Hubungkan kamera ESP32 untuk memantau hama secara otomatis.'}
              </p>
            )}
          </div>

          {/* Info Singkat Alat */}
          {/* Info Singkat Alat */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 space-y-1.5">
            <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan Perangkat:</div>
            <p className="leading-relaxed">
              Monitoring realtime ESP32-CAM dengan sensor DHT22. Sistem berjalan ringan dan responsif.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
