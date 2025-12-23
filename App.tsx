
import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType, SavedMacro, AutomationStep } from './types';
import { executor } from './services/automation';
import { generateMacro } from './services/gemini';
import { 
  Settings, Plus, Trash2, Cpu, Globe, 
  Gamepad2, Sparkles, X, Save, AlertCircle, 
  RefreshCw, Power, BookMarked, Download, 
  ArrowRight, Info
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
  macros: [],
  isEditMode: false,
  isExecuting: false,
  pcIpAddress: '',
  connectionStatus: 'offline'
};

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const saved = localStorage.getItem('nexus_v2_state');
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

  useEffect(() => {
    localStorage.setItem('nexus_v2_state', JSON.stringify(state));
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

  const saveStepsAsMacro = () => {
    if (!editingBtn || editingBtn.steps.length === 0) return;
    const newMacro: SavedMacro = {
      id: Date.now().toString(),
      name: `${editingBtn.label} Makrosu`,
      steps: [...editingBtn.steps]
    };
    setState(s => ({ ...s, macros: [...s.macros, newMacro] }));
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
        <div>
          <h1 className="text-xl font-black italic tracking-tighter text-cyan-500">NEXUS</h1>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${state.connectionStatus === 'online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <input 
              className="bg-transparent text-[10px] font-mono border-none outline-none text-slate-500 w-24"
              value={state.pcIpAddress}
              placeholder="IP Girilmedi"
              onChange={e => setState(s => ({...s, pcIpAddress: e.target.value}))}
            />
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

      {/* Error Alert */}
      {lastError && (
        <div className="mx-6 mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top">
          <AlertCircle size={18} className="text-red-500 shrink-0" />
          <p className="text-xs text-red-200 flex-1">{lastError}</p>
          <button onClick={() => setLastError(null)}><X size={14} /></button>
        </div>
      )}

      {/* Main Grid */}
      <div className="p-6 grid grid-cols-2 gap-4">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[2rem] flex flex-col items-center justify-center gap-3 shadow-xl active:scale-95 transition-all border border-white/10 group`}
          >
            <div className="p-3 bg-black/20 rounded-xl backdrop-blur-sm group-active:scale-90 transition-transform">
              {getIcon(btn.icon)}
            </div>
            <span className="font-bold text-[10px] uppercase tracking-widest text-white/90">{btn.label}</span>
            {state.isEditMode && (
              <div className="absolute inset-0 bg-black/40 rounded-[2rem] flex items-center justify-center backdrop-blur-[1px]">
                <Settings size={24} className="text-white opacity-80" />
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
            className="aspect-square rounded-[2rem] border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 gap-2 active:bg-slate-900 transition-colors"
          >
            <Plus size={32} />
            <span className="text-[10px] font-bold uppercase">Buton Ekle</span>
          </button>
        )}
      </div>

      {/* Edit Modal */}
      {editingBtn && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#0f172a] w-full max-w-lg rounded-t-[3rem] sm:rounded-[3rem] p-8 border border-white/5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <div className={`${editingBtn.color} p-3 rounded-2xl`}>{getIcon(editingBtn.icon)}</div>
                <h2 className="text-xl font-bold tracking-tight">DÜZENLE</h2>
              </div>
              <button onClick={() => setEditingBtn(null)} className="p-2 bg-slate-900 rounded-full"><X size={20} /></button>
            </div>

            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-2">İsim</label>
                  <input 
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-cyan-500/50"
                    value={editingBtn.label}
                    onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-2">İkon</label>
                  <select 
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none"
                    value={editingBtn.icon}
                    onChange={e => setEditingBtn({...editingBtn, icon: e.target.value})}
                  >
                    <option value="DEFAULT">CPU</option>
                    <option value="CHROME">WEB</option>
                    <option value="STEAM">OYUN</option>
                    <option value="GAME">SİSTEM</option>
                  </select>
                </div>
              </div>

              {/* AI Macro Input */}
              <div className="bg-slate-950/50 border border-white/5 p-6 rounded-3xl space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-cyan-400" />
                  <span className="text-xs font-bold text-slate-300">Yapay Zeka ile Adım Oluştur</span>
                </div>
                <div className="flex gap-2">
                  <textarea 
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-cyan-500/50 h-20 resize-none"
                    placeholder="Örn: Chrome'u aç ve youtube'a gir..."
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                  />
                  <button 
                    onClick={async () => {
                      const steps = await generateMacro(aiPrompt);
                      if (steps.length > 0) setEditingBtn({...editingBtn, steps: [...editingBtn.steps, ...steps]});
                      setAiPrompt('');
                    }}
                    className="bg-cyan-500 text-slate-950 p-4 rounded-2xl self-end hover:bg-cyan-400 transition-colors"
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
              </div>

              {/* Steps List */}
              <div className="space-y-3">
                <div className="flex justify-between items-center px-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase">Aktif Adımlar</label>
                  {editingBtn.steps.length > 0 && (
                    <button onClick={saveStepsAsMacro} className="text-[10px] font-bold text-cyan-500 flex items-center gap-1">
                      <Download size={12} /> KÜTÜPHANEYE EKLE
                    </button>
                  )}
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  {editingBtn.steps.length === 0 ? (
                    <div className="p-8 border-2 border-dashed border-slate-800 rounded-3xl text-center">
                      <Info size={24} className="mx-auto text-slate-700 mb-2" />
                      <p className="text-xs text-slate-600">Henüz bir adım eklenmedi.</p>
                    </div>
                  ) : (
                    editingBtn.steps.map((step, idx) => (
                      <div key={step.id} className="bg-slate-900 p-4 rounded-2xl flex items-center justify-between border border-white/5">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-slate-600">{idx+1}</span>
                          <div className="text-xs">
                            <div className="font-bold text-slate-300 uppercase">{step.type}</div>
                            <div className="text-slate-500 truncate w-40">{step.value}</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => setEditingBtn({...editingBtn, steps: editingBtn.steps.filter(s => s.id !== step.id)})}
                          className="p-2 text-red-500/50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4 pt-6 border-t border-white/5">
                <button 
                  onClick={saveEditingButton}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black py-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition-all"
                >
                  <Save size={18} /> DEĞİŞİKLİKLERİ KAYDET
                </button>
                <button 
                  onClick={() => {
                    setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: p.buttons.filter(b => b.id !== editingBtn.id)}))}));
                    setEditingBtn(null);
                  }}
                  className="bg-red-500/10 text-red-500 p-4 rounded-2xl hover:bg-red-500/20"
                >
                  <Trash2 size={24} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Macro Library Modal */}
      {showMacros && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-xl animate-in zoom-in-95">
          <div className="bg-slate-900 w-full max-w-md rounded-[3rem] p-8 border border-white/5 shadow-2xl flex flex-col h-[70vh]">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-black italic text-cyan-400">MAKRO KÜTÜPHANESİ</h2>
              <button onClick={() => setShowMacros(false)} className="p-2 bg-slate-800 rounded-full"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              {state.macros.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-4 opacity-50">
                  <BookMarked size={48} />
                  <p className="text-sm font-bold">Kayıtlı makronuz yok.</p>
                </div>
              ) : (
                state.macros.map(macro => (
                  <div key={macro.id} className="bg-slate-800 p-6 rounded-[2rem] border border-white/5 space-y-4">
                    <div className="flex justify-between items-start">
                      <h3 className="font-black text-xs uppercase tracking-widest text-slate-300">{macro.name}</h3>
                      <button 
                        onClick={() => setState(s => ({...s, macros: s.macros.filter(m => m.id !== macro.id)}))}
                        className="text-red-500/30 hover:text-red-500"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-500 line-clamp-2 italic">
                      {macro.steps.map(s => s.description).join(' → ')}
                    </div>
                    {state.isEditMode && editingBtn && (
                      <button 
                        onClick={() => {
                          setEditingBtn({...editingBtn, steps: [...macro.steps.map(s => ({...s, id: Math.random().toString()}))]});
                          setShowMacros(false);
                        }}
                        className="w-full bg-cyan-500 text-slate-950 font-black py-2 rounded-xl text-[10px] uppercase"
                      >
                        Bu Butona Uygula
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Execution HUD */}
      {state.isExecuting && (
        <div className="fixed bottom-10 left-6 right-6 z-40 bg-cyan-500 text-slate-950 p-5 rounded-[2rem] flex items-center justify-between shadow-2xl border border-white/20 animate-in slide-in-from-bottom">
          <div className="flex items-center gap-4">
            <div className="bg-black/10 p-2 rounded-full"><RefreshCw className="animate-spin" size={16} /></div>
            <div>
              <div className="text-[9px] font-black uppercase opacity-60 tracking-tighter leading-none">Yürütülüyor</div>
              <div className="text-sm font-black uppercase italic leading-none">{state.lastExecutedAction}</div>
            </div>
          </div>
          <div className="w-1.5 h-1.5 bg-slate-950 rounded-full animate-ping" />
        </div>
      )}
    </div>
  );
}
