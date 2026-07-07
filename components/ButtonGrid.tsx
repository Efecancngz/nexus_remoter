import React from 'react';
import { Plus, Edit3, Music, Youtube, Globe, Gamepad2, Cpu, Keyboard, Volume2 } from 'lucide-react';
import { ControlButton } from '../types';

interface ButtonGridProps {
  buttons: ControlButton[];
  isEditMode: boolean;
  onButtonClick: (btn: ControlButton) => void;
  onAddButton: () => void;
}

const hasPowerAction = (btn: ControlButton) =>
  btn.steps.some(step => step.type === 'SYSTEM_POWER');

export function getIcon(name: string) {
  const p = { size: 24, className: "text-white" };
  switch (name) {
    case 'MUSIC': return <Music {...p} />;
    case 'YOUTUBE': return <Youtube {...p} />;
    case 'CHROME': return <Globe {...p} />;
    case 'STEAM': return <Gamepad2 {...p} />;
    case 'KEYBOARD': return <Keyboard {...p} />;
    default: return <Cpu {...p} />;
  }
}

export default function ButtonGrid({ buttons, isEditMode, onButtonClick, onAddButton }: ButtonGridProps) {
  return (
    <main className="p-6 grid grid-cols-2 gap-4">
      {buttons.map(btn => (
        <button
          key={btn.id}
          onClick={() => onButtonClick(btn)}
          className={`${btn.color} relative aspect-square rounded-sm flex flex-col items-center justify-center gap-3 shadow-xl active:scale-[0.97] transition-all group overflow-hidden border ${
            hasPowerAction(btn)
              ? 'border-hud-gold/60 shadow-hud-gold/10'
              : 'border-hud-cyan/30'
          }`}
        >
          {/* Subtle button radial reflection */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

          <div className={`p-4 bg-black/30 rounded-sm group-hover:scale-110 transition-transform ${
            hasPowerAction(btn) ? 'hud-glow-box' : ''
          }`}>
            {getIcon(btn.icon)}
          </div>
          <span className="font-display font-bold text-[10px] uppercase tracking-[0.15em] opacity-90">{btn.label}</span>
          
          {isEditMode && (
            <div className="absolute top-3 right-3 bg-hud-gold text-slate-950 p-1.5 rounded-full shadow-lg border border-white/20 animate-pulse">
              <Edit3 size={12} strokeWidth={2.5} />
            </div>
          )}
        </button>
      ))}

      {isEditMode && (
        <button
          onClick={onAddButton}
          className="aspect-square rounded-sm border-2 border-dashed border-hud-gold/40 text-hud-gold/60 hover:border-hud-gold hover:text-hud-gold bg-slate-900/20 flex flex-col items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <Plus size={32} />
          <span className="text-[10px] font-black uppercase tracking-widest">Ekle</span>
        </button>
      )}
    </main>
  );
}
