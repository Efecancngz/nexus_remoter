
import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType, DashboardPage, AutomationStep } from './types';
import { executor } from './services/automation';
import { generateMacro } from './services/gemini';
import { 
  Plus, Trash2, Cpu, Globe, 
  Gamepad2, Sparkles, X, Save, AlertCircle, 
  RefreshCw, Power, Edit3, ArrowRight, Music, Youtube, Keyboard, Settings
} from 'lucide-react';

const STORAGE_KEY = 'nexus_remote_final_v1';

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...parsed, isExecuting: false, connectionStatus: 'disconnected' };
      } catch (e) { console.error("Restore error", e); }
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
      pcIpAddress: localStorage.getItem('nexus_pc_ip') || '',
      connectionStatus: 'disconnected'
    };
  });

  const [editingBtn, setEditingBtn] = useState<ControlButton | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showIpModal, setShowIpModal] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (state.pcIpAddress) localStorage.setItem('nexus_pc_ip', state.pcIpAddress);
  }, [state]);

  useEffect(() => {
    const checkConn = async () => {
      if (state.pcIpAddress) {
        const ok = await executor.ping(state.pcIpAddress);
        setState(s => ({ ...s, connectionStatus: ok ? 'connected' : 'disconnected' }));
      }
    };
    checkConn();
    const interval = setInterval(checkConn, 15000);
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
      if (!result.success) setLastError(result.error || "Bilinmeyen bir hata oluştu.");
    } catch (e) {
      setLastError("Bağlantı hatası: Bilgisayar ajanı kapalı olabilir.");
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  const handleAiGenerate = async () => {
    const promptValue = aiPrompt.trim();
    if (!promptValue || !editingBtn) return;

    setIsAiLoading(true);
    setLastError(null);
    
    try {
      const newSteps = await generateMacro(promptValue);
      if (newSteps && newSteps.length > 0) {
        setEditingBtn(prev => {
          if (!prev) return null;
          return {
            ...prev,
            steps: [...prev.steps, ...newSteps]
          };
        });
        setAiPrompt('');
      } else {
        setLastError("AI bu komutu eyleme dönüştüremedi.");
      }
    } catch (e: any) {
      // 429 gibi özel hataları yakalayıp kullanıcıya gösteriyoruz
      setLastError(e.message || "AI servisiyle iletişim kurulamadı.");
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
    <div className="min-h-screen bg-slate-950 text-slate-100 select-none pb-24 overflow-x-hidden font-sans">
      <header className="p-5 flex justify-between items-center bg-slate-900/60 sticky top-0 z-40 backdrop-blur-xl border-b border-white/5">
        <div onClick={() => setShowIpModal(true)} className="cursor-pointer group active:opacity-70 transition-opacity">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${state.connectionStatus === 'connected' ? 'bg-green-500 shadow-[0_0_12px_#22c55e]' : 'bg-red-500'}`} />
            <h1 className="text-xl font-black tracking-tighter italic">NEXUS</h1>
          </div>
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">{state.pcIpAddress || 'IP AYARLA'}</span>
        </div>
        <button 
          onClick={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
          className={`px-5 py-2 rounded-full text-[10px] font-black transition-all ${state.isEditMode ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'bg-slate-800 text-slate-400'}`}
        >
          {state.isEditMode ? 'BİTTİ' : 'DÜZENLE'}
        </button>
      </header>

      <main className="p-6 grid grid-cols-2 gap-5">
        {state.pages[0].buttons.map(btn => (
          <button
            key={btn.id}
            onClick={() => handleButtonClick(btn)}
            className={`${btn.color} relative aspect-square rounded-[2.5rem] flex flex-col items-center justify-center gap-2 shadow-2xl active:scale-90 transition-all border border-white/10 group overflow-hidden`}
          >
            <div className="p-4 bg-black/20 rounded-2xl group-hover:scale-110 transition-transform">{getIcon(btn.icon)}</div>
            <span className="font-bold text-[11px] uppercase tracking-widest opacity-90">{btn.label}</span>
            {state.isEditMode && (
              <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center backdrop-blur-sm">
                <Edit3 className="text-cyan-400 animate-pulse" size={32} />
              </div>
            )}
          </button>
        ))}

        {state.isEditMode && (
          <button 
            onClick={() => {
              const b = { id: Date.now().toString(), label: 'YENİ', color: 'bg-slate-800', icon: 'DEFAULT', steps: [] };
              setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: [...p.buttons, b]}))}));
            }}
            className="aspect-square rounded-[2.5rem] border-2 border-dashed border-slate-700 flex items-center justify-center text-slate-500 active:bg-slate-900 transition-colors"
          ><Plus size={40} /></button>
        )}
      </main>

      {editingBtn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/95 backdrop-blur-md animate-in slide-in-from-bottom duration-300">
          <div className="bg-slate-900 w-full max-w-lg rounded-t-[3.5rem] p-8 border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black italic uppercase tracking-tighter text-cyan-400">Yapılandır</h2>
              <button onClick={() => setEditingBtn(null)} className="p-3 bg-slate-800 rounded-full text-slate-400"><X size={24} /></button>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase px-1">Buton İsmi</label>
                <input 
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all"
                  value={editingBtn.label}
                  onChange={e => setEditingBtn({...editingBtn, label: e.target.value})}
                  placeholder="Buton Adı"
                />
              </div>

              <div className="bg-cyan-500/5 border border-cyan-500/20 p-6 rounded-[2.5rem] space-y-4">
                <div className="flex items-center gap-2 text-cyan-400">
                  <Sparkles size={18} className="animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Akıllı Komut (Gemini AI)</span>
                </div>
                <div className="flex gap-3">
                  <textarea 
                    className="flex-1 bg-slate-800/50 border border-slate-700 rounded-2xl p-4 text-sm outline-none h-24 resize-none placeholder:text-slate-600 focus:border-cyan-500/30 transition-colors"
                    placeholder="Örn: spotifyı aç ve tarkan çal..."
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                  />
                  <button 
                    disabled={isAiLoading}
                    onClick={handleAiGenerate}
                    className="bg-cyan-500 text-slate-950 p-5 rounded-2xl self-end active:scale-90 transition-all disabled:opacity-30 disabled:grayscale shadow-lg shadow-cyan-500/20"
                  >
                    {isAiLoading ? <RefreshCw className="animate-spin" /> : <ArrowRight size={24} />}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-500 uppercase px-1">Aksiyon Zinciri ({editingBtn.steps.length})</label>
                <div className="space-y-2">
                  {editingBtn.steps.map((s, idx) => (
                    <div key={s.id} className="bg-slate-800/40 p-4 rounded-2xl flex items-center justify-between border border-white/5 hover:bg-slate-800/60 transition-colors">
                      <div className="flex items-center gap-4">
                        <span className="text-[10px] font-mono text-cyan-500 bg-cyan-500/10 w-6 h-6 flex items-center justify-center rounded-md">{idx + 1}</span>
                        <div className="text-xs font-medium text-slate-300">{s.description}</div>
                      </div>
                      <button onClick={() => setEditingBtn({...editingBtn, steps: editingBtn.steps.filter(x => x.id !== s.id)})} className="text-red-500/40 hover:text-red-500 p-1"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  {editingBtn.steps.length === 0 && (
                    <div className="p-8 text-center border-2 border-dashed border-slate-800 rounded-3xl text-slate-600 text-xs">
                      AI kullanarak veya manuel adım ekleyerek başlayın
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-4 pt-4 sticky bottom-0 bg-slate-900 pb-2">
                <button 
                  onClick={saveChanges} 
                  className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 text-white font-black py-5 rounded-[1.8rem] flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xl shadow-orange-500/20"
                >
                  <Save size={20}/> DEĞİŞİKLİKLERİ KAYDET
                </button>
                <button 
                  onClick={() => {
                    setState(s => ({...s, pages: s.pages.map(p => ({...p, buttons: p.buttons.filter(b => b.id !== editingBtn.id)}))}));
                    setEditingBtn(null);
                  }} 
                  className="bg-red-500/10 text-red-500 px-6 rounded-[1.8rem] hover:bg-red-500/20 active:scale-90 transition-all"
                ><Trash2 /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showIpModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
          <div className="bg-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl border border-white/10">
            <h2 className="text-xl font-black mb-6 italic">PC BAĞLANTISI</h2>
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">Bilgisayar Yerel IP</label>
                <input 
                  type="text" 
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-white font-mono focus:ring-2 focus:ring-cyan-500 outline-none"
                  value={state.pcIpAddress}
                  onChange={e => setState({...state, pcIpAddress: e.target.value.trim()})}
                  placeholder="Örn: 192.168.1.10"
                />
              </div>
              <button 
                onClick={() => setShowIpModal(false)}
                className="w-full bg-cyan-500 text-slate-950 font-black py-4 rounded-2xl shadow-lg shadow-cyan-500/20 active:scale-95 transition-all"
              >
                KAYDET VE KAPAT
              </button>
            </div>
          </div>
        </div>
      )}

      {state.isExecuting && (
        <div className="fixed bottom-6 left-6 right-6 z-50 bg-cyan-500 text-slate-950 p-4 rounded-2xl flex items-center gap-4 shadow-2xl animate-pulse">
          <RefreshCw className="animate-spin" size={20} />
          <span className="font-black text-xs uppercase tracking-tighter">İşleniyor: {state.lastExecutedAction}</span>
        </div>
      )}

      {lastError && (
        <div className="fixed bottom-6 left-6 right-6 z-50 bg-red-600 text-white p-4 rounded-2xl flex items-center justify-between shadow-2xl animate-in slide-in-from-bottom">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} />
            <span className="text-[11px] font-bold leading-tight">{lastError}</span>
          </div>
          <button onClick={() => setLastError(null)} className="p-1 hover:bg-white/10 rounded-lg"><X size={18} /></button>
        </div>
      )}
    </div>
  );
}
