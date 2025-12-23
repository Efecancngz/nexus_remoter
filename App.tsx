
import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType, SavedMacro, AutomationStep } from './types';
import { executor } from './services/automation';
import { generateMacro } from './services/gemini';
import { 
  Settings, Plus, Trash2, Cpu, Globe, 
  Gamepad2, Sparkles, X, Save, AlertCircle, 
  RefreshCw, Power, BookMarked, Download, 
  ArrowRight, Info, Edit3
} from 'lucide-react';
import { COLORS } from './constants';

const INITIAL_STATE: AppState = {
  currentPageId: 'main',
  pages: [{
    id: 'main',
    name: 'Nexus Remote',
    buttons: [
      { id: '1', label: 'YouTube (Chrome)', color: 'bg-red-600', icon: 'CHROME', steps: [{ id: 's1', type: ActionType.COMMAND, value: 'start chrome https://youtube.com', description: 'YouTube Chrome ile Aç' }] },
      { id: '2', label: 'Steam Kütüphane', color: 'bg-blue-600', icon: 'STEAM', steps: [{ id: 's2', type: ActionType.COMMAND, value: 'start steam://nav/library', description: 'Steam Kütüphanesini Aç' }] }
    ]
  }],
  macros: [],
  isEditMode: false,
  isExecuting: false,
  pcIpAddress: '',
  connectionStatus: 'offline'
};

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const saved = localStorage.getItem('nexus_v3_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...INITIAL_STATE, ...parsed, connectionStatus: 'offline' };
      }
    } catch (e) {
      console.error("Yükleme Hatası:", e);
    }
    return INITIAL_STATE;
  });

  const [editingBtn, setEditingBtn] = useState<ControlButton | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [showMacros, setShowMacros] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem('nexus_v3_state', JSON.stringify(state));
    const timer = setTimeout(() => checkConnection(), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const checkConnection = async () => {
    if (!state.pcIpAddress) return;
    const online = await executor.ping(state.pcIpAddress);
    setState(s => ({ ...s, connectionStatus: online ? 'online' : 'offline' }));
  };

  const handleButtonClick = async (btn: ControlButton) => {
    if (state.isEditMode) {
      setEditingBtn(JSON.parse(JSON.stringify(btn)));
      return;
    }
    if (btn.steps.length === 0) {
      setLastError("Bu butonun tanımlı bir adımı yok.");
      return;
    }
    setLastError(null);
    setState(s => ({ ...s, isExecuting: true, lastExecutedAction: btn.label }));
    try {
      const result = await executor.run(btn.steps, state.pcIpAddress);
      if (!result.success) setLastError(result.error || "Bağlantı hatası.");
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

  const getIcon = (name: string) => {
    const props = { size: 24, className: "text-white" };
    switch(name) {
      case 'CHROME': return <Globe {...props} />;
      case 'STEAM': return <Gamepad2 {...props} />;
      case 'GAME': return <Power {...props} />;
      default: return <Cpu {...props} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans select-none overflow-x-hidden pb-24">
      {/* Header */}
      <header className="p-6 flex justify-between items-center border-b border-white/5 bg-slate-950/50 sticky top-0 z-30 backdrop-blur-md">
        <div onClick={() => { const ip = prompt("PC IP Adresi?", state.pcIpAddress); if(ip) setState(s => ({...s, pcIpAddress: ip})) }} className="cursor-pointer">
          <h1 className="text-xl font-black italic tracking-tighter text-cyan-500">NEXUS</h1>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${state.connectionStatus === 'online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] font-mono text-slate-500">{state.pcIpAddress || 'IP AYARLA'}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowMacros(!showMacros)}
            className={`p-3 rounded-xl transition-all ${showMacros ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900'}`}
          >
            <BookMarked size={20} />
          </button>
          <button 
            onClick={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
            className={`p-3 rounded-xl transition-all ${state.isEditMode ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-slate-900'}`}
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* Grid */}
      <div className="p-6 grid grid-cols-2 gap-4">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[2.5rem] flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-90 transition-all border border-white/10 group overflow-hidden`}
          >
            <div className="p-4 bg-black/20 rounded-2xl backdrop-blur-sm group-active:scale-95 transition-transform">
              {getIcon(btn.icon)}
            </div>
            <span className="font-bold text-[11px] uppercase tracking-tighter text-white/90">{btn.label}</span>
            {state.isEditMode && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-[2px] animate-in fade-in">
                <Edit3 size={28} className="text-white" />
              </div>
            )}
          </button>
        ))}

        {state.isEditMode && (
          <button 
            onClick={() => {
              const newBtn = { id: Date.now().toString(), label: 'Yeni Komut', color: 'bg-slate-800', icon: 'DEFAULT', steps: [] };
              setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: [...p.buttons, newBtn]}))}));
            }}
            className="aspect-square rounded-[2.5rem] border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-600 gap-2 active:bg-slate-900 transition-all"
          >
            <Plus size={32} />
            <span className="text-[10px] font-bold uppercase">Ekle</span>
          </button>
        )}
      </div>

      {/* Edit Modal */}
      {editingBtn && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in slide-in-from-bottom-10">
          <div className="bg-[#0f172a] w-full max-w-lg rounded-t-[3rem] sm:rounded-[3rem] p-8 border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black tracking-tight text-white italic">DÜZENLE</h2>
              <button onClick={() => setEditingBtn(null)} className="p-2 bg-slate-800 rounded-full"><X size={20} /></button>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <input 
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-bold outline-none focus:border-cyan-500/50"
                  value={editingBtn.label}
                  onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
                  placeholder="Buton Adı"
                />
                <select 
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none"
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
              <div className="bg-slate-950/50 border border-cyan-500/20 p-6 rounded-[2rem] space-y-4 shadow-inner">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Sparkles size={16} />
                  <span className="text-xs font-black uppercase tracking-widest">AI Komut Sihirbazı</span>
                </div>
                <div className="flex gap-2">
                  <textarea 
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-cyan-500/50 h-24 resize-none"
                    placeholder="Örn: Chrome'da youtube aç, sonra steam'den CS2 başlat..."
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                  />
                  <button 
                    disabled={isAiLoading}
                    onClick={runAiGeneration}
                    className="bg-cyan-500 text-slate-950 p-5 rounded-2xl self-end shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50 transition-all"
                  >
                    {isAiLoading ? <RefreshCw className="animate-spin" size={24} /> : <ArrowRight size={24} />}
                  </button>
                </div>
              </div>

              {/* Steps Area */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-500 uppercase px-2">Yapılacak İşlemler ({editingBtn.steps.length})</label>
                <div className="space-y-2">
                  {editingBtn.steps.map((step, idx) => (
                    <div key={step.id} className="bg-slate-900/80 p-4 rounded-2xl flex items-center justify-between border border-white/5 group">
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-mono text-cyan-500/50">0{idx+1}</span>
                        <div className="text-xs">
                          <div className="font-black text-slate-300 uppercase tracking-tighter">{step.type}</div>
                          <div className="text-slate-500 truncate w-48 font-mono">{step.value}</div>
                        </div>
                      </div>
                      <button 
                        onClick={() => setEditingBtn({...editingBtn, steps: editingBtn.steps.filter(s => s.id !== step.id)})}
                        className="p-2 text-red-500/20 group-hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {editingBtn.steps.length === 0 && (
                    <div className="p-10 border-2 border-dashed border-slate-800 rounded-[2rem] text-center text-slate-600">
                      AI kullanarak veya manuel adım ekleyin.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={saveEditingButton}
                  className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={20} /> BUTONU KAYDET
                </button>
                <button 
                  onClick={() => {
                    setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: p.buttons.filter(b => b.id !== editingBtn.id)}))}));
                    setEditingBtn(null);
                  }}
                  className="bg-red-500/10 text-red-500 p-5 rounded-2xl active:bg-red-500/20"
                >
                  <Trash2 size={24} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Execution Alert */}
      {state.isExecuting && (
        <div className="fixed bottom-8 left-6 right-6 z-50 bg-cyan-500 text-slate-950 p-4 rounded-2xl flex items-center gap-4 shadow-2xl animate-in slide-in-from-bottom-10">
          <RefreshCw className="animate-spin" size={20} />
          <span className="font-bold text-sm uppercase italic">PC İşlem Yapıyor: {state.lastExecutedAction}</span>
        </div>
      )}
    </div>
  );
}
