import React from 'react';
import { Plus, Edit3, Music, Youtube, Globe, Gamepad2, Cpu, Keyboard, Volume2 } from 'lucide-react';
import { ControlButton } from '../types';

interface ButtonGridProps {
  buttons: ControlButton[];
  isEditMode: boolean;
  onButtonClick: (btn: ControlButton) => void;
  onAddButton: () => void;
}

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
          className={`${btn.color} relative aspect-square rounded-[2rem] flex flex-col items-center justify-center gap-3 shadow-xl active:scale-[0.97] transition-all border border-white/10 group overflow-hidden`}
        >
          {/* Subtle button radial reflection */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          
          <div className="p-4 bg-black/20 rounded-2xl group-hover:scale-110 transition-transform">
            {getIcon(btn.icon)}
          </div>
          <span className="font-bold text-xs uppercase tracking-wider opacity-90">{btn.label}</span>
          
          {isEditMode && (
            <div className="absolute top-3 right-3 bg-orange-500 text-slate-950 p-1.5 rounded-full shadow-lg border border-white/20 animate-pulse">
              <Edit3 size={12} strokeWidth={2.5} />
            </div>
          )}
        </button>
      ))}

      {isEditMode && (
        <button
          onClick={onAddButton}
          className="aspect-square rounded-[2rem] border-2 border-dashed border-slate-700/60 bg-slate-900/20 flex flex-col items-center justify-center gap-2 text-slate-500 active:scale-95 transition-all hover:border-slate-500 hover:text-slate-300"
        >
          <Plus size={32} />
          <span className="text-[10px] font-black uppercase tracking-widest">Ekle</span>
        </button>
      )}
    </main>
  );
}
