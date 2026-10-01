import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone, Check } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [showIOSGuide, setShowIOSGuide] = useState<boolean>(false);

  useEffect(() => {
    // Cek apakah sudah terpasang (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Cek apakah sebelumnya sudah disilang oleh pengguna
    const isDismissed = sessionStorage.getItem('pwa_prompt_dismissed');
    if (isDismissed) return;

    // Tangkap event instalasi browser Android / Chrome / Edge
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Untuk browser yang tidak memicu event (misal iOS Safari atau desktop browser)
    // Tampilkan prompt setelah 2 detik pertama jika bukan standalone
    const timer = setTimeout(() => {
      if (!window.matchMedia('(display-mode: standalone)').matches && !isDismissed) {
        setIsVisible(true);
      }
    }, 2000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      clearTimeout(timer);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
        setIsVisible(false);
      }
      setDeferredPrompt(null);
    } else {
      // Deteksi jika perangkat iOS
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      if (isIOS) {
        setShowIOSGuide(true);
      } else {
        alert('Untuk menginstall aplikasi ini, klik ikon titik tiga (Menu) di browser Anda lalu pilih "Tambahkan ke Layar Utama" atau "Install Aplikasi".');
      }
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    sessionStorage.setItem('pwa_prompt_dismissed', 'true');
  };

  if (!isVisible || isInstalled) return null;

  return (
    <div className="fixed bottom-16 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-50 animate-fade-in">
      <div className="relative rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-xl backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 transition-all">
        {/* Tombol Silang */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
          aria-label="Tutup"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3.5 pr-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 border border-slate-200 shadow-xs dark:bg-white dark:border-slate-700">
            <img src="/syngenta.png" alt="Syngenta" className="h-6 w-auto object-contain" />
          </div>

          <div className="flex-1">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
              Install Aplikasi Smart Trap
            </h4>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              Pasang di HP atau Komputer untuk akses cepat dan pantauan langsung.
            </p>

            {showIOSGuide ? (
              <div className="mt-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 p-2 text-[11px] text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">
                Ketuk tombol <strong>Bagikan (Share)</strong> di Safari lalu pilih <strong>"Tambah ke Layar Utama"</strong>.
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleInstallClick}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs active:scale-95 transition-all"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Install Sekarang</span>
                </button>
                <button
                  onClick={handleDismiss}
                  className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                >
                  Nanti Saja
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
