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
} from 'lucide-react';
import { detectFromImage, fetchLatestTelemetry } from '../services/api';
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
  // Alat pertama yang terdaftar
  const [selectedDevice, setSelectedDevice] = useState<string>('alat-1');
  const [streamUrl, setStreamUrl] = useState<string>('http://192.168.1.100:81/stream');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [autoDetect, setAutoDetect] = useState<boolean>(true);
  const [detectionResult, setDetectionResult] = useState<DetectionResponse | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [notifGranted, setNotifGranted] = useState<boolean>(isNotificationGranted());

  const imgRef = useRef<HTMLImageElement>(null);

  // Sinkronkan status izin saat tampilan dibuka
  useEffect(() => {
    setNotifGranted(isNotificationGranted());
  }, []);

  // Ambil gambar snapshot dari stream untuk deteksi YOLO
  const runDetectionOnFrame = async () => {
    if (!imgRef.current || !isConnected || isDetecting) return;
    setIsDetecting(true);
    try {
      const img = imgRef.current;
      if (!img.complete || img.naturalWidth === 0) {
        setIsDetecting(false);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 800;
      canvas.height = img.naturalHeight || 600;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setIsDetecting(false);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          setIsDetecting(false);
          return;
        }
        try {
          const res = await detectFromImage(blob, 'LAHAN-01', false, 0.25);
          setDetectionResult(res);

          // Kirim Push Notification otomatis jika ditemukan hama
          if (res.detections && res.detections.length > 0) {
            const topSpecies = res.detections[0].class_name;
            const translatedName = INDONESIAN_PEST_NAMES[topSpecies] || topSpecies;
            notifyPestDetected(translatedName, res.detections.length);
          }
        } catch (err) {
          console.error('Gagal deteksi frame:', err);
        } finally {
          setIsDetecting(false);
        }
      }, 'image/jpeg', 0.95);
    } catch (err) {
      console.error('Gagal memproses frame kamera:', err);
      setIsDetecting(false);
    }
  };

  // Auto deteksi berkala jika diaktifkan
  useEffect(() => {
    if (!isConnected || !autoDetect) return;
    const timer = setInterval(() => {
      runDetectionOnFrame();
    }, 4000);
    return () => clearInterval(timer);
  }, [isConnected, autoDetect, isDetecting]);

  // Pantau sensor suhu dan kelembapan DHT22 secara realtime (Fleksibel & Otomatis)
  useEffect(() => {
    const getTelemetry = async () => {
      try {
        let data: TelemetryData | null = null;

        // 1. Ambil data langsung dari alamat ESP32 yang dihubungkan
        if (isConnected && streamUrl) {
          try {
            const deviceTelemetryUrl = streamUrl.replace(/\/stream\/?$/, '/telemetry');
            const res = await fetch(deviceTelemetryUrl, {
              signal: AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined,
            });
            if (res.ok) {
              data = await res.json();
              // Sinkronkan ke backend lokal laptop saat ini agar tersimpan di riwayat & database
              fetch('/api/v1/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              }).catch(() => {});
            }
          } catch {
            // Jika direct fetch belum merespons, fallback ke data backend
          }
        }

        // 2. Fallback: Ambil data dari backend lokal
        if (!data) {
          data = await fetchLatestTelemetry();
        }

        setTelemetry(data);

        // Kirim Push Notification jika suhu / kelembapan DHT22 tidak ideal saat terhubung
        if (isConnected && data) {
          notifyDHT22Alert(data.temperature, data.humidity);
        }
      } catch (err) {
        console.error('Gagal mengambil data sensor DHT22:', err);
      }
    };
    getTelemetry();
    const interval = setInterval(() => {
      if (isConnected) {
        getTelemetry();
      }
    }, 3000);
    return () => clearInterval(interval);
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

  const handleConnect = () => {
    setConnectionError(null);
    if (!streamUrl.trim()) {
      setConnectionError('Masukkan alamat IP ESP32-CAM terlebih dahulu.');
      return;
    }
    setIsConnected(true);
    setAutoDetect(true);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setAutoDetect(false);
    setDetectionResult(null);
    setConnectionError(null);
    setTelemetry(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Kartu Alat Terdaftar */}
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
                  Kamera Lahan 1 (ESP32-CAM)
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
                Alat monitor pertama terdaftar • Lahan Jagung Utama
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 animate-fade-in">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Alamat IP Kamera ESP32-CAM:
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
                placeholder="Contoh: http://192.168.1.111:81/stream atau http://smart-trap.local:81/stream"
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-mono text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
              />
              <span className="text-[11px] text-slate-400 self-center">
                Mendukung IP lokal ESP32 & Domain mDNS (smart-trap.local)
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

      {/* Sensor Suhu & Kelembapan (DHT22) */}
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
                {isConnected && telemetry ? `${telemetry.temperature}°C` : '-- °C'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                !isConnected
                  ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  : (telemetry?.temperature || 0) > 34
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {!isConnected ? 'Menunggu Alat' : (telemetry?.temperature || 0) > 34 ? 'Panas' : 'Normal'}
            </span>
            <span className="text-[10px] text-slate-400 block mt-1">Ideal: 24°C - 32°C</span>
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
                {isConnected && telemetry ? `${telemetry.humidity}%` : '-- %'}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                !isConnected
                  ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  : (telemetry?.humidity || 0) > 85
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {!isConnected ? 'Menunggu Alat' : (telemetry?.humidity || 0) > 85 ? 'Sangat Lembap' : 'Optimal'}
            </span>
            <span className="text-[10px] text-slate-400 block mt-1">Ideal: 60% - 80%</span>
          </div>
        </div>
      </div>

      {/* Layar Tampilan Live Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Kolom Video Monitor */}
        <div className="lg:col-span-2 space-y-3">
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-xs flex items-center justify-center">
            {isConnected ? (
              <img
                ref={imgRef}
                src={streamUrl}
                crossOrigin="anonymous"
                alt="Live Monitor ESP32-CAM"
                className="h-full w-full object-contain filter contrast-[1.05] saturate-[1.08] brightness-[1.02] transition-all"
                onError={() => {
                  setConnectionError('Tidak dapat memuat stream dari alamat IP tersebut. Pastikan ESP32-CAM sudah menyala dan terhubung pada jaringan yang sama.');
                  setIsConnected(false);
                }}
              />
            ) : (
              <div className="text-center p-6 sm:p-8">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 border border-slate-700 text-slate-400 mb-3">
                  <WifiOff className="h-7 w-7" />
                </div>
                <h4 className="text-sm sm:text-base font-bold text-white">
                  Kamera Belum Terhubung
                </h4>
                <p className="mt-1 text-xs text-slate-400 max-w-sm">
                  Alat ESP32-CAM Lahan 1 siap dikoneksikan. Klik tombol <strong>"Hubungkan"</strong> di atas saat perangkat kamera Anda aktif.
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
            {isConnected && telemetry && (
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
                  <span>Deteksi Otomatis (Tiap 4 Detik)</span>
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
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 space-y-1.5">
            <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan Perangkat ESP32 + DHT22:</div>
            <p className="leading-relaxed">
              Kamera monitor ini disiapkan untuk menerima gambar dari modul ESP32-CAM serta data sensor suhu dan kelembapan DHT22. Saat alat sudah dirakit dan aktif di lahan, angka pengukuran akan otomatis tampil di layar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
