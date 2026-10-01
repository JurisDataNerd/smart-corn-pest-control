import React, { useState } from 'react';
import {
  LayoutDashboard,
  UploadCloud,
  Cctv,
  Sun,
  Moon,
  Menu,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export type NavTab = 'dashboard' | 'upload' | 'monitor';

interface SidebarNavProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  backendConnected: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  setActiveTab,
  backendConnected,
  theme,
  onToggleTheme,
}) => {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const navItems = [
    {
      id: 'dashboard' as const,
      label: 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      id: 'upload' as const,
      label: 'Upload Foto Hama',
      icon: UploadCloud,
    },
    {
      id: 'monitor' as const,
      label: 'Live Monitor',
      icon: Cctv,
    },
  ];

  const handleTabClick = (tab: NavTab) => {
    setActiveTab(tab);
    setMobileDrawerOpen(false);
  };

  return (
    <>
      {/* ========================================================= */}
      {/* 1. MOBILE TOP HEADER (Ringkas, Rapi, Bersih)             */}
      {/* ========================================================= */}
      <header className="md:hidden sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur-md transition-colors dark:border-slate-800/80 dark:bg-slate-950/90">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 active:scale-95 transition-all dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            aria-label="Buka Menu"
          >
            {mobileDrawerOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          {/* Logo Syngenta */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 items-center justify-center rounded-md bg-white px-2 py-0.5 shadow-xs border border-slate-200/60 dark:bg-white dark:border-slate-700">
              <img
                src="/syngenta.png"
                alt="Syngenta Logo"
                className="h-5 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              Smart Trap
            </span>
          </div>
        </div>

        {/* Toggle Mode Terang/Gelap */}
        <button
          onClick={onToggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 active:scale-95 transition-all hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-amber-400 dark:hover:bg-slate-800"
          aria-label="Ganti Tema"
          title={theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4 text-slate-700" />}
        </button>
      </header>

      {/* ========================================================= */}
      {/* 2. MOBILE DRAWER                                          */}
      {/* ========================================================= */}
      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setMobileDrawerOpen(false)}
          />

          {/* Drawer Content */}
          <div className="relative flex w-3/4 max-w-xs flex-1 flex-col bg-white p-5 shadow-xl transition-all duration-300 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 animate-fade-in">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-white p-1.5 border border-slate-200 shadow-xs dark:bg-white dark:border-slate-700">
                  <img src="/syngenta.png" alt="Syngenta" className="h-6 w-auto object-contain" />
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-white">Smart Trap Jagung</span>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Navigasi Drawer */}
            <div className="mt-5 flex flex-col gap-1.5 flex-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleTabClick(item.id)}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Drawer Footer Status */}
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Tampilan</span>
                <button
                  onClick={onToggleTheme}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  {theme === 'dark' ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-slate-700" />}
                  <span>{theme === 'dark' ? 'Gelap' : 'Terang'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-slate-100 p-2.5 dark:bg-slate-900 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Status Sistem</span>
                <span
                  className={`font-semibold flex items-center gap-1.5 ${
                    backendConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      backendConnected ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  />
                  {backendConnected ? 'Siap' : 'Terputus'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 3. DESKTOP / TABLET SIDEBAR                               */}
      {/* ========================================================= */}
      <aside className="hidden md:flex w-60 lg:w-64 flex-col shrink-0 border-r border-slate-200/80 bg-white dark:border-slate-800/80 dark:bg-slate-950 sticky top-0 h-[100dvh] transition-colors z-20">
        {/* Header Logo */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1.5 shadow-xs border border-slate-200/80 dark:bg-white dark:border-slate-700">
              <img
                src="/syngenta.png"
                alt="Syngenta Logo"
                className="h-6 w-auto object-contain"
              />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                Smart Trap
              </h1>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                Tanaman Jagung
              </p>
            </div>
          </div>
        </div>

        {/* Menu Navigasi Desktop */}
        <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 transition-transform group-hover:scale-110 ${
                    isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Footer Sidebar: Mode & Status */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5 bg-slate-50/50 dark:bg-slate-950">
          {/* Toggle Theme */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900 shadow-xs">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 px-1 flex items-center gap-1.5">
              {theme === 'dark' ? <Moon className="h-3.5 w-3.5 text-amber-400" /> : <Sun className="h-3.5 w-3.5 text-amber-500" />}
              {theme === 'dark' ? 'Mode Gelap' : 'Mode Terang'}
            </span>
            <button
              onClick={onToggleTheme}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                theme === 'dark' ? 'bg-emerald-600' : 'bg-slate-300'
              }`}
              role="switch"
              aria-checked={theme === 'dark'}
              title="Ubah Mode Terang / Gelap"
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                  theme === 'dark' ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Status Singkat */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900 shadow-xs">
            <span className="text-slate-500 dark:text-slate-400">Server</span>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  backendConnected ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {backendConnected ? 'Siap' : 'Terputus'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* ========================================================= */}
      {/* 4. MOBILE BOTTOM DOCK (Thumb-First Navigation)            */}
      {/* ========================================================= */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex h-14 items-center justify-around border-t border-slate-200/80 bg-white/95 px-2 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/95 transition-colors shadow-sm">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all active:scale-95 ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <div
                className={`flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                  isActive
                    ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-[10px] mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
