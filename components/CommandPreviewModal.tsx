import React, { useState, useEffect, useRef } from 'react';
import { Play, X, Clock, Terminal, Globe, PlayCircle, Settings2, Monitor } from 'lucide-react';
import { AutomationStep, ActionType } from '../types';

interface CommandPreviewModalProps {
  steps: AutomationStep[];
  onConfirm: () => void;
  onCancel: () => void;
  countdownSeconds?: number;
}

export default function CommandPreviewModal({
  steps,
  onConfirm,
  onCancel,
  countdownSeconds = 5
}: CommandPreviewModalProps) {
  const [timeLeft, setTimeLeft] = useState(countdownSeconds);
  const timerRef = useRef<any>(null);
  const isAutoRunDisabled = countdownSeconds === 0;

  useEffect(() => {
    if (isAutoRunDisabled) return;

    // Start countdown
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          onConfirm();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [onConfirm, isAutoRunDisabled]);

  const handleCancel = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    onCancel();
  };

  const handleConfirm = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    onConfirm();
  };

  // Helper to render step icons
  const getStepIcon = (type: ActionType) => {
    switch (type) {
      case ActionType.LAUNCH_APP:
        return <Terminal className="text-emerald-400" size={16} />;
      case ActionType.OPEN_URL:
        return <Globe className="text-cyan-400" size={16} />;
      case ActionType.KEYPRESS:
        return <PlayCircle className="text-purple-400" size={16} />;
      case ActionType.SYSTEM_POWER:
        return <Monitor className="text-red-400" size={16} />;
      default:
        return <Settings2 className="text-slate-400" size={16} />;
    }
  };

  // Helper to get type styling
  const getTypeBadgeStyle = (type: ActionType) => {
    switch (type) {
      case ActionType.LAUNCH_APP:
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case ActionType.OPEN_URL:
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case ActionType.KEYPRESS:
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case ActionType.SYSTEM_POWER:
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const progressPercent = isAutoRunDisabled ? 0 : (timeLeft / countdownSeconds) * 100;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      {/* Modal Card with premium neon borders and glassmorphism */}
      <div className="w-full max-w-sm bg-slate-900/90 border border-white/10 rounded-[2.5rem] p-6 shadow-[0_20px_50px_rgba(6,182,212,0.15)] flex flex-col gap-6 relative overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Countdown Glow Background */}
        <div className="absolute -top-20 -left-20 w-48 h-48 bg-cyan-500/10 rounded-full blur-[50px] pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-48 h-48 bg-indigo-500/10 rounded-full blur-[50px] pointer-events-none" />

        {/* Header Section */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-14 h-14 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 relative">
            {isAutoRunDisabled ? (
              <Clock size={22} className="animate-pulse" />
            ) : (
              <>
                {/* Spinning countdown circular border */}
                <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                  <circle
                    cx="28"
                    cy="28"
                    r="26"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="transparent"
                    className="text-cyan-500/10"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r="26"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    fill="transparent"
                    strokeDasharray="163"
                    strokeDashoffset={163 - (163 * progressPercent) / 100}
                    className="text-cyan-400 transition-all duration-1000 ease-linear"
                  />
                </svg>
                <span className="font-mono text-lg font-black">{timeLeft}</span>
              </>
            )}
          </div>
          <h3 className="text-base font-black italic tracking-tight text-white mt-1">YAPAY ZEKA KOMUT PLANI</h3>
          <p className="text-[11px] text-slate-400 leading-relaxed max-w-[240px]">
            {isAutoRunDisabled 
              ? "Sesli komutunuz analiz edildi. Çalıştırmak için lütfen onaylayın."
              : `Sesli komutunuz analiz edildi. ${timeLeft} saniye içinde otomatik çalıştırılacak.`
            }
          </p>
        </div>

        {/* Steps List container */}
        <div className="flex-1 max-h-48 overflow-y-auto space-y-3 pr-1 py-1 custom-scrollbar">
          {steps.map((step, idx) => (
            <div 
              key={step.id || idx}
              className="bg-slate-800/40 border border-white/5 rounded-2xl p-3 flex items-start gap-3 transition-all hover:bg-slate-800/60"
            >
              <div className="p-2 bg-slate-800 rounded-xl mt-0.5 flex shrink-0">
                {getStepIcon(step.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md border ${getTypeBadgeStyle(step.type)}`}>
                    {step.type}
                  </span>
                  <span className="text-[9px] font-mono text-slate-500">Adım {idx + 1}</span>
                </div>
                <h4 className="text-[11px] font-bold text-slate-200 truncate">{step.description}</h4>
                {step.value && (
                  <p className="text-[9px] font-mono text-slate-400 truncate mt-0.5 opacity-80 bg-slate-950/30 px-1.5 py-0.5 rounded border border-white/5 max-w-max animate-pulse">
                    {step.value}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-2">
          <button
            onClick={handleCancel}
            className="flex-1 py-3 px-4 bg-slate-800/60 hover:bg-slate-800 text-slate-300 font-bold rounded-2xl active:scale-95 transition-all text-xs border border-white/5 flex items-center justify-center gap-1.5"
          >
            <X size={14} />
            İptal Et
          </button>
          
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 px-4 bg-gradient-to-tr from-cyan-500 to-indigo-500 text-slate-950 font-black rounded-2xl active:scale-95 transition-all text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-500/10 hover:brightness-110"
          >
            <Play size={14} fill="currentColor" />
            Hemen Çalıştır
          </button>
        </div>

      </div>
    </div>
  );
}
