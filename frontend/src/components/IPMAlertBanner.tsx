import React from 'react';
import { AlertTriangle, CheckCircle2, AlertOctagon, Info } from 'lucide-react';
import { DetectionSummary } from '../types';

interface IPMAlertBannerProps {
  summary: DetectionSummary;
}

const INDONESIAN_PEST_NAMES: Record<string, string> = {
  'Asian-Corn-Borer': 'Penggerek Batang Jagung',
  'Corn Borers': 'Penggerek Batang Jagung',
  'Bollworm': 'Ulat Tongkol Jagung',
  'Corn Earworms': 'Ulat Tongkol Jagung',
  'Fall-Armyworm': 'Ulat Grayak Jagung',
  'Fall Armyworms': 'Ulat Grayak Jagung',
  'Rat': 'Hama Tikus'
};

export const IPMAlertBanner: React.FC<IPMAlertBannerProps> = ({ summary }) => {
  const { ipm_risk_level, ipm_action_recommended, total_pests, saturation_pct, highest_risk_species } = summary;

  const getRiskConfig = () => {
    switch (ipm_risk_level) {
      case 'CRITICAL':
        return {
          icon: AlertOctagon,
          bg: 'bg-rose-50 border-rose-200 text-rose-950 dark:bg-rose-950/50 dark:border-rose-800/80 dark:text-rose-100',
          badge: 'bg-rose-600 text-white',
          statusText: 'Bahaya',
          title: 'Perlu Penyemprotan Segera',
          iconBg: 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300',
        };
      case 'HIGH':
        return {
          icon: AlertTriangle,
          bg: 'bg-amber-50 border-amber-200 text-amber-950 dark:bg-amber-950/50 dark:border-amber-800/80 dark:text-amber-100',
          badge: 'bg-amber-500 text-slate-950 font-bold',
          statusText: 'Waspada',
          title: 'Populasi Hama Meningkat',
          iconBg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300',
        };
      case 'MEDIUM':
        return {
          icon: Info,
          bg: 'bg-sky-50 border-sky-200 text-sky-950 dark:bg-sky-950/50 dark:border-sky-800/80 dark:text-sky-100',
          badge: 'bg-sky-500 text-slate-950 font-bold',
          statusText: 'Perhatian',
          title: 'Ada Hama Terdeteksi',
          iconBg: 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300',
        };
      case 'LOW':
      default:
        return {
          icon: CheckCircle2,
          bg: 'bg-emerald-50 border-emerald-200 text-emerald-950 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-100',
          badge: 'bg-emerald-600 text-white',
          statusText: 'Aman',
          title: 'Tanaman Bersih & Sehat',
          iconBg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300',
        };
    }
  };

  const config = getRiskConfig();
  const IconComponent = config.icon;
  const pestLabel = highest_risk_species ? (INDONESIAN_PEST_NAMES[highest_risk_species] || highest_risk_species) : null;

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 transition-all shadow-sm ${config.bg}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/5 dark:border-white/10 ${config.iconBg}`}>
            <IconComponent className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 mb-1 flex-wrap">
              <span className={`rounded-full px-3 py-0.5 text-xs font-bold tracking-wide ${config.badge}`}>
                {config.statusText}
              </span>
              <h3 className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white">{config.title}</h3>
            </div>
            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 leading-relaxed max-w-[80ch]">
              {ipm_action_recommended}
            </p>
          </div>
        </div>

        {/* Info Ringkas Status */}
        <div className="flex items-center gap-4 shrink-0 sm:border-l sm:border-slate-300/60 dark:sm:border-slate-700/50 sm:pl-5">
          <div>
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1 font-medium">
              <span>Risiko Kerusakan:</span>
              <span className="font-bold text-slate-900 dark:text-white ml-2">{saturation_pct}%</span>
            </div>
            <div className="h-2.5 w-32 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  saturation_pct > 60
                    ? 'bg-rose-500'
                    : saturation_pct > 25
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.max(5, Math.min(100, saturation_pct))}%` }}
              />
            </div>
          </div>

          {pestLabel && (
            <div className="rounded-xl border border-slate-300/80 bg-white/80 dark:border-slate-700/60 dark:bg-slate-900/70 px-3 py-2 text-center shadow-xs">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Hama Utama</span>
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{pestLabel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
