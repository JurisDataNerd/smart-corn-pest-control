import React, { useState, useRef } from 'react';
import { UploadCloud, Check, Bug, ShieldAlert } from 'lucide-react';
import { detectFromImage } from '../services/api';
import { DetectionResponse } from '../types';
import { IPMAlertBanner } from './IPMAlertBanner';
import { notifyPestDetected } from '../services/notificationService';

interface ImageUploadViewProps {
  onAnalysisComplete?: (res: DetectionResponse) => void;
}

const INDONESIAN_PEST_NAMES: Record<string, string> = {
  'Asian-Corn-Borer': 'Penggerek Batang',
  'Corn Borers': 'Penggerek Batang',
  'Bollworm': 'Ulat Tongkol',
  'Corn Earworms': 'Ulat Tongkol',
  'Fall-Armyworm': 'Ulat Grayak',
  'Fall Armyworms': 'Ulat Grayak',
  'Rat': 'Hama Tikus',
};

export const ImageUploadView: React.FC<ImageUploadViewProps> = ({
  onAnalysisComplete,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [result, setResult] = useState<DetectionResponse | null>(null);
  const [viewMode, setViewMode] = useState<'annotated' | 'raw'>('annotated');
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      analyzeFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      analyzeFile(file);
    }
  };

  const analyzeFile = async (file: File | Blob) => {
    setIsAnalyzing(true);
    setSelectedBoxId(null);
    try {
      const res = await detectFromImage(file, undefined, false, 0.20);
      setResult(res);
      if (onAnalysisComplete) onAnalysisComplete(res);

      if (res.detections && res.detections.length > 0) {
        const topSpecies = res.detections[0].class_name;
        const translatedName = INDONESIAN_PEST_NAMES[topSpecies] || topSpecies;
        notifyPestDetected(translatedName, res.detections.length);
      }
    } catch (err) {
      console.error('Error saat memeriksa foto:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Upload Zone Bersih & Luas */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white/70 p-8 sm:p-12 text-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/40 transition-all dark:border-slate-700/80 dark:bg-slate-900/40 dark:hover:border-emerald-500/60 dark:hover:bg-slate-900/80 shadow-xs"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 group-hover:scale-105 transition-transform mb-3">
          <UploadCloud className="h-7 w-7" />
        </div>

        <h3 className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100">
          Pilih Foto Hama <span className="text-slate-400 font-normal">atau tarik file ke sini</span>
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Foto hama, ulat, daun, tongkol, atau perangkap
        </p>
      </div>

      {/* Loading State */}
      {isAnalyzing && (
        <div className="glass-panel rounded-2xl p-8 sm:p-10 text-center space-y-3 animate-fade-in">
          <div className="mx-auto h-10 w-10 rounded-full border-3 border-emerald-500 border-t-transparent animate-spin" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Sedang Memeriksa Hama...</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sistem sedang mendeteksi keberadaan hama pada foto.
          </p>
        </div>
      )}

      {/* Hasil Deteksi Riil */}
      {result && !isAnalyzing && (
        <div className="space-y-6 animate-fade-in">
          {/* Banner Status Risiko Riil */}
          <IPMAlertBanner summary={result.summary} />

          {/* Tampilan Gambar & Daftar Hama */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Foto Hasil */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex rounded-lg bg-slate-200/80 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 p-0.5 text-xs">
                  <button
                    onClick={() => setViewMode('annotated')}
                    className={`rounded-md px-3 py-1.5 font-medium transition-all ${
                      viewMode === 'annotated' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Foto Bertanda
                  </button>
                  <button
                    onClick={() => setViewMode('raw')}
                    className={`rounded-md px-3 py-1.5 font-medium transition-all ${
                      viewMode === 'raw' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Foto Asli
                  </button>
                </div>

                <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                  Total: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{result.summary.total_pests} Hama</strong>
                </span>
              </div>

              {/* Wadah Gambar */}
              <div className="relative rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-center min-h-[300px] sm:min-h-[380px]">
                <img
                  src={
                    viewMode === 'annotated'
                      ? result.annotated_image_url || previewUrl || ''
                      : previewUrl || result.image_url || ''
                  }
                  alt="Hasil Pemeriksaan"
                  className="max-h-[560px] w-full object-contain"
                />
              </div>
            </div>

            {/* Daftar Hama Terdeteksi */}
            <div className="space-y-4">
              <div className="glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Bug className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                      Hama Terdeteksi ({result.detections.length})
                    </h4>
                  </div>
                </div>

                {result.detections.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 dark:text-slate-400 text-xs">
                    <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
                    <p className="font-semibold text-slate-800 dark:text-slate-200">Tidak Ditemukan Hama</p>
                    <p className="mt-1">Tanaman terpantau aman dan sehat.</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                    {result.detections.map((det, i) => {
                      const pestName = INDONESIAN_PEST_NAMES[det.class_name] || det.class_name;
                      return (
                        <div
                          key={det.id || i}
                          onClick={() => setSelectedBoxId(det.id)}
                          className={`flex items-center justify-between rounded-xl border p-3 text-xs transition-all cursor-pointer ${
                            selectedBoxId === det.id
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                              : 'border-slate-200 bg-slate-50/80 hover:border-slate-300 dark:border-slate-800/80 dark:bg-slate-900/70 dark:hover:border-slate-700'
                          }`}
                        >
                          <span className="font-bold text-sm text-emerald-700 dark:text-emerald-300">
                            {pestName}
                          </span>
                          <span className="rounded bg-slate-200 dark:bg-slate-800 px-2.5 py-0.5 font-mono text-[11px] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                            {Math.round(det.confidence * 100)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Saran Tindakan dari AI */}
              {result.summary.ipm_action_recommended && (
                <div className="glass-card rounded-2xl p-4 border-l-4 border-l-emerald-500">
                  <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Saran Tindakan
                  </h5>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {result.summary.ipm_action_recommended}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
