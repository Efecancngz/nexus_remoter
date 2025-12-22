
import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType } from './types';
import { executor } from './services/automation';
import { generateMacro } from './services/gemini';
import { 
  Settings, Plus, Trash2, Cpu, Globe, 
  Gamepad2, Sparkles, X, Save, AlertCircle, 
  RefreshCw, Power, Terminal, ChevronRight
} from 'lucide-react';
import { COLORS } from './constants';

const INITIAL_STATE: AppState = {
  currentPageId: 'main',
  pages: [{
    id: 'main',
    name: 'Nexus Remote',
    buttons: [
      { id: '1', label: 'YouTube', color: 'bg-red-600', icon: 'CHROME', steps: [{ id: 's1', type: ActionType.OPEN_URL, value: 'https://youtube.com', description: 'YouTube Aç' }] },
      { id: '2', label: 'Steam', color: 'bg-blue-600', icon: 'STEAM', steps: [{ id: 's2', type: ActionType.LAUNCH_APP, value: 'steam', description: 'Steam Başlat' }] }
    ]
  }],
  isEditMode: false,
  isExecuting: false,
  pcIpAddress: '',
  connectionStatus: 'offline'
};

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const saved = localStorage.getItem('nexus_app_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...INITIAL_STATE, ...parsed, connectionStatus: 'checking' };
      }
    } catch (e) {
      console.error("LocalStorage Hatası:", e);
    }
    return INITIAL_STATE;
  });

  const [editingBtn, setEditingBtn] = useState<ControlButton | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('nexus_app_state', JSON.stringify({ ...state, connectionStatus: 'offline' }));
    const timer = setTimeout(() => checkConnection(), 1500);
    return () => clearTimeout(timer);
  }, [state.pcIpAddress, state.pages]);

  const checkConnection = async () => {
    if (!state.pcIpAddress) return;
    const online = await executor.ping(state.pcIpAddress);
    setState(s => ({ ...s, connectionStatus: online ? 'online' : 'offline' }));
  };

  const handleButtonClick = async (btn: ControlButton) => {
    if (state.isEditMode) {
      setEditingBtn(btn);
      return;
    }
    setLastError(null);
    setState(s => ({ ...s, isExecuting: true, lastExecutedAction: btn.label }));
    try {
      const result = await executor.run(btn.steps, state.pcIpAddress);
      if (!result.success) setLastError(result.error || "Hata oluştu.");
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  const getIcon = (name: string) => {
    const props = { size: 28, className: "text-white" };
    switch(name) {
      case 'CHROME': return <Globe {...props} />;
      case 'STEAM': return <Gamepad2 {...props} />;
      case 'GAME': return <Power {...props} />;
      case 'DEFAULT': return <Cpu {...props} />;
      default: return <Cpu {...props} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 p-6 font-sans select-none overflow-x-hidden">
      {/* Header */}
      <div className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-2xl font-black italic bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            NEXUS REMOTE
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-2.5 h-2.5 rounded-full shadow-lg transition-all duration-500 ${
              state.connectionStatus === 'online' ? 'bg-green-500 shadow-green-500/50' : 
              state.connectionStatus === 'checking' ? 'bg-amber-500 animate-pulse' : 'bg-red-500 shadow-red-500/50'
            }`} />
            <input 
              className="bg-slate-900/50 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono outline-none focus:border-cyan-500 w-32"
              placeholder="IP: 192.168.x.x"
              value={state.pcIpAddress}
              onChange={e => setState(s => ({ ...s, pcIpAddress: e.target.value }))}
            />
          </div>
        </div>
        <button 
          onClick={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
          className={`p-4 rounded-2xl transition-all shadow-xl ${state.isEditMode ? 'bg-cyan-500 text-slate-950 scale-105' : 'bg-slate-900 border border-slate-800'}`}
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Error View */}
      {lastError && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 animate-in fade-in zoom-in duration-300">
          <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <p className="text-xs text-slate-300 flex-1">{lastError}</p>
          <button onClick={() => setLastError(null)}><X size={14} className="text-slate-500" /></button>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 gap-5">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[2.5rem] flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all group overflow-hidden border border-white/5`}
          >
            <div className="p-4 bg-black/20 rounded-2xl backdrop-blur-sm shadow-inner">
              {getIcon(btn.icon)}
            </div>
            <span className="font-bold text-[11px] uppercase tracking-widest text-center px-2 leading-tight">
              {btn.label}
            </span>
            {state.isEditMode && (
              <div className="absolute top-4 right-4 bg-white/20 p-1.5 rounded-full animate-pulse">
                <Sparkles size={12} />
              </div>
            )}
          </button>
        ))}

        {state.isEditMode && (
          <button 
            onClick={() => {
              const newBtn: ControlButton = { id: Date.now().toString(), label: 'Yeni Buton', color: 'bg-slate-800', icon: 'DEFAULT', steps: [] };
              setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: [...p.buttons, newBtn]}))}));
            }}
            className="aspect-square rounded-[2.5rem] border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 gap-2 hover:bg-slate-900/50 transition-colors"
          >
            <Plus size={32} />
            <span className="text-[10px] font-bold uppercase">Buton Ekle</span>
          </button>
        )}
      </div>

      {/* Edit Modal */}
      {editingBtn && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-slate-900 w-full max-w-md rounded-[3rem] p-8 border border-white/5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-black italic tracking-tighter uppercase">Buton Düzenle</h2>
              <button onClick={() => setEditingBtn(null)} className="p-2 bg-slate-800 rounded-full"><X size={20} /></button>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">İsim & Stil</label>
                <div className="grid grid-cols-2 gap-4">
                  <input 
                    className="bg-slate-800 border border-slate-700 rounded-2xl p-4 outline-none focus:ring-2 ring-cyan-500 transition-all text-sm"
                    value={editingBtn.label}
                    placeholder="Buton Adı"
                    onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
                  />
                  <select 
                    className="bg-slate-800 border border-slate-700 rounded-2xl p-4 outline-none appearance-none text-sm"
                    value={editingBtn.icon}
                    onChange={e => setEditingBtn({...editingBtn, icon: e.target.value})}
                  >
                    <option value="CHROME">Web / Browser</option>
                    <option value="STEAM">Oyun / Steam</option>
                    <option value="GAME">Güç / Sistem</option>
                    <option value="DEFAULT">Varsayılan</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Renk</label>
                <div className="flex flex-wrap gap-2 p-2 bg-slate-800/50 rounded-2xl">
                  {COLORS.map(c => (
                    <button 
                      key={c}
                      onClick={() => setEditingBtn({...editingBtn, color: c})}
                      className={`${c} w-8 h-8 rounded-full border-2 ${editingBtn.color === c ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-50'}`}
                    />
                  ))}
                </div>
              </div>

              <div className="bg-cyan-500/5 border border-cyan-500/20 p-5 rounded-3xl relative overflow-hidden group">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={14} className="text-cyan-400" />
                  <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">AI Makro Üretici</span>
                </div>
                <textarea 
                  className="w-full bg-black/40 rounded-2xl p-4 text-sm outline-none border border-white/5 focus:border-cyan-500/50 transition-all h-24 placeholder:text-slate-600 mb-3"
                  placeholder="Örn: Chrome'u aç, youtube'a git..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                />
                <button 
                  onClick={async () => {
                    const steps = await generateMacro(aiPrompt);
                    if (steps.length > 0) setEditingBtn({...editingBtn, steps});
                    setAiPrompt('');
                  }}
                  className="w-full bg-cyan-500 text-slate-950 font-black py-3 rounded-xl text-[10px] uppercase tracking-widest"
                >
                  Adımları Oluştur
                </button>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Akış ({editingBtn.steps.length})</label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {editingBtn.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-3 bg-slate-800/50 p-3 rounded-2xl border border-white/5">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold truncate uppercase text-cyan-400">{step.type}</p>
                        <p className="text-[9px] text-slate-500 truncate">{step.description}</p>
                      </div>
                      <button onClick={() => setEditingBtn({...editingBtn, steps: editingBtn.steps.filter((_, idx) => idx !== i)})}>
                        <Trash2 size={14} className="text-red-500/50 hover:text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-slate-800">
                <button 
                  onClick={() => {
                    setState(s => ({
                      ...s,
                      pages: s.pages.map(p => ({
                        ...p,
                        buttons: p.buttons.map(b => b.id === editingBtn.id ? editingBtn : b)
                      }))
                    }));
                    setEditingBtn(null);
                  }}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black py-4 rounded-2xl shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
                >
                  <Save size={18} /> KAYDET
                </button>
                <button 
                  onClick={() => {
                    setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: p.buttons.filter(b => b.id !== editingBtn.id)}))}));
                    setEditingBtn(null);
                  }}
                  className="bg-red-500/10 text-red-500 p-4 rounded-2xl hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 size={24} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Status */}
      {state.isExecuting && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-cyan-500 text-slate-950 px-8 py-4 rounded-full font-black text-[10px] shadow-2xl animate-bounce border-2 border-white/20">
          <RefreshCw className="animate-spin" size={14} />
          {state.lastExecutedAction?.toUpperCase()} YÜRÜTÜLÜYOR
        </div>
      )}
    </div>
  );
}
