import React, { useState } from 'react';
import { Crosshair, Search, X, MousePointerClick, RefreshCw } from 'lucide-react';
import { ActionType } from '../types';
import { locate } from '../services/gemini';
import { executor } from '../services/automation';
import HudPanel from './hud/HudPanel';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface SmartClickPanelProps {
  ip: string;
  token: string;
  onToast: (message: string, type?: ToastType) => void;
}

interface Target {
  x_pct: number;
  y_pct: number;
  image: string;
}

export default function SmartClickPanel({ ip, token, onToast }: SmartClickPanelProps) {
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);

  const handleFind = async () => {
    const value = description.trim();
    if (!value || isLoading) return;
    setIsLoading(true);
    try {
      const result = await locate(ip, token, value);
      if (result.found && result.image != null && result.x_pct != null && result.y_pct != null) {
        setTarget({ x_pct: result.x_pct, y_pct: result.y_pct, image: result.image });
      } else {
        onToast('Öğe bulunamadı', 'warning');
      }
    } catch (e: any) {
      onToast(e?.message || 'Öğe aranırken hata oluştu.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!target || isClicking) return;
    setIsClicking(true);
    try {
      const result = await executor.run(
        [{
          id: 'smartclick',
          type: ActionType.MOUSE_CLICK,
          value: `${target.x_pct}%,${target.y_pct}%`,
          description: `Akıllı tıklama: ${description.trim()}`,
        }],
        ip,
        token
      );
      if (result.success) {
        onToast('🎯 Tıklandı', 'success');
      } else {
        onToast(result.error || 'Tıklama başarısız.', 'error');
      }
    } catch {
      onToast('Tıklama gönderilemedi.', 'error');
    } finally {
      setIsClicking(false);
      setTarget(null);
    }
  };

  return (
    <HudPanel className="p-5 space-y-4">
      <div className="flex items-center gap-2 text-hud-cyan">
        <Crosshair size={18} />
        <h3 className="text-sm font-display font-bold uppercase tracking-[0.15em]">Akıllı Tıklama</h3>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Tıklanacak öğeyi tarif edin; Gemini ekranda bulup hedefi göstersin.
      </p>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-hud-bg/80 border border-hud-dim rounded-sm font-data p-3 text-sm outline-none placeholder:text-slate-600 focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 transition-colors"
          placeholder="Örn: Kaydet butonu"
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleFind(); }}
        />
        <button
          onClick={handleFind}
          disabled={isLoading || !description.trim()}
          className="px-5 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
        >
          {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}
          Bul
        </button>
      </div>

      {target && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setTarget(null)}
        >
          <div className="relative max-w-full max-h-[75vh]" onClick={e => e.stopPropagation()}>
            <img
              src={target.image}
              alt="Hedef önizleme"
              className="max-w-full max-h-[75vh] object-contain rounded-sm border border-hud-dim"
            />
            <div
              data-testid="smartclick-crosshair"
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${target.x_pct}%`, top: `${target.y_pct}%` }}
            >
              <Crosshair size={40} className="text-hud-gold drop-shadow-[0_0_6px_rgba(0,0,0,0.9)] animate-pulse" />
            </div>
          </div>

          <div className="flex gap-3 mt-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setTarget(null)}
              className="hud-chip py-3 px-5 text-slate-300 font-bold active:scale-95 transition-all text-xs flex items-center gap-1.5"
            >
              <X size={14} />
              İptal
            </button>
            <button
              onClick={handleConfirm}
              disabled={isClicking}
              className="py-3 px-5 bg-gradient-to-r from-hud-cyan to-hud-gold text-slate-950 font-display font-bold rounded-sm active:scale-95 transition-all text-xs flex items-center gap-1.5 disabled:opacity-40"
            >
              <MousePointerClick size={14} />
              Onayla ve Tıkla
            </button>
          </div>
        </div>
      )}
    </HudPanel>
  );
}
