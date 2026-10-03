// Service untuk mengelola izin dan pengiriman Push Notification

let lastPestNotificationTime = 0;
let lastTempNotificationTime = 0;

/**
 * Meminta izin browser untuk menampilkan notifikasi
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn('Browser ini tidak mendukung notifikasi sistem.');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (err) {
      console.warn('Gagal meminta izin notifikasi browser:', err);
      return false;
    }
  }

  return false;
}

/**
 * Mengecek apakah izin notifikasi sudah aktif
 */
export function isNotificationGranted(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  return Notification.permission === 'granted';
}

/**
 * Mengirim notifikasi sistem via Service Worker atau API Notification native
 */
export async function sendSystemNotification(title: string, body: string, customTag?: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission !== 'granted') {
    // Coba minta izin jika belum pernah ditolak
    const granted = await requestNotificationPermission();
    if (!granted) return;
  }

  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body,
    icon: '/syngenta.png',
    badge: '/syngenta.png',
    vibrate: [200, 100, 200],
    tag: customTag || `smart-trap-${Date.now()}`,
    renotify: true,
  };

  // Coba kirim via Service Worker jika tersedia & siap
  try {
    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
      ]);
      if (reg) {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch (err) {
    console.warn('Gagal memunculkan notifikasi via service worker, fallback ke native:', err);
  }

  // Fallback ke browser Notification API native
  try {
    new Notification(title, options);
  } catch (err) {
    console.warn('Gagal memunculkan notifikasi native:', err);
  }
}

/**
 * Notifikasi otomatis saat hama terdeteksi oleh kamera ESP32-CAM / foto
 */
export function notifyPestDetected(pestName: string, count: number = 1) {
  const now = Date.now();
  // Cooldown 20 detik agar tidak membombardir notifikasi setiap frame
  if (now - lastPestNotificationTime < 20000) return;
  lastPestNotificationTime = now;

  sendSystemNotification(
    'Peringatan Hama Terdeteksi!',
    `Ditemukan ${count} ${pestName} pada kamera pemantau lahan jagung.`,
    'pest-alert'
  );
}

/**
 * Notifikasi otomatis saat pembacaan sensor DHT22 (Suhu / Kelembapan) di luar batas ideal
 */
export function notifyDHT22Alert(temperature: number | null | undefined, humidity?: number | null) {
  if (temperature === null || temperature === undefined) return;
  const now = Date.now();
  // Cooldown 45 detik untuk notifikasi sensor
  if (now - lastTempNotificationTime < 45000) return;

  const alerts: string[] = [];

  if (temperature > 34) {
    alerts.push(`Suhu lingkungan panas (${temperature}°C, ideal 24-32°C). Waspadai stres tanaman jagung.`);
  } else if (temperature < 20 && temperature > 0) {
    alerts.push(`Suhu lingkungan dingin (${temperature}°C). Waspadai pertumbuhan lambat.`);
  }

  if (humidity !== undefined && humidity !== null) {
    if (humidity > 85) {
      alerts.push(`Kelembapan udara tinggi (${humidity}%, ideal 60-80%). Risiko infeksi jamur/hama meningkat.`);
    } else if (humidity < 40 && humidity > 0) {
      alerts.push(`Kelembapan udara rendah (${humidity}%). Periksa irigasi lahan.`);
    }
  }

  if (alerts.length > 0) {
    lastTempNotificationTime = now;
    sendSystemNotification(
      'Peringatan Sensor DHT22',
      alerts.join(' '),
      'dht22-alert'
    );
  }
}

/**
 * Kompatibilitas fungsi notifikasi suhu
 */
export function notifyTemperatureAlert(temperature: number) {
  notifyDHT22Alert(temperature);
}

