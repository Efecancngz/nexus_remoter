
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

const DEFAULT_PAGE: DashboardPage = {
  id: 'main',
  name: 'Nexus Remote',
  buttons: [
    { 
      id: '1', 
      label: 'Spotify: Play', 
      color: 'bg-green-600', 
      icon: 'MUSIC', 
      steps: [
        { id: 's1', type: ActionType.COMMAND, value: 'start spotify:', description: 'Spotify başlatılıyor' },
        { id: 's2', type: ActionType.WAIT, value: '2000', description: 'Yüklenmesi bekleniyor' },
        { id: 's3', type: ActionType.KEYPRESS, value: 'space', description: 'Oynat tuşuna basılıyor' }
      ] 
    },
    { 
      id: '2', 
      label: 'YouTube: Search', 
      color: 'bg-red-600', 
      icon: 'YOUTUBE', 
      steps: [{ id: 's4', type: ActionType.OPEN_URL, value: 'https://youtube.com/results?search_query=lofi', description: 'Lofi araması açılıyor' }] 
    }
  ]
};

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('nexus_v5_state');
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

  // Sync state
  useEffect(() => {
    localStorage.setItem('nexus_v5_state', JSON.stringify(state));
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
    const interval = setInterval(check, 8000);
    return () => clearInterval(interval);
  }, [state.pcIpAddress]);

  const handleButtonClick = async (btn: ControlButton) => {
    if (state.isEditMode) {
      setEditingBtn(JSON.parse(JSON.stringify(btn)));
      return;
    }
    if (btn.steps.length === 0) {
      setLastError("Aksiyon tanımlanmamış.");
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
      setLastError("AI komutları oluşturamadı. Tekrar deneyin.");
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
      case 'MUSIC': return <Music {...iconProps} />;
      case 'YOUTUBE': return <Youtube {...iconProps} />;
      case 'SYSTEM': return <Power {...iconProps} />;
      default: return <Cpu {...iconProps} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans select-none pb-24">
      {/* Header */}
      <header className="p-6 flex justify-between items-center bg-slate-900/40 sticky top-0 z-30 backdrop-blur-xl border-b border-white/5">
        <div onClick={() => {
          const ip = prompt("PC IP Adresi?", state.pcIpAddress);
          if (ip !== null) setState(s => ({...s, pcIpAddress: ip.trim()}));
        }} className="cursor-pointer">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${state.connectionStatus === 'connected' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]' : 'bg-red-500'}`} />
            <h1 className="text-xl font-black italic text-white tracking-tighter">NEXUS</h1>
          </div>
          <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{state.pcIpAddress || 'Bağlantı Yok'}</span>
        </div>
        <button 
          onClick={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
          className={`px-4 py-2 rounded-full text-[10px] font-black uppercase transition-all shadow-lg ${state.isEditMode ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400'}`}
        >
          {state.isEditMode ? 'KAYDET' : 'DÜZENLE'}
        </button>
      </header>

      {/* Controller Grid */}
      <div className="p-6 grid grid-cols-2 gap-5">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[3rem] flex flex-col items-center justify-center gap-4 shadow-2xl active:scale-95 transition-all border border-white/10 group overflow-hidden`}
          >
            <div className="p-5 bg-black/20 rounded-[2rem] backdrop-blur-md group-hover:scale-110 transition-transform">
              {getIcon(btn.icon, { size: 32 })}
            </div>
            <span className="font-black text-[11px] uppercase tracking-widest text-white/80">{btn.label}</span>
            {state.isEditMode && (
              <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center backdrop-blur-sm">
                <Edit3 size={32} className="text-cyan-400 animate-pulse" />
              </div>
            )}
          </button>
        ))}

        {state.isEditMode && (
          <button 
            onClick={() => {
              const newBtn = { id: Date.now().toString(), label: 'YENİ', color: 'bg-slate-900', icon: 'DEFAULT', steps: [] };
              setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: [...p.buttons, newBtn]}))}));
            }}
            className="aspect-square rounded-[3rem] border-2 border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-700 gap-3 hover:border-slate-600 transition-colors"
          >
            <Plus size={40} />
            <span className="text-[10px] font-bold">EKLE</span>
          </button>
        )}
      </div>

      {/* SMART EDIT PANEL */}
      {editingBtn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/95 backdrop-blur-md">
          <div className="bg-slate-900 w-full max-w-lg rounded-t-[4rem] p-8 border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-10">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 ${editingBtn.color} rounded-2xl flex items-center justify-center`}>
                  {getIcon(editingBtn.icon, { size: 20 })}
                </div>
                <h2 className="text-2xl font-black italic tracking-tighter uppercase">Buton Yapılandırma</h2>
              </div>
              <button onClick={() => setEditingBtn(null)} className="p-3 bg-slate-800 rounded-full text-slate-400"><X size={24} /></button>
            </div>

            <div className="space-y-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-2">Görünür İsim</label>
                  <input 
                    className="w-full bg-slate-800 border border-slate-700 rounded-[1.5rem] p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-500/30"
                    value={editingBtn.label}
                    onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-2">İkon Tipi</label>
                  <select 
                    className="w-full bg-slate-800 border border-slate-700 rounded-[1.5rem] p-4 text-sm outline-none appearance-none"
                    value={editingBtn.icon}
                    onChange={e => setEditingBtn({...editingBtn, icon: e.target.value})}
                  >
                    <option value="DEFAULT">Genel Komut</option>
                    <option value="CHROME">Tarayıcı</option>
                    <option value="STEAM">Oyun</option>
                    <option value="MUSIC">Spotify/Müzik</option>
                    <option value="YOUTUBE">YouTube</option>
                    <option value="SYSTEM">Sistem</option>
                  </select>
                </div>
              </div>

              {/* AI INTELLIGENCE SECTION */}
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-[2.5rem] blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                <div className="relative bg-slate-900 border border-white/10 p-6 rounded-[2.5rem] space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-cyan-400">
                      <Sparkles size={18} />
                      <span className="text-xs font-black uppercase tracking-widest">Nexus AI: Uzman Modu</span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <textarea 
                      className="flex-1 bg-slate-800/50 border border-slate-700 rounded-2xl p-5 text-sm outline-none h-28 resize-none placeholder:text-slate-600"
                      placeholder="Örn: YouTube'da lofi müzik aç, 2 saniye sonra tam ekran yap..."
                      value={aiPrompt}
                      onChange={e => setAiPrompt(e.target.value)}
                    />
                    <button 
                      disabled={isAiLoading}
                      onClick={runAiGeneration}
                      className="bg-cyan-500 text-slate-950 w-20 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)] disabled:opacity-30 active:scale-90 transition-all"
                    >
                      {isAiLoading ? <RefreshCw className="animate-spin" size={28} /> : <ArrowRight size={28} />}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['YouTube', 'Spotify', 'Chrome', 'Shutdown'].map(chip => (
                      <span key={chip} className="text-[9px] bg-slate-800 text-slate-400 px-3 py-1 rounded-full font-bold uppercase">{chip}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* ACTION CHAIN DISPLAY */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Eylem Zinciri ({editingBtn.steps.length})</label>
                  {editingBtn.steps.length > 0 && (
                    <button 
                      onClick={() => setEditingBtn({...editingBtn, steps: []})}
                      className="text-[9px] text-red-500 font-black uppercase"
                    >
                      Tümünü Temizle
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {editingBtn.steps.map((step, idx) => (
                    <div key={step.id} className="bg-slate-800/30 p-5 rounded-3xl flex items-start gap-5 border border-white/5 group">
                      <div className="mt-1 flex flex-col items-center gap-1">
                        <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center text-[10px] font-mono text-cyan-500 border border-cyan-500/20">{idx+1}</div>
                        <div className="w-0.5 h-4 bg-slate-800/50"></div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${step.type === 'WAIT' ? 'bg-orange-500/10 text-orange-400' : 'bg-cyan-500/10 text-cyan-400'}`}>
                            {step.type}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 truncate">{step.value}</span>
                        </div>
                        <p className="text-[11px] text-slate-200 leading-relaxed italic opacity-80">"{step.description}"</p>
                      </div>
                      <button 
                        onClick={() => setEditingBtn({...editingBtn, steps: editingBtn.steps.filter(s => s.id !== step.id)})}
                        className="p-2 text-red-500/40 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                  
                  {editingBtn.steps.length === 0 && (
                    <div className="py-12 border-2 border-dashed border-slate-800 rounded-[3rem] flex flex-col items-center justify-center text-slate-600 gap-3">
                      <Keyboard size={32} />
                      <span className="text-xs font-bold uppercase tracking-widest">Henüz bir eylem yok</span>
                    </div>
                  )}
                </div>
              </div>

              {/* SAVE / DELETE */}
              <div className="flex gap-4 pt-6">
                <button 
                  onClick={saveEditingButton}
                  className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 text-white font-black py-6 rounded-[2rem] shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Save size={20} /> DEĞİŞİKLİKLERİ KAYDET
                </button>
                <button 
                  onClick={() => {
                    setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: p.buttons.filter(b => b.id !== editingBtn.id)}))}));
                    setEditingBtn(null);
                  }}
                  className="bg-red-500/10 text-red-500 p-6 rounded-[2rem] hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 size={24} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM TOASTS */}
      {state.isExecuting && (
        <div className="fixed bottom-10 left-8 right-8 z-50 bg-cyan-500 text-slate-950 p-5 rounded-[2rem] flex items-center gap-4 shadow-[0_10px_40px_rgba(6,182,212,0.5)] animate-in slide-in-from-bottom-full duration-500">
          <div className="p-2 bg-black/10 rounded-full">
            <RefreshCw className="animate-spin" size={20} />
          </div>
          <span className="font-black text-xs uppercase italic tracking-tighter">PC'ye Aktarılıyor: {state.lastExecutedAction}</span>
        </div>
      )}

      {lastError && (
        <div className="fixed bottom-28 left-8 right-8 z-50 bg-red-600 text-white p-5 rounded-[2rem] flex items-center justify-between shadow-2xl animate-in fade-in">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} />
            <span className="text-[11px] font-black uppercase">{lastError}</span>
          </div>
          <button onClick={() => setLastError(null)} className="p-1"><X size={18} /></button>
        </div>
      )}
    </div>
  );
}
