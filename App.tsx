
import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType, DashboardPage, AutomationStep } from './types';
import { executor } from './services/automation';
import { generateMacro } from './services/gemini';
import { 
  Settings, Plus, Trash2, Cpu, Globe, 
  Gamepad2, Sparkles, X, Save, AlertCircle, 
  RefreshCw, Power, Edit3, ArrowRight, Music, Youtube, Keyboard
} from 'lucide-react';

const STORAGE_KEY = 'nexus_remote_v8';

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...parsed, isExecuting: false, connectionStatus: 'offline' };
      } catch (e) { console.error(e); }
    }
    return {
      currentPageId: 'main',
      pages: [{
        id: 'main',
        name: 'Nexus Remote',
        buttons: [
          { id: '1', label: 'Spotify', color: 'bg-green-600', icon: 'MUSIC', steps: [{ id: 's1', type: ActionType.COMMAND, value: 'start spotify:', description: 'Spotify başlatılıyor' }] },
          { id: '2', label: 'Youtube', color: 'bg-red-600', icon: 'YOUTUBE', steps: [{ id: 's2', type: ActionType.OPEN_URL, value: 'https://youtube.com', description: 'Youtube açılıyor' }] }
        ]
      }],
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
      setEditingBtn(JSON.parse(JSON.stringify(btn)));
      return;
    }
    if (!btn.steps.length) return;
    setLastError(null);
    setState(s => ({ ...s, isExecuting: true, lastExecutedAction: btn.label }));
    try {
      const result = await executor.run(btn.steps, state.pcIpAddress);
      if (!result.success) setLastError(result.error);
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  const runAiGen = async () => {
    if (!aiPrompt.trim() || !editingBtn) return;
    setIsAiLoading(true);
    setLastError(null);
    try {
      const newSteps = await generateMacro(aiPrompt);
      if (newSteps.length > 0) {
        setEditingBtn(prev => prev ? ({
          ...prev,
          steps: [...prev.steps, ...newSteps]
        }) : null);
        setAiPrompt('');
      } else {
        setLastError("Komut anlaşılamadı, farklı deneyin.");
      }
    } catch (e) {
      setLastError("AI Servis hatası.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const saveBtn = () => {
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
    const p = { size: 24, className: "text-white" };
    switch(name) {
      case 'MUSIC': return <Music {...p} />;
      case 'YOUTUBE': return <Youtube {...p} />;
      case 'CHROME': return <Globe {...p} />;
      case 'STEAM': return <Gamepad2 {...p} />;
      default: return <Cpu {...p} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 select-none pb-20 overflow-x-hidden">
      <header className="p-5 flex justify-between items-center bg-slate-900/60 sticky top-0 z-40 backdrop-blur-xl border-b border-white/5">
        <div onClick={() => {
          const ip = prompt("PC IP Adresi?", state.pcIpAddress);
          if (ip !== null) setState(s => ({...s, pcIpAddress: ip.trim()}));
        }} className="cursor-pointer">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${state.connectionStatus === 'connected' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`} />
            <h1 className="text-xl font-black tracking-tighter italic">NEXUS</h1>
          </div>
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-tighter">{state.pcIpAddress || 'IP AYARLA'}</span>
        </div>
        <button 
          onClick={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
          className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all ${state.isEditMode ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400'}`}
        >
          {state.isEditMode ? 'BİTTİ' : 'DÜZENLE'}
        </button>
      </header>

      <main className="p-6 grid grid-cols-2 gap-4">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[2rem] flex flex-col items-center justify-center gap-2 shadow-xl active:scale-90 transition-all border border-white/5`}
          >
            <div className="p-3 bg-black/20 rounded-xl">{getIcon(btn.icon)}</div>
            <span className="font-bold text-[10px] uppercase tracking-widest">{btn.label}</span>
            {state.isEditMode && (
              <div className="absolute inset-0 bg-slate-900/80 rounded-[2rem] flex items-center justify-center"><Edit3 className="text-cyan-400" /></div>
            )}
          </button>
        ))}
        {state.isEditMode && (
          <button 
            onClick={() => {
              const b = { id: Date.now().toString(), label: 'YENİ', color: 'bg-slate-800', icon: 'DEFAULT', steps: [] };
              setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: [...p.buttons, b]}))}));
            }}
            className="aspect-square rounded-[2rem] border-2 border-dashed border-slate-800 flex items-center justify-center text-slate-600"
          ><Plus size={32} /></button>
        )}
      </main>

      {editingBtn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/90 backdrop-blur-sm animate-in slide-in-from-bottom">
          <div className="bg-slate-900 w-full max-w-lg rounded-t-[3rem] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black italic uppercase">Buton Yapılandır</h2>
              <button onClick={() => setEditingBtn(null)} className="p-2 bg-slate-800 rounded-full"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              <input 
                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-sm font-bold outline-none"
                value={editingBtn.label}
                onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
                placeholder="Buton Etiketi"
              />

              <div className="bg-cyan-500/5 border border-cyan-500/20 p-5 rounded-2xl space-y-3">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Sparkles size={16} />
                  <span className="text-[10px] font-black uppercase">Akıllı Komut (Gemini)</span>
                </div>
                <div className="flex gap-2">
                  <textarea 
                    className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl p-3 text-sm outline-none h-20 resize-none"
                    placeholder="Örn: spotify aç veya youtube shorts git..."
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                  />
                  <button 
                    disabled={isAiLoading}
                    onClick={runAiGen}
                    className="bg-cyan-500 text-slate-950 p-4 rounded-xl self-end active:scale-90 transition-transform"
                  >
                    {isAiLoading ? <RefreshCw className="animate-spin" /> : <ArrowRight />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase px-2">Aksiyonlar ({editingBtn.steps.length})</label>
                {editingBtn.steps.map((s, idx) => (
                  <div key={s.id} className="bg-slate-800/40 p-3 rounded-xl flex items-center justify-between border border-white/5">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-cyan-500">{idx + 1}</span>
                      <div className="text-xs font-bold text-slate-300">"{s.description}"</div>
                    </div>
                    <button onClick={() => setEditingBtn({...editingBtn, steps: editingBtn.steps.filter(x => x.id !== s.id)})} className="text-red-500/40"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-4">
                <button onClick={saveBtn} className="flex-1 bg-orange-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all"><Save size={18}/> KAYDET</button>
                <button onClick={() => {
                  setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: p.buttons.filter(b => b.id !== editingBtn.id)}))}));
                  setEditingBtn(null);
                }} className="bg-red-500/10 text-red-500 px-6 rounded-2xl"><Trash2 /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {state.isExecuting && (
        <div className="fixed bottom-6 left-6 right-6 z-50 bg-cyan-500 text-slate-950 p-4 rounded-2xl flex items-center gap-3 shadow-2xl animate-pulse">
          <RefreshCw className="animate-spin" size={18} />
          <span className="font-black text-[10px] uppercase">PC Aktarımı: {state.lastExecutedAction}</span>
        </div>
      )}

      {lastError && (
        <div className="fixed bottom-6 left-6 right-6 z-50 bg-red-600 text-white p-4 rounded-2xl flex items-center justify-between shadow-2xl">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} />
            <span className="text-[10px] font-bold">{lastError}</span>
          </div>
          <button onClick={() => setLastError(null)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
