import React from 'react';
import { Cpu, Battery, Clock, Wifi, WifiOff } from 'lucide-react';
import { SystemStats } from '../types';

interface HeaderProps {
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  pcIpAddress: string;
  isEditMode: boolean;
  systemStats?: SystemStats;
  onToggleEdit: () => void;
  onOpenScheduler: () => void;
  onOpenSettings: () => void;
  onOpenConnection: () => void;
}

export default function Header({
  connectionStatus, pcIpAddress, isEditMode, systemStats,
  onToggleEdit, onOpenScheduler, onOpenSettings, onOpenConnection
}: HeaderProps) {
  return (
    <>
      <header className="p-5 flex justify-between items-center bg-hud-panel/60 sticky top-0 z-40 backdrop-blur-xl border-b border-hud-cyan/20">
        <div onClick={onOpenConnection} className="cursor-pointer group active:opacity-70 transition-opacity">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full transition-all ${connectionStatus === 'connected'
              ? 'border-2 border-hud-cyan bg-hud-cyan/20 hud-glow-box animate-hud-breathe'
              : 'border-2 border-red-500 bg-red-500/20 animate-pulse'}`}
            />
            <h1 className="text-xl font-display font-bold tracking-[0.25em] text-slate-100 hud-glow">NEXUS</h1>
          </div>
          <span className="text-[10px] font-data text-hud-cyan/60 uppercase tracking-widest">
            {pcIpAddress || 'IP AYARLA'}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenSettings} className="p-2 hud-chip text-hud-cyan/70 hover:text-hud-cyan" title="Ayarlar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <button onClick={onOpenScheduler} className="p-2 hud-chip text-hud-cyan/70 hover:text-hud-cyan" title="Zamanlayıcı">
            <Clock size={16} />
          </button>
          <button
            onClick={onToggleEdit}
            className={`px-5 py-2 text-[10px] font-display transition-all ${isEditMode ? 'bg-hud-gold text-slate-950 shadow-lg shadow-hud-gold/30' : 'hud-chip text-slate-400 hover:text-white'}`}
          >
            {isEditMode ? 'BİTTİ' : 'DÜZENLE'}
          </button>
        </div>
      </header>

      {/* SYSTEM STATS BAR */}
      {connectionStatus === 'connected' && systemStats && (
        <div className="px-6 pb-2 pt-0 flex gap-3 overflow-x-auto scrollbar-hide">
          <div className="hud-panel px-4 py-2 flex items-center gap-2 shrink-0">
            <Cpu size={14} className="text-hud-cyan" />
            <span key={systemStats.cpu} className="text-xs font-bold font-data animate-hud-tick">CPU: %{systemStats.cpu}</span>
          </div>
          <div className="hud-panel px-4 py-2 flex items-center gap-2 shrink-0">
            <Cpu size={14} className="text-hud-cyanBright" />
            <span key={systemStats.ram} className="text-xs font-bold font-data animate-hud-tick">RAM: %{systemStats.ram}</span>
          </div>
          <div className="hud-panel px-4 py-2 flex items-center gap-2 shrink-0">
            <Battery size={14} className="text-green-400" />
            <span className="text-xs font-bold font-data">
              {typeof systemStats.battery === 'object' ? `%${systemStats.battery.percent}` : systemStats.battery}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
