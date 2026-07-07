import React, { useState } from 'react';
import { X, Save, Trash2, Sparkles, RefreshCw, ArrowRight, Music, Youtube, Globe, Gamepad2, Cpu, Keyboard } from 'lucide-react';
import { ControlButton, AutomationStep } from '../types';
import HudPanel from './hud/HudPanel';

const COLORS = [
  { value: 'bg-blue-600', label: 'Mavi' },
  { value: 'bg-red-600', label: 'Kırmızı' },
  { value: 'bg-green-600', label: 'Yeşil' },
  { value: 'bg-purple-600', label: 'Mor' },
  { value: 'bg-orange-600', label: 'Turuncu' },
  { value: 'bg-pink-600', label: 'Pembe' },
  { value: 'bg-cyan-600', label: 'Camgöbeği' },
  { value: 'bg-indigo-600', label: 'İndigo' },
  { value: 'bg-slate-700', label: 'Koyu' },
  { value: 'bg-amber-600', label: 'Amber' },
  { value: 'bg-emerald-600', label: 'Zümrüt' },
  { value: 'bg-rose-600', label: 'Gül' },
];

const ICONS = [
  { value: 'MUSIC', label: 'Müzik', icon: Music },
  { value: 'YOUTUBE', label: 'Youtube', icon: Youtube },
  { value: 'CHROME', label: 'Web', icon: Globe },
  { value: 'STEAM', label: 'Oyun', icon: Gamepad2 },
  { value: 'DEFAULT', label: 'Varsayılan', icon: Cpu },
  { value: 'KEYBOARD', label: 'Klavye', icon: Keyboard },
];

interface EditModalProps {
  button: ControlButton;
  aiPrompt: string;
  isAiLoading: boolean;
  aiStatus: string | null;
  onAiPromptChange: (value: string) => void;
  onAiGenerate: () => void;
  onSave: (updated: ControlButton) => void;
  onDelete: () => void;
  onClose: () => void;
  onReset: () => void;
}

export default function EditModal({
  button, aiPrompt, isAiLoading, aiStatus,
  onAiPromptChange, onAiGenerate, onSave, onDelete, onClose, onReset
}: EditModalProps) {
  const [editBtn, setEditBtn] = useState<ControlButton>(JSON.parse(JSON.stringify(button)));

  const updateStep = (stepId: string, field: keyof AutomationStep, value: string) => {
    setEditBtn(prev => ({
      ...prev,
      steps: prev.steps.map(s => s.id === stepId ? { ...s, [field]: value } : s)
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/95 backdrop-blur-md animate-in slide-in-from-bottom duration-300">
      <HudPanel className="w-full max-w-lg p-8 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-display font-bold uppercase tracking-[0.15em] text-hud-cyan">Yapılandır</h2>
          <button onClick={onClose} className="hud-chip p-3 text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Button Name */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase px-1">Buton İsmi</label>
            <input
              className="w-full bg-hud-bg/80 border border-hud-dim rounded-sm p-4 text-sm font-bold font-data outline-none focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 transition-all"
              value={editBtn.label}
              onChange={e => setEditBtn({ ...editBtn, label: e.target.value })}
              placeholder="Buton Adı"
            />
          </div>

          {/* Color Picker */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase px-1">Renk</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setEditBtn({ ...editBtn, color: c.value })}
                  className={`w-9 h-9 rounded-sm ${c.value} transition-all ${editBtn.color === c.value
                    ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110'
                    : 'opacity-60 hover:opacity-100'}`}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* Icon Picker */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase px-1">İkon</label>
            <div className="flex flex-wrap gap-2">
              {ICONS.map(i => {
                const Icon = i.icon;
                return (
                  <button
                    key={i.value}
                    onClick={() => setEditBtn({ ...editBtn, icon: i.value })}
                    className={`p-3 rounded-sm border transition-all flex flex-col items-center gap-1 ${editBtn.icon === i.value
                      ? 'border-hud-cyan bg-hud-cyan/10 text-hud-cyan'
                      : 'border-hud-dim text-slate-500 hover:text-white hover:border-slate-500'}`}
                  >
                    <Icon size={20} />
                    <span className="text-[8px] font-bold uppercase">{i.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Command Generator */}
          <HudPanel className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-hud-cyan">
              <Sparkles size={18} className={isAiLoading ? "animate-spin" : "animate-pulse"} />
              <span className="text-[10px] font-display font-black uppercase tracking-widest">
                {aiStatus || "Akıllı Komut (Gemini AI)"}
              </span>
            </div>
            <div className="flex gap-3">
              <textarea
                className="flex-1 bg-hud-bg/80 border border-hud-dim rounded-sm p-4 text-sm font-data outline-none h-24 resize-none placeholder:text-slate-600 focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 transition-colors"
                placeholder="Örn: spotifyı aç ve tarkan çal..."
                value={aiPrompt}
                onChange={e => onAiPromptChange(e.target.value)}
              />
              <button
                disabled={isAiLoading}
                onClick={() => {
                  onAiGenerate();
                }}
                className="bg-gradient-to-r from-hud-cyan to-hud-gold text-slate-950 font-display font-bold p-5 rounded-sm self-end active:scale-90 transition-all disabled:opacity-30 disabled:grayscale shadow-lg shadow-hud-cyan/20"
              >
                {isAiLoading ? <RefreshCw className="animate-spin" /> : <ArrowRight size={24} />}
              </button>
            </div>
          </HudPanel>

          {/* Step Chain */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase px-1">Aksiyon Zinciri ({editBtn.steps.length})</label>
            <div className="space-y-2">
              {editBtn.steps.map((s, idx) => (
                <div key={s.id} className="bg-slate-800/40 p-4 rounded-sm flex items-center justify-between border border-hud-dim hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-data text-hud-cyan bg-hud-cyan/10 w-6 h-6 flex items-center justify-center rounded-sm">{idx + 1}</span>
                    <div className="text-xs font-medium text-slate-300">{s.description}</div>
                  </div>
                  <button onClick={() => setEditBtn({ ...editBtn, steps: editBtn.steps.filter(x => x.id !== s.id) })} className="text-red-500/40 hover:text-red-500 p-1 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4 sticky bottom-0 bg-hud-bg pb-2">
            <button
              onClick={() => onSave(editBtn)}
              className="flex-1 bg-gradient-to-r from-hud-cyan to-hud-gold text-slate-950 font-display font-bold py-5 rounded-sm flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xl shadow-hud-cyan/20"
            >
              <Save size={20} /> KAYDET
            </button>
            <button
              onClick={onDelete}
              className="bg-red-500/10 text-red-500 px-6 rounded-sm hover:bg-red-500/20 active:scale-90 transition-all"
            >
              <Trash2 />
            </button>
          </div>

          {/* Reset */}
          <div className="pt-8 border-t border-white/5 text-center">
            <button
              onClick={onReset}
              className="text-[10px] font-black text-red-800 hover:text-red-500 uppercase tracking-widest transition-colors"
            >
              ⚠️ Uygulamayı Tamamen Sıfırla
            </button>
          </div>
        </div>
      </HudPanel>
    </div>
  );
}
