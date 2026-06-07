import React, { useState } from 'react';
import { X, Save, Trash2, Sparkles, RefreshCw, ArrowRight, Music, Youtube, Globe, Gamepad2, Cpu, Keyboard } from 'lucide-react';
import { ControlButton, AutomationStep } from '../types';

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
      <div className="bg-slate-900 w-full max-w-lg rounded-t-[3.5rem] p-8 border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] max-h-[92vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-black italic uppercase tracking-tighter text-cyan-400">Yapılandır</h2>
          <button onClick={onClose} className="p-3 bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Button Name */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase px-1">Buton İsmi</label>
            <input
              className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all"
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
                  className={`w-9 h-9 rounded-xl ${c.value} transition-all ${editBtn.color === c.value
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
                    className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-1 ${editBtn.icon === i.value
                      ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                      : 'border-slate-700 text-slate-500 hover:text-white hover:border-slate-500'}`}
                  >
                    <Icon size={20} />
                    <span className="text-[8px] font-bold uppercase">{i.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Command Generator */}
          <div className="bg-cyan-500/5 border border-cyan-500/20 p-6 rounded-[2.5rem] space-y-4">
            <div className="flex items-center gap-2 text-cyan-400">
              <Sparkles size={18} className={isAiLoading ? "animate-spin" : "animate-pulse"} />
              <span className="text-[10px] font-black uppercase tracking-widest">
                {aiStatus || "Akıllı Komut (Gemini AI)"}
              </span>
            </div>
            <div className="flex gap-3">
              <textarea
                className="flex-1 bg-slate-800/50 border border-slate-700 rounded-2xl p-4 text-sm outline-none h-24 resize-none placeholder:text-slate-600 focus:border-cyan-500/30 transition-colors"
                placeholder="Örn: spotifyı aç ve tarkan çal..."
                value={aiPrompt}
                onChange={e => onAiPromptChange(e.target.value)}
              />
              <button
                disabled={isAiLoading}
                onClick={() => {
                  onAiGenerate();
                }}
                className="bg-cyan-500 text-slate-950 p-5 rounded-2xl self-end active:scale-90 transition-all disabled:opacity-30 disabled:grayscale shadow-lg shadow-cyan-500/20"
              >
                {isAiLoading ? <RefreshCw className="animate-spin" /> : <ArrowRight size={24} />}
              </button>
            </div>
          </div>

          {/* Step Chain */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase px-1">Aksiyon Zinciri ({editBtn.steps.length})</label>
            <div className="space-y-2">
              {editBtn.steps.map((s, idx) => (
                <div key={s.id} className="bg-slate-800/40 p-4 rounded-2xl flex items-center justify-between border border-white/5 hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-mono text-cyan-500 bg-cyan-500/10 w-6 h-6 flex items-center justify-center rounded-md">{idx + 1}</span>
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
          <div className="flex gap-4 pt-4 sticky bottom-0 bg-slate-900 pb-2">
            <button
              onClick={() => onSave(editBtn)}
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 text-white font-black py-5 rounded-[1.8rem] flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xl shadow-orange-500/20"
            >
              <Save size={20} /> KAYDET
            </button>
            <button
              onClick={onDelete}
              className="bg-red-500/10 text-red-500 px-6 rounded-[1.8rem] hover:bg-red-500/20 active:scale-90 transition-all"
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
      </div>
    </div>
  );
}
