import React, { useState, useEffect } from 'react';
import { SidebarNav, NavTab } from './components/SidebarNav';
import { LiveMonitorView } from './components/LiveMonitorView';
import { ImageUploadView } from './components/ImageUploadView';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { requestNotificationPermission } from './services/notificationService';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('monitor');
  const [backendConnected, setBackendConnected] = useState<boolean>(false);

  // Minta izin push notification langsung saat pertama kali pengguna masuk
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        requestNotificationPermission().catch((err) => {
          console.warn('Izin notifikasi ditunda browser:', err);
        });

        // Trigger cadangan untuk browser yang memerlukan user gesture (klik/sentuh pertama)
        const handleFirstInteraction = () => {
          if (Notification.permission === 'default') {
            requestNotificationPermission().catch(() => {});
          }
        };

        window.addEventListener('click', handleFirstInteraction, { once: true });
        window.addEventListener('touchstart', handleFirstInteraction, { once: true });

        return () => {
          window.removeEventListener('click', handleFirstInteraction);
          window.removeEventListener('touchstart', handleFirstInteraction);
        };
      }
    }
  }, []);

  // Theme Management: Default 'light', toggleable to 'dark', persisted in localStorage
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return 'light';
    }
    return 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Check Backend Health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) setBackendConnected(true);
        else setBackendConnected(false);
      } catch {
        setBackendConnected(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const getPageTitle = () => {
    switch (activeTab) {
      case 'monitor':
        return 'Live Monitor Kamera & Sensor (ESP32)';
      case 'upload':
        return 'Deteksi Foto Hama Saat Ini';
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100 font-sans transition-colors duration-200">
      {/* Sidebar Navigasi Responsif */}
      <SidebarNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        backendConnected={backendConnected}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Konten Utama */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        {/* Header Desktop Sederhana */}
        <header className="hidden md:flex items-center justify-between border-b border-slate-200/80 bg-white/70 px-6 py-3.5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/70">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {getPageTitle()}
          </h2>
          <span className="text-xs text-slate-400">
            Perlindungan Tanaman Jagung
          </span>
        </header>

        {/* Dynamic View Body */}
        <main className="flex-1 max-w-5xl w-full mx-auto px-3.5 sm:px-6 py-4 sm:py-6">
          {activeTab === 'monitor' && <LiveMonitorView />}
          {activeTab === 'upload' && <ImageUploadView />}
        </main>

        {/* Footer Sederhana */}
        <footer className="hidden md:block border-t border-slate-200/60 bg-white/40 py-3 text-center text-xs text-slate-400 dark:border-slate-800/60 dark:bg-slate-950/40">
          Smart Trap Tanaman Jagung — Syngenta
        </footer>
      </div>

      {/* Pop-up Modal Kecil Opsi Install PWA */}
      <PWAInstallPrompt />
    </div>
  );
}

export default App;
