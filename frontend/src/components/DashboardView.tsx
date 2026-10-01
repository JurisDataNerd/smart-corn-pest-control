import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Bug,
  MapPin,
  RefreshCw,
  Info,
} from 'lucide-react';
import { fetchTraps, fetchTrapAnalytics } from '../services/api';
import { TrapDetail, TrapAnalytics } from '../types';

const INDONESIAN_PEST_NAMES: Record<string, string> = {
  'Asian-Corn-Borer': 'Penggerek Batang',
  'Corn Borers': 'Penggerek Batang',
  'Bollworm': 'Ulat Tongkol',
  'Corn Earworms': 'Ulat Tongkol',
  'Fall-Armyworm': 'Ulat Grayak',
  'Fall Armyworms': 'Ulat Grayak',
  'Rat': 'Hama Tikus',
};

export const DashboardView: React.FC = () => {
  const [traps, setTraps] = useState<TrapDetail[]>([]);
  const [analytics, setAnalytics] = useState<TrapAnalytics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tData, aData] = await Promise.all([fetchTraps(), fetchTrapAnalytics()]);
      setTraps(tData);
      setAnalytics(aData);
    } catch (err) {
      console.error('Gagal memuat data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalTraps = analytics?.total_traps || 0;
  const totalPests = analytics?.total_pests_monitored || 0;
  const criticalTraps = analytics?.critical_traps || 0;
  const activeTraps = analytics?.active_traps || 0;
  const hasHistory = totalTraps > 0 || totalPests > 0;
  const isCritical = criticalTraps > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Status Ringkas Lahan */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-colors dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform ${
                !hasHistory
                  ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  : isCritical
                  ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400'
                  : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
              }`}
            >
              {!hasHistory ? (
                <Info className="h-6 w-6" />
              ) : isCritical ? (
                <AlertTriangle className="h-6 w-6" />
              ) : (
                <ShieldCheck className="h-6 w-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    !hasHistory
                      ? 'bg-slate-400'
                      : isCritical
                      ? 'bg-rose-500 animate-ping'
                      : 'bg-emerald-500'
                  }`}
                />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {!hasHistory
                    ? 'Belum Ada Riwayat Pemeriksaan'
                    : isCritical
                    ? 'Perhatian: Ada Lahan Perlu Penanganan'
                    : 'Kondisi Lahan Terpantau Aman'}
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {!hasHistory
                  ? 'Gunakan menu Upload Foto Hama atau Live Monitor untuk memulai pemeriksaan.'
                  : isCritical
                  ? `${criticalTraps} titik terdeteksi populasi hama di atas batas normal.`
                  : `${totalTraps} titik lahan terpantau aman tanpa gangguan hama berlebih.`}
              </p>
            </div>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="self-start sm:self-auto flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/80 active:scale-95 transition-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Perbarui Data</span>
          </button>
        </div>
      </div>

      {/* Kartu Metrik Angka Riil */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Titik Lahan</span>
          <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
            {totalTraps}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1">Total Titik</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Hama Ditemukan</span>
          <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
            {totalPests}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1">Ekor</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Titik Waspada</span>
          <span className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
            {criticalTraps}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1">Perlu Disemprot</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Lahan Aktif</span>
          <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
            {activeTraps}
          </span>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block mt-1">Status Normal</span>
        </div>
      </div>

      {/* Grid: Populasi Hama & Riwayat Pemeriksaan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Distribusi Hama */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Bug className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Jenis Hama yang Sering Muncul
            </h3>
          </div>

          {!analytics || Object.keys(analytics.top_pest_species).length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center italic">
              Belum ada data hama yang tercatat. Silakan lakukan pemeriksaan foto atau kamera.
            </p>
          ) : (
            <div className="space-y-3.5">
              {Object.entries(analytics.top_pest_species).map(([species, count]) => {
                const total = totalPests || 1;
                const pct = Math.round((count / total) * 100);
                const pestName = INDONESIAN_PEST_NAMES[species] || species;
                return (
                  <div key={species}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{pestName}</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {count} ekor ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${Math.max(5, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Riwayat Titik Lahan */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/90 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Titik Lahan Terdaftar
            </h3>
          </div>

          {traps.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center italic">
              Belum ada titik lahan. Data otomatis tercatat saat foto atau kamera digunakan.
            </p>
          ) : (
            <div className="space-y-2.5">
              {traps.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60"
                >
                  <div>
                    <span className="font-bold text-slate-800 dark:text-white block">{t.id}</span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">{t.location} • {t.crop_type}</span>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                      t.status === 'needs_replacement'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    }`}
                  >
                    {t.status === 'needs_replacement' ? 'Perlu Disemprot' : 'Aktif'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
