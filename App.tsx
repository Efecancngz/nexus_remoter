
import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType } from './types';
import { executor } from './services/automation';
import { generateMacro } from './services/gemini';
import { 
  Settings, Plus, Trash2, Cpu, Globe, 
  Gamepad2, Sparkles, X, Save, AlertCircle, 
  RefreshCw, Power, Terminal
} from 'lucide-react';
import { COLORS } from './constants';

const INITIAL_STATE: AppState = {
  currentPageId: 'main',
  pages: [{
    id: 'main',
    name: 'Ana Sayfa',
    buttons: [
      { id: '1', label: 'YouTube', color: 'bg-red-600', icon: 'globe', steps: [{ id: 's1', type: ActionType.OPEN_URL, value: 'https://youtube.com', description: 'YouTube Aç' }] },
      { id: '2', label: 'Steam', color: 'bg-blue-600', icon: 'game', steps: [{ id: 's2', type: ActionType.LAUNCH_APP, value: 'steam', description: 'Steam Başlat' }] }
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
      console.error("Storage parse hatası:", e);
    }
    return INITIAL_STATE;
  });

  const [editingBtn, setEditingBtn] = useState<ControlButton | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('nexus_app_state', JSON.stringify(state));
    const timer = setTimeout(() => checkConnection(), 1000);
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
    setState(s => ({ ...s, isExecuting: true }));
    try {
      const result = await executor.run(btn.steps, state.pcIpAddress);
      if (!result.success) setLastError(result.error || "İşlem başarısız.");
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  const getIcon = (name: string) => {
    const props = { size: 28, className: "text-white/90" };
    switch(name) {
      case 'globe': return <Globe {...props} />;
      case 'game': return <Gamepad2 {...props} />;
      case 'power': return <Power {...props} />;
      case 'terminal': return <Terminal {...props} />;
      default: return <Cpu {...props} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 p-6 pb-24 font-sans select-none overflow-hidden">
      <div className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-2xl font-black italic bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            NEXUS REMOTE
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-2 h-2 rounded-full shadow-lg ${
              state.connectionStatus === 'online' ? 'bg-green-500 shadow-green-500/50' : 
              state.connectionStatus === 'checking' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
            }`} />
            <input 
              className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono outline-none w-32"
              placeholder="IP Girin"
              value={state.pcIpAddress}
              onChange={e => setState(s => ({ ...s, pcIpAddress: e.target.value }))}
            />
          </div>
        </div>
        <button 
          onClick={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
          className={`p-4 rounded-2xl transition-all ${state.isEditMode ? 'bg-cyan-500 text-slate-950 scale-105' : 'bg-slate-900'}`}
        >
          <Settings size={20} />
        </button>
      </div>

      {lastError && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
          <AlertCircle className="text-red-500 shrink-0" size={18} />
          <p className="text-xs text-slate-300">{lastError}</p>
          <button onClick={() => setLastError(null)}><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-5">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[2.5rem] flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all group border border-white/5`}
          >
            <div className="p-4 bg-black/20 rounded-2xl backdrop-blur-sm">
              {getIcon(btn.icon)}
            </div>
            <span className="font-bold text-[11px] uppercase tracking-widest">{btn.label}</span>
            {state.isEditMode && <Sparkles className="absolute top-4 right-4 animate-pulse" size={12} />}
          </button>
        ))}

        {state.isEditMode && (
          <button 
            onClick={() => {
              const newBtn = { id: Date.now().toString(), label: 'Yeni', color: 'bg-slate-800', icon: 'cpu', steps: [] };
              setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: [...p.buttons, newBtn]}))}));
            }}
            className="aspect-square rounded-[2.5rem] border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 gap-2"
          >
            <Plus size={32} />
          </button>
        )}
      </div>

      {editingBtn && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-end justify-center p-4">
          <div className="bg-slate-900 w-full max-w-md rounded-[3rem] p-8 border border-white/5 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-black italic">DÜZENLE</h2>
              <button onClick={() => setEditingBtn(null)}><X size={20} /></button>
            </div>
            <div className="space-y-6">
              <input 
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 outline-none focus:ring-2 ring-cyan-500"
                value={editingBtn.label}
                onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
              />
              <div className="flex flex-wrap gap-2 p-2 bg-slate-800/50 rounded-2xl">
                {COLORS.map(c => (
                  <button 
                    key={c}
                    onClick={() => setEditingBtn({...editingBtn, color: c})}
                    className={`${c} w-8 h-8 rounded-full border-2 ${editingBtn.color === c ? 'border-white' : 'border-transparent'}`}
                  />
                ))}
              </div>
              <textarea 
                className="w-full bg-black/40 rounded-2xl p-4 text-sm outline-none h-24 mb-3"
                placeholder="AI Komutu: Chrome'u aç ve Youtube'a git..."
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
              />
              <button 
                onClick={async () => {
                  const steps = await generateMacro(aiPrompt);
                  if (steps.length) setEditingBtn({...editingBtn, steps});
                }}
                className="w-full bg-cyan-500 text-slate-950 font-black py-3 rounded-xl text-[10px] uppercase"
              >
                AI Adımları Oluştur
              </button>
              <div className="flex gap-4 pt-4">
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
                  className="flex-1 bg-cyan-500 text-slate-950 font-black py-4 rounded-2xl"
                >
                  KAYDET
                </button>
                <button 
                  onClick={() => {
                    setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: p.buttons.filter(b => b.id !== editingBtn.id)}))}));
                    setEditingBtn(null);
                  }}
                  className="bg-red-500 text-white p-4 rounded-2xl"
                >
                  <Trash2 size={24} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
