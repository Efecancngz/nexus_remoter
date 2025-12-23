
import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType, DashboardPage, AutomationStep } from './types';
import { executor } from './services/automation';
import { generateMacro } from './services/gemini';
import { 
  Settings, Plus, Trash2, Cpu, Globe, 
  Gamepad2, Sparkles, X, Save, AlertCircle, 
  RefreshCw, Power, Edit3, ArrowRight, Info, Clock, Keyboard,
  Music, Youtube
} from 'lucide-react';

const STORAGE_KEY = 'nexus_remote_v7';

const DEFAULT_PAGE: DashboardPage = {
  id: 'main',
  name: 'Nexus Remote',
  buttons: [
    { 
      id: '1', 
      label: 'YouTube Shorts', 
      color: 'bg-red-600', 
      icon: 'YOUTUBE', 
      steps: [{ id: 's1', type: ActionType.OPEN_URL, value: 'https://youtube.com/shorts', description: 'YouTube Shorts açılıyor' }] 
    },
    { 
      id: '2', 
      label: 'Spotify: Chill', 
      color: 'bg-green-600', 
      icon: 'MUSIC', 
      steps: [
        { id: 's2', type: ActionType.COMMAND, value: 'start spotify:search:lofi', description: 'Spotify lofi araması' },
        { id: 's3', type: ActionType.WAIT, value: '3000', description: 'Uygulama bekleniyor' },
        { id: 's4', type: ActionType.KEYPRESS, value: 'enter', description: 'Oynatılıyor' }
      ] 
    }
  ]
};

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...parsed, isExecuting: false, connectionStatus: 'offline' };
      } catch (e) { console.error("Load error", e); }
    }
    return {
      currentPageId: 'main',
      pages: [DEFAULT_PAGE],
      macros: [],
      isEditMode: false,
      isExecuting: false,
      pcIpAddress: '',
      connectionStatus: 'offline'
    };
  });

  const [editingBtn, setEditingBtn] = useState<ControlButton | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const check = async () => {
      if (state.pcIpAddress) {
        const online = await executor.ping(state.pcIpAddress);
        setState(s => ({ ...s, connectionStatus: online ? 'connected' : 'disconnected' }));
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [state.pcIpAddress]);

  const handleButtonClick = async (btn: ControlButton) => {
    if (state.isEditMode) {
      setEditingBtn({ ...btn, steps: [...btn.steps] });
      return;
    }
    if (btn.steps.length === 0) return;
    
    setLastError(null);
    setState(s => ({ ...s, isExecuting: true, lastExecutedAction: btn.label }));
    try {
      const result = await executor.run(btn.steps, state.pcIpAddress);
      if (!result.success) setLastError(result.error);
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim() || !editingBtn) return;
    setIsAiLoading(true);
    setLastError(null);
    try {
      const newSteps = await generateMacro(aiPrompt);
      if (newSteps.length > 0) {
        setEditingBtn({
          ...editingBtn,
          steps: [...editingBtn.steps, ...newSteps.map(s => ({ ...s, id: Math.random().toString(36).substr(2, 9) }))]
        });
        setAiPrompt('');
      } else {
        setLastError("AI komut üretemedi, lütfen daha açık yazın.");
      }
    } catch (e) {
      setLastError("AI servisine ulaşılamadı.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const saveChanges = () => {
    if (!editingBtn) return;
    setState(s => ({
      ...s,
      pages: s.pages.map(p => ({
        ...p,
        buttons: p.buttons.map(b => b.id === editingBtn.id ? editingBtn : b)
      }))
    }));
    setEditingBtn(null);
  };

  const getIcon = (name: string) => {
    const props = { size: 28, className: "text-white" };
    switch(name) {
      case 'CHROME': return <Globe {...props} />;
      case 'STEAM': return <Gamepad2 {...props} />;
      case 'MUSIC': return <Music {...props} />;
      case 'YOUTUBE': return <Youtube {...props} />;
      default: return <Cpu {...props} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans select-none pb-20">
      <header className="p-6 flex justify-between items-center bg-slate-900/60 sticky top-0 z-40 backdrop-blur-xl border-b border-white/5">
        <div onClick={() => {
          const ip = prompt("PC IP Adresi?", state.pcIpAddress);
          if (ip !== null) setState(s => ({...s, pcIpAddress: ip.trim()}));
        }} className="cursor-pointer">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${state.connectionStatus === 'connected' ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
            <h1 className="text-xl font-black tracking-tighter italic">NEXUS</h1>
          </div>
          <span className="text-[9px] font-mono text-slate-500 uppercase">{state.pcIpAddress || 'IP AYARLA'}</span>
        </div>
        <button 
          onClick={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
          className={`px-5 py-2 rounded-full text-[10px] font-black uppercase transition-all ${state.isEditMode ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400'}`}
        >
          {state.isEditMode ? 'BİTTİ' : 'DÜZENLE'}
        </button>
      </header>

      <main className="p-6 grid grid-cols-2 gap-5">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[2.5rem] flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-90 transition-all border border-white/10 group`}
          >
            <div className="p-4 bg-black/20 rounded-2xl backdrop-blur-sm group-hover:scale-110 transition-transform">
              {getIcon(btn.icon)}
            </div>
            <span className="font-bold text-[10px] uppercase tracking-widest text-white/90">{btn.label}</span>
            {state.isEditMode && (
              <div className="absolute inset-0 bg-slate-900/80 rounded-[2.5rem] flex items-center justify-center backdrop-blur-[2px]">
                <Edit3 className="text-cyan-400" size={32} />
              </div>
            )}
          </button>
        ))}

        {state.isEditMode && (
          <button 
            onClick={() => {
              const newBtn = { id: Date.now().toString(), label: 'YENİ', color: 'bg-slate-800', icon: 'DEFAULT', steps: [] };
              setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: [...p.buttons, newBtn]}))}));
            }}
            className="aspect-square rounded-[2.5rem] border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 gap-2 hover:border-slate-500 transition-colors"
          >
            <Plus size={32} />
          </button>
        )}
      </main>

      {editingBtn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/90 backdrop-blur-md animate-in slide-in-from-bottom duration-300">
          <div className="bg-slate-900 w-full max-w-lg rounded-t-[3.5rem] p-8 border-t border-white/10 shadow-2xl max-h-[95vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black italic tracking-tight">BUTON DÜZENLE</h2>
              <button onClick={() => setEditingBtn(null)} className="p-2 bg-slate-800 rounded-full"><X size={20} /></button>
            </div>

            <div className="space-y-6">
              <input 
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-500/50"
                value={editingBtn.label}
                onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
                placeholder="Buton Adı"
              />

              <div className="bg-cyan-500/5 border border-cyan-500/20 p-6 rounded-[2rem] space-y-4">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Sparkles size={16} />
                  <span className="text-[10px] font-black uppercase tracking-widest">Akıllı Komut (Gemini)</span>
                </div>
                <div className="flex gap-2">
                  <textarea 
                    className="flex-1 bg-slate-800/50 border border-slate-700 rounded-2xl p-4 text-sm outline-none h-24 resize-none"
                    placeholder="Örn: YouTube'da en son shorts videosunu aç..."
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                  />
                  <button 
                    disabled={isAiLoading}
                    onClick={handleAiGenerate}
                    className="bg-cyan-500 text-slate-950 p-4 rounded-2xl self-end disabled:opacity-50"
                  >
                    {isAiLoading ? <RefreshCw className="animate-spin" /> : <ArrowRight />}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase px-2">Aksiyon Zinciri</label>
                {editingBtn.steps.map((step, idx) => (
                  <div key={step.id} className="bg-slate-800/40 p-4 rounded-2xl flex items-center justify-between border border-white/5">
                    <div className="flex items-center gap-4">
                      <div className="text-[10px] font-mono text-cyan-500 bg-cyan-500/10 w-6 h-6 rounded-md flex items-center justify-center">{idx + 1}</div>
                      <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase">{step.type}</div>
                        <div className="text-xs text-slate-200 italic">"{step.description}"</div>
                      </div>
                    </div>
                    <button 
                      onClick={() => setEditingBtn({...editingBtn, steps: editingBtn.steps.filter(s => s.id !== step.id)})}
                      className="p-2 text-red-500/30 hover:text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={saveChanges}
                  className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={20} /> KAYDET
                </button>
                <button 
                  onClick={() => {
                    setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: p.buttons.filter(b => b.id !== editingBtn.id)}))}));
                    setEditingBtn(null);
                  }}
                  className="bg-red-500/10 text-red-500 p-5 rounded-2xl"
                >
                  <Trash2 size={24} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {state.isExecuting && (
        <div className="fixed bottom-6 left-6 right-6 z-50 bg-cyan-500 text-slate-950 p-4 rounded-2xl flex items-center gap-4 shadow-2xl animate-bounce">
          <RefreshCw className="animate-spin" size={20} />
          <span className="font-bold text-xs uppercase">PC'YE AKTARILIYOR: {state.lastExecutedAction}</span>
        </div>
      )}

      {lastError && (
        <div className="fixed bottom-6 left-6 right-6 z-50 bg-red-600 text-white p-4 rounded-2xl flex items-center justify-between shadow-2xl">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} />
            <span className="text-[11px] font-bold">{lastError}</span>
          </div>
          <button onClick={() => setLastError(null)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
