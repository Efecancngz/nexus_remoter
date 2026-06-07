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
      <header className="p-5 flex justify-between items-center bg-slate-900/60 sticky top-0 z-40 backdrop-blur-xl border-b border-white/5">
        <div onClick={onOpenConnection} className="cursor-pointer group active:opacity-70 transition-opacity">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full transition-all ${connectionStatus === 'connected'
              ? 'bg-green-500 shadow-[0_0_12px_#22c55e]'
              : 'bg-red-500 animate-pulse'}`}
            />
            <h1 className="text-xl font-black tracking-tighter italic">NEXUS</h1>
          </div>
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            {pcIpAddress || 'IP AYARLA'}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenSettings} className="p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" title="Ayarlar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <button onClick={onOpenScheduler} className="p-2 bg-slate-800 rounded-full text-cyan-400 hover:bg-slate-700 transition-colors" title="Zamanlayıcı">
            <Clock size={16} />
          </button>
          <button
            onClick={onToggleEdit}
            className={`px-5 py-2 rounded-full text-[10px] font-black transition-all ${isEditMode ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            {isEditMode ? 'BİTTİ' : 'DÜZENLE'}
          </button>
        </div>
      </header>

      {/* SYSTEM STATS BAR */}
      {connectionStatus === 'connected' && systemStats && (
        <div className="px-6 pb-2 pt-0 flex gap-3 overflow-x-auto scrollbar-hide">
          <div className="bg-slate-900/50 px-4 py-2 rounded-xl border border-white/5 flex items-center gap-2 shrink-0">
            <Cpu size={14} className="text-purple-400" />
            <span className="text-xs font-bold font-mono">CPU: %{systemStats.cpu}</span>
          </div>
          <div className="bg-slate-900/50 px-4 py-2 rounded-xl border border-white/5 flex items-center gap-2 shrink-0">
            <Cpu size={14} className="text-blue-400" />
            <span className="text-xs font-bold font-mono">RAM: %{systemStats.ram}</span>
          </div>
          <div className="bg-slate-900/50 px-4 py-2 rounded-xl border border-white/5 flex items-center gap-2 shrink-0">
            <Battery size={14} className="text-green-400" />
            <span className="text-xs font-bold font-mono">
              {typeof systemStats.battery === 'object' ? `%${systemStats.battery.percent}` : systemStats.battery}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
