
import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType, DashboardPage } from './types';
import { executor } from './services/automation';
import { generateMacro } from './services/gemini';
import { 
  Settings, Plus, Trash2, Cpu, Globe, 
  Gamepad2, Sparkles, X, Save, AlertCircle, 
  RefreshCw, Power, Edit3, ArrowRight, Info, Clock
} from 'lucide-react';
import { COLORS } from './constants';

const DEFAULT_PAGE: DashboardPage = {
  id: 'main',
  name: 'Nexus Remote',
  buttons: [
    { 
      id: '1', 
      label: 'YouTube (Chrome)', 
      color: 'bg-red-600', 
      icon: 'CHROME', 
      steps: [{ id: 's1', type: ActionType.COMMAND, value: 'start chrome https://youtube.com', description: 'YouTube Chrome ile zorla açılıyor' }] 
    },
    { 
      id: '2', 
      label: 'Steam Kütüphane', 
      color: 'bg-blue-600', 
      icon: 'STEAM', 
      steps: [{ id: 's2', type: ActionType.COMMAND, value: 'start steam://nav/library', description: 'Steam Kütüphanesi açılıyor' }] 
    }
  ]
};

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('nexus_v4_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...parsed, isExecuting: false, connectionStatus: 'offline' };
      } catch (e) { console.error(e); }
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
  const [lastError, setLastError] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Sync state to LocalStorage
  useEffect(() => {
    localStorage.setItem('nexus_v4_state', JSON.stringify(state));
  }, [state]);

  // Network check
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
    if (btn.steps.length === 0) {
      setLastError("Bu buton boş.");
      return;
    }
    setLastError(null);
    setState(s => ({ ...s, isExecuting: true, lastExecutedAction: btn.label }));
    try {
      const result = await executor.run(btn.steps, state.pcIpAddress);
      if (!result.success) setLastError(result.error);
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  const saveEditingButton = () => {
    if (!editingBtn) return;
    setState(s => ({
      ...s,
      pages: s.pages.map(p => ({
        ...p,
        buttons: p.buttons.map(b => b.id === editingBtn.id ? editingBtn : b)
      }))
    }));
    setEditingBtn(null);
    setAiPrompt('');
  };

  const runAiGeneration = async () => {
    if (!aiPrompt || !editingBtn) return;
    setIsAiLoading(true);
    try {
      const newSteps = await generateMacro(aiPrompt);
      if (newSteps.length > 0) {
        setEditingBtn({
          ...editingBtn,
          steps: [...editingBtn.steps, ...newSteps]
        });
      }
    } catch (e) {
      setLastError("AI komut üretemedi.");
    } finally {
      setIsAiLoading(false);
      setAiPrompt('');
    }
  };

  const getIcon = (name: string, props: { size?: number, className?: string } = {}) => {
    const iconProps = { size: props.size || 24, className: props.className || "text-white" };
    switch(name) {
      case 'CHROME': return <Globe {...iconProps} />;
      case 'STEAM': return <Gamepad2 {...iconProps} />;
      case 'GAME': return <Power {...iconProps} />;
      default: return <Cpu {...iconProps} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans select-none overflow-x-hidden pb-24">
      {/* Header */}
      <header className="p-6 flex justify-between items-center border-b border-white/5 bg-slate-900/50 sticky top-0 z-30 backdrop-blur-md">
        <div onClick={() => {
          const ip = prompt("PC IP Adresi?", state.pcIpAddress);
          if (ip !== null) setState(s => ({...s, pcIpAddress: ip.trim()}));
        }} className="cursor-pointer">
          <h1 className="text-xl font-black italic text-cyan-500 tracking-tighter">NEXUS</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <div className={`w-2 h-2 rounded-full ${state.connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] font-mono text-slate-500">{state.pcIpAddress || 'IP AYARLA'}</span>
          </div>
        </div>
        <button 
          onClick={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
          className={`p-3 rounded-2xl transition-all ${state.isEditMode ? 'bg-orange-500 text-white' : 'bg-slate-800'}`}
        >
          <Settings size={20} />
        </button>
      </header>

      {/* Grid */}
      <div className="p-6 grid grid-cols-2 gap-4">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[2.5rem] flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-90 transition-all border border-white/10 group`}
          >
            <div className="p-4 bg-black/20 rounded-2xl backdrop-blur-sm group-active:scale-95 transition-transform">
              {getIcon(btn.icon, { size: 28 })}
            </div>
            <span className="font-bold text-[11px] uppercase tracking-tighter text-white/90">{btn.label}</span>
            {state.isEditMode && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-[2.5rem] backdrop-blur-[1px]">
                <Edit3 size={28} className="text-cyan-400" />
              </div>
            )}
          </button>
        ))}

        {state.isEditMode && (
          <button 
            onClick={() => {
              const newBtn = { id: Date.now().toString(), label: 'Yeni', color: 'bg-slate-800', icon: 'DEFAULT', steps: [] };
              setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: [...p.buttons, newBtn]}))}));
            }}
            className="aspect-square rounded-[2.5rem] border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-600 gap-2"
          >
            <Plus size={32} />
          </button>
        )}
      </div>

      {/* Edit Drawer */}
      {editingBtn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/90 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 w-full max-w-lg rounded-t-[3rem] p-8 border-t border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black italic">DÜZENLE</h2>
              <button onClick={() => setEditingBtn(null)} className="p-2 bg-slate-800 rounded-full"><X size={20} /></button>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <input 
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-sm font-bold outline-none focus:border-cyan-500/50"
                  value={editingBtn.label}
                  onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
                  placeholder="Buton Adı"
                />
                <select 
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-sm outline-none"
                  value={editingBtn.icon}
                  onChange={e => setEditingBtn({...editingBtn, icon: e.target.value})}
                >
                  <option value="DEFAULT">Genel</option>
                  <option value="CHROME">Web Tarayıcı</option>
                  <option value="STEAM">Steam / Oyun</option>
                  <option value="GAME">Sistem</option>
                </select>
              </div>

              {/* AI Area */}
              <div className="bg-cyan-500/5 border border-cyan-500/20 p-6 rounded-[2rem] space-y-4">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Sparkles size={16} />
                  <span className="text-xs font-black uppercase tracking-widest">Akıllı Komut Sihirbazı</span>
                </div>
                <div className="flex gap-2">
                  <textarea 
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl p-4 text-sm outline-none h-24 resize-none"
                    placeholder="Örn: Chrome'da youtube aç, sonra steam'den CS2 başlat..."
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                  />
                  <button 
                    disabled={isAiLoading}
                    onClick={runAiGeneration}
                    className="bg-cyan-500 text-slate-950 p-5 rounded-2xl self-end disabled:opacity-50"
                  >
                    {isAiLoading ? <RefreshCw className="animate-spin" size={24} /> : <ArrowRight size={24} />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 italic flex items-center gap-1">
                  <Info size={10} /> Belirli tarayıcı veya oyun adlarını belirtebilirsiniz.
                </p>
              </div>

              {/* Steps List */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase px-2">Eylem Zinciri ({editingBtn.steps.length})</label>
                <div className="space-y-2">
                  {editingBtn.steps.map((step, idx) => (
                    <div key={step.id} className="bg-slate-800/50 p-4 rounded-2xl flex items-center justify-between border border-white/5">
                      <div className="flex items-center gap-4">
                        {step.type === ActionType.WAIT ? <Clock size={16} className="text-orange-400" /> : <div className="text-[10px] font-mono text-cyan-500">{idx+1}</div>}
                        <div className="text-xs">
                          <div className="font-black text-slate-200 uppercase">{step.type}</div>
                          <div className="text-slate-500 truncate w-48 font-mono">{step.value}</div>
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
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={saveEditingButton}
                  className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={20} /> DEĞİŞİKLİKLERİ KAYDET
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

      {/* Status Toasts */}
      {state.isExecuting && (
        <div className="fixed bottom-8 left-6 right-6 z-50 bg-cyan-500 text-slate-950 p-4 rounded-2xl flex items-center gap-4 shadow-2xl animate-in slide-in-from-bottom">
          <RefreshCw className="animate-spin" size={20} />
          <span className="font-bold text-sm uppercase italic">Komut Gönderiliyor: {state.lastExecutedAction}</span>
        </div>
      )}

      {lastError && (
        <div className="fixed bottom-24 left-6 right-6 z-50 bg-red-600 text-white p-4 rounded-2xl flex items-center justify-between shadow-2xl">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} />
            <span className="text-xs font-bold">{lastError}</span>
          </div>
          <button onClick={() => setLastError(null)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
