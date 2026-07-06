import React, { useState, useEffect } from 'react';
import { AppState, ControlButton, ActionType, AutomationStep } from './types';
import { executor } from './services/automation';
import { generateMacro, generateMacroFromAudio } from './services/gemini';
import {
  RefreshCw, Gamepad2, Sparkles, Clock, Settings, Shield,
  Wifi, Cpu, Battery, Power, Volume2
} from 'lucide-react';

// Components
import Header from './components/Header';
import MediaControls from './components/MediaControls';
import ButtonGrid from './components/ButtonGrid';
import EditModal from './components/EditModal';
import SchedulerModal from './components/SchedulerModal';
import SettingsPage from './components/SettingsPage';
import ToastContainer from './components/ToastContainer';
import ConnectScreen from './components/ConnectScreen';
import VoiceButton from './components/VoiceButton';
import CommandPreviewModal from './components/CommandPreviewModal';

// Hooks
import { useConnection } from './hooks/useConnection';
import { useToast } from './hooks/useToast';

const STORAGE_KEY = 'nexus_remote_final_v1';
type ActiveTab = 'remote' | 'ai' | 'scheduler' | 'settings';

export default function App() {
  const connection = useConnection();
  const { toasts, addToast, removeToast } = useToast();

  const [activeTab, setActiveTab] = useState<ActiveTab>('remote');
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Automatic migration for old Spotify button configuration
        if (parsed.pages?.[0]?.buttons) {
          parsed.pages[0].buttons = parsed.pages[0].buttons.map((b: any) => {
            if (b.label === 'Spotify' && b.steps?.[0]?.value === 'start spotify:') {
              b.steps[0].type = ActionType.LAUNCH_APP;
              b.steps[0].value = 'spotify';
            }
            return b;
          });
        }
        return { ...parsed, isExecuting: false, connectionStatus: 'disconnected' };
      } catch (e) { console.error("Restore error", e); }
    }
    return {
      currentPageId: 'main',
      pages: [{
        id: 'main',
        name: 'Nexus Remote',
        buttons: [
          { id: '1', label: 'Spotify', color: 'bg-emerald-600', icon: 'MUSIC', steps: [{ id: 's1', type: ActionType.LAUNCH_APP, value: 'spotify', description: 'Spotify başlatılıyor' }] },
          { id: '2', label: 'Youtube', color: 'bg-red-600', icon: 'YOUTUBE', steps: [{ id: 's2', type: ActionType.OPEN_URL, value: 'https://youtube.com', description: 'Youtube açılıyor' }] }
        ]
      }],
      macros: [],
      isEditMode: false,
      isExecuting: false,
      pcIpAddress: '',
      connectionStatus: 'disconnected'
    };
  });

  // UI State
  const [editingBtn, setEditingBtn] = useState<ControlButton | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [previewSteps, setPreviewSteps] = useState<AutomationStep[] | null>(null);

  // Voice Remote settings with localStorage persistence
  const [voiceFeedback, setVoiceFeedback] = useState(() => {
    const saved = localStorage.getItem('nexus_voice_feedback');
    return saved !== null ? saved === 'true' : true;
  });
  const [hapticFeedback, setHapticFeedback] = useState(() => {
    const saved = localStorage.getItem('nexus_haptic_feedback');
    return saved !== null ? saved === 'true' : true;
  });
  const [countdownDuration, setCountdownDuration] = useState(() => {
    const saved = localStorage.getItem('nexus_countdown_duration');
    return saved !== null ? Number(saved) : 5;
  });

  const handleUpdateVoiceFeedback = (val: boolean) => {
    setVoiceFeedback(val);
    localStorage.setItem('nexus_voice_feedback', String(val));
  };
  const handleUpdateHapticFeedback = (val: boolean) => {
    setHapticFeedback(val);
    localStorage.setItem('nexus_haptic_feedback', String(val));
  };
  const handleUpdateCountdownDuration = (val: number) => {
    setCountdownDuration(val);
    localStorage.setItem('nexus_countdown_duration', String(val));
  };

  const triggerHaptic = (pattern: number | number[]) => {
    if (hapticFeedback && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  };

  // Sync connection state
  useEffect(() => {
    setState(s => ({
      ...s,
      connectionStatus: connection.connectionStatus,
      systemStats: connection.systemStats,
      pcIpAddress: connection.pcIpAddress
    }));
  }, [connection.connectionStatus, connection.systemStats, connection.pcIpAddress]);

  // Persist state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Handle pairing from ConnectScreen
  const handlePair = async (ip: string, pin: string) => {
    const res = await connection.pairDevice(ip, pin);
    if (res.success) {
      addToast('🎉 Bilgisayar başarıyla eşleştirildi!', 'success');
    }
    return res;
  };

  // Media handler
  const handleMedia = async (action: ActionType, value: string = '') => {
    if (!connection.pcIpAddress) return;
    try {
      await executor.run(
        [{ id: 'm1', type: action, value, description: 'Medya' }],
        connection.pcIpAddress,
        connection.accessToken
      );
    } catch { }
  };

  // Voice Command Handler
  const handleVoiceCommand = async (base64Audio: string, mimeType: string) => {
    setState(s => ({ ...s, isExecuting: true, lastExecutedAction: 'Ses işleniyor...' }));
    
    if (voiceFeedback && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance("Ses analiz ediliyor...");
      utterance.lang = 'tr-TR';
      window.speechSynthesis.speak(utterance);
    }

    try {
      const steps = await generateMacroFromAudio(base64Audio, mimeType, connection.pcIpAddress, connection.accessToken);
      if (steps && steps.length > 0) {
        const desc = steps[0].description || "Komut planlandı.";
        if (voiceFeedback && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(desc);
          utterance.lang = 'tr-TR';
          window.speechSynthesis.speak(utterance);
        }
        
        addToast(`🎙️ Sesli Komut: "${desc}"`, 'success');
        setPreviewSteps(steps); // Save steps in state to show preview modal
      } else {
        addToast("Sesli komut anlaşılamadı.", 'warning');
        if (voiceFeedback && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance("Üzgünüm, ne dediğinizi anlayamadım.");
          utterance.lang = 'tr-TR';
          window.speechSynthesis.speak(utterance);
        }
      }
    } catch (e: any) {
      addToast(e.message || "Sesli komut işlenirken hata oluştu.", 'error');
      if (voiceFeedback && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance("Sesi analiz ederken hata oluştu.");
        utterance.lang = 'tr-TR';
        window.speechSynthesis.speak(utterance);
      }
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  // Confirm and Execute Voice Command Steps
  const handleConfirmVoiceCommand = async () => {
    if (!previewSteps) return;
    const stepsToRun = previewSteps;
    setPreviewSteps(null); // Close modal
    
    setState(s => ({ ...s, isExecuting: true, lastExecutedAction: stepsToRun[0]?.description || 'Sesli komut...' }));
    try {
      const result = await executor.run(stepsToRun, connection.pcIpAddress, connection.accessToken);
      if (!result.success) {
        triggerHaptic(200); // Vibrate on error: 1 long pulse
        if (result.error === "AUTH_REQUIRED") {
          addToast("⚠️ Oturum geçersiz: Lütfen yeniden eşleştirin!", 'error');
          connection.updateToken('');
        } else {
          addToast(result.error || "Bilinmeyen bir hata oluştu.", 'error');
        }
      } else {
        triggerHaptic([45, 55, 45]); // Vibrate on success: double brief pulse
      }
    } catch (e: any) {
      triggerHaptic(200);
      addToast("Komut yürütülemedi. Bağlantıyı kontrol edin.", 'error');
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  // Volume change handler (update local state immediately)
  const handleVolumeChange = (volume: number) => {
    if (connection.systemStats) {
      connection.setSystemStats({ ...connection.systemStats, volume });
    }
  };

  // Button click handler
  const handleButtonClick = async (btn: ControlButton) => {
    if (state.isEditMode) {
      setEditingBtn(btn);
      return;
    }
    if (!btn.steps.length) return;

    triggerHaptic(35); // Vibrate briefly on button touch/press

    setState(s => ({ ...s, isExecuting: true, lastExecutedAction: btn.label }));
    try {
      const result = await executor.run(btn.steps, connection.pcIpAddress, connection.accessToken);
      if (!result.success) {
        triggerHaptic(200); // Vibrate heavy on error
        if (result.error === "AUTH_REQUIRED") {
          addToast("⚠️ Oturum geçersiz: Lütfen yeniden eşleştirin!", 'error');
          connection.updateToken('');
        } else {
          addToast(result.error || "Bilinmeyen bir hata oluştu.", 'error');
        }
      } else {
        addToast(`✅ ${btn.label} çalıştırıldı`, 'success');
        triggerHaptic([40, 50, 40]); // Vibrate double brief on success
      }
    } catch (e: any) {
      triggerHaptic(200);
      addToast("Bağlantı hatası: Bilgisayar ajanı kapalı veya IP yanlış.", 'error');
    } finally {
      setState(s => ({ ...s, isExecuting: false }));
    }
  };

  // AI Generate handler
  const handleAiGenerate = async () => {
    const promptValue = aiPrompt.trim();
    if (!promptValue || !editingBtn) return;

    setIsAiLoading(true);
    setAiStatus("Zekâ işleniyor...");

    try {
      const newSteps = await generateMacro(promptValue, connection.pcIpAddress, connection.accessToken);

      if (newSteps && newSteps.length > 0) {
        setEditingBtn(prev => {
          if (!prev) return null;
          return { ...prev, steps: [...prev.steps, ...newSteps] };
        });
        setAiPrompt('');
        addToast(`✨ ${newSteps.length} aksiyon oluşturuldu`, 'success');
      } else {
        addToast("AI komutu anlayamadı. Daha açık yazmayı deneyin.", 'warning');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setIsAiLoading(false);
      setAiStatus(null);
    }
  };

  // Save edited button
  const handleSaveButton = (updated: ControlButton) => {
    setState(s => ({
      ...s,
      pages: s.pages.map(p => ({
        ...p,
        buttons: p.buttons.map(b => b.id === updated.id ? updated : b)
      }))
    }));
    setEditingBtn(null);
    addToast('Buton kaydedildi', 'success');
  };

  // Delete button
  const handleDeleteButton = () => {
    if (!editingBtn) return;
    setState(s => ({
      ...s,
      pages: s.pages.map(p => ({
        ...p,
        buttons: p.buttons.filter(b => b.id !== editingBtn.id)
      }))
    }));
    setEditingBtn(null);
    addToast('Buton silindi', 'info');
  };

  // Add new button
  const handleAddButton = () => {
    const b: ControlButton = {
      id: Date.now().toString(),
      label: 'YENİ',
      color: 'bg-slate-800',
      icon: 'DEFAULT',
      steps: []
    };
    setState(s => ({
      ...s,
      pages: s.pages.map(p => ({ ...p, buttons: [...p.buttons, b] }))
    }));
  };

  // Reset app
  const handleReset = () => {
    if (confirm("Tüm veriler sıfırlanacak. Emin misin?")) {
      localStorage.clear();
      location.reload();
    }
  };

  // Check if connection is established. If not, show pairing lock screen.
  const isConnected = connection.connectionStatus === 'connected' && connection.pcIpAddress && connection.accessToken;

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <ConnectScreen
          onPair={handlePair}
          initialIp={connection.pcIpAddress}
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 font-sans relative overflow-x-hidden flex justify-center pb-20">
      {/* Decorative Blur Backgrounds */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Container - Centered and optimized for mobile screens */}
      <div className="w-full max-w-md bg-slate-950/40 backdrop-blur-3xl min-h-screen flex flex-col border-x border-white/5 shadow-2xl relative">

        {/* HEADER */}
        <Header
          connectionStatus={connection.connectionStatus}
          pcIpAddress={connection.pcIpAddress}
          isEditMode={state.isEditMode}
          systemStats={connection.systemStats}
          onToggleEdit={() => setState(s => ({ ...s, isEditMode: !s.isEditMode }))}
          onOpenScheduler={() => setActiveTab('scheduler')}
          onOpenSettings={() => setActiveTab('settings')}
          onOpenConnection={() => setActiveTab('settings')}
        />

        {/* TAB CONTENTS */}
        <div className="flex-1 pb-10">
          {activeTab === 'remote' && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <MediaControls
                systemStats={connection.systemStats}
                onMediaAction={handleMedia}
                onVolumeChange={handleVolumeChange}
              />

              <div className="px-6 flex justify-between items-center mt-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  Hızlı Aksiyonlar
                </span>
                {state.isEditMode && (
                  <span className="text-[10px] font-black text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-md animate-pulse">
                    Düzenleme Modu Aktif
                  </span>
                )}
              </div>

              <ButtonGrid
                buttons={state.pages[0]?.buttons || []}
                isEditMode={state.isEditMode}
                onButtonClick={handleButtonClick}
                onAddButton={handleAddButton}
              />
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="p-6 space-y-6 animate-in slide-in-from-bottom duration-300">
              <div className="flex flex-col items-center text-center gap-2 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <Sparkles size={24} className="animate-pulse" />
                </div>
                <h2 className="text-lg font-black italic tracking-tighter">YAPAY ZEKA KOMUTLARI</h2>
                <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                  Doğal dille komut verin, Gemini sizin için otomatik makrolar ve butonlar üretsin.
                </p>
              </div>

              <div className="bg-slate-900/60 border border-white/5 rounded-3xl p-5 space-y-4 shadow-xl">
                <textarea
                  className="w-full bg-slate-950/80 border border-white/5 rounded-2xl p-4 text-sm outline-none h-32 resize-none placeholder:text-slate-600 focus:border-cyan-500/30 transition-colors"
                  placeholder="Örn: Bilgisayarın sesini kıs, youtube'u aç ve 5 saniye sonra kapat..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                />

                <button
                  onClick={async () => {
                    if (!aiPrompt.trim()) return;
                    setIsAiLoading(true);
                    try {
                      const newSteps = await generateMacro(aiPrompt.trim(), connection.pcIpAddress, connection.accessToken);
                      if (newSteps && newSteps.length > 0) {
                        const newBtn: ControlButton = {
                          id: Date.now().toString(),
                          label: aiPrompt.trim().substring(0, 10).toUpperCase(),
                          color: 'bg-cyan-600',
                          icon: 'DEFAULT',
                          steps: newSteps
                        };
                        setState(s => ({
                          ...s,
                          pages: s.pages.map(p => ({ ...p, buttons: [...p.buttons, newBtn] }))
                        }));
                        setAiPrompt('');
                        addToast(`✨ '${newBtn.label}' butonu oluşturuldu`, 'success');
                        setActiveTab('remote');
                      } else {
                        addToast("Komut anlaşılamadı, lütfen daha açık yazın.", 'warning');
                      }
                    } catch (e: any) {
                      addToast(e.message, 'error');
                    } finally {
                      setIsAiLoading(false);
                    }
                  }}
                  disabled={isAiLoading || !aiPrompt.trim()}
                  className="w-full bg-cyan-500 text-slate-950 font-black py-4 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-40 transition-all shadow-lg shadow-cyan-500/10 active:scale-95"
                >
                  {isAiLoading ? (
                    <>
                      <RefreshCw className="animate-spin" size={18} />
                      Oluşturuluyor...
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      Buton Olarak Kaydet
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'scheduler' && (
            <div className="p-6 space-y-6 animate-in slide-in-from-bottom duration-300">
              <div className="flex flex-col items-center text-center gap-2 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Clock size={24} />
                </div>
                <h2 className="text-lg font-black italic tracking-tighter">ZAMANLAYICI</h2>
                <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                  Belirli bir süre sonra yapılmasını istediğiniz komutu yazarak zamanlayın.
                </p>
              </div>

              <SchedulerModal
                pcIpAddress={connection.pcIpAddress}
                accessToken={connection.accessToken}
                onClose={() => setActiveTab('remote')}
                onToast={addToast}
              />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="animate-in slide-in-from-bottom duration-300">
              <SettingsPage
                pcIpAddress={connection.pcIpAddress}
                connectionStatus={connection.connectionStatus}
                onUpdateIp={connection.updateIp}
                onDisconnect={() => connection.updateToken('')}
                onClose={() => setActiveTab('remote')}
                onToast={addToast}
                voiceFeedback={voiceFeedback}
                hapticFeedback={hapticFeedback}
                countdownDuration={countdownDuration}
                onUpdateVoiceFeedback={handleUpdateVoiceFeedback}
                onUpdateHapticFeedback={handleUpdateHapticFeedback}
                onUpdateCountdownDuration={handleUpdateCountdownDuration}
              />
            </div>
          )}
        </div>

        {/* BOTTOM TAB BAR */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-center p-3 pointer-events-none">
          <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-2xl border border-white/5 rounded-3xl p-2 flex justify-around items-center shadow-[0_10px_30px_rgba(0,0,0,0.8)] pointer-events-auto">
            <button
              onClick={() => setActiveTab('remote')}
              className={`flex flex-col items-center gap-1.5 py-2 px-4 rounded-2xl transition-all ${activeTab === 'remote' ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              <Gamepad2 size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">Kumanda</span>
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              className={`flex flex-col items-center gap-1.5 py-2 px-4 rounded-2xl transition-all ${activeTab === 'ai' ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              <Sparkles size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">Gemini AI</span>
            </button>

            {/* Central Microphone Action Button */}
            <VoiceButton
              onAudioReady={handleVoiceCommand}
              onToast={addToast}
              hapticEnabled={hapticFeedback}
            />

            <button
              onClick={() => setActiveTab('scheduler')}
              className={`flex flex-col items-center gap-1.5 py-2 px-4 rounded-2xl transition-all ${activeTab === 'scheduler' ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              <Clock size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">Planla</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex flex-col items-center gap-1.5 py-2 px-4 rounded-2xl transition-all ${activeTab === 'settings' ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              <Settings size={20} />
              <span className="text-[9px] font-black uppercase tracking-wider">Ayarlar</span>
            </button>
          </div>
        </nav>

        {/* Command Preview Modal */}
        {previewSteps && (
          <CommandPreviewModal
            steps={previewSteps}
            onConfirm={handleConfirmVoiceCommand}
            onCancel={() => setPreviewSteps(null)}
            countdownSeconds={countdownDuration}
          />
        )}

        {/* Edit Modal (Active only when editing a button) */}
        {editingBtn && (
          <EditModal
            button={editingBtn}
            aiPrompt={aiPrompt}
            isAiLoading={isAiLoading}
            aiStatus={aiStatus}
            onAiPromptChange={setAiPrompt}
            onAiGenerate={handleAiGenerate}
            onSave={handleSaveButton}
            onDelete={handleDeleteButton}
            onClose={() => setEditingBtn(null)}
            onReset={handleReset}
          />
        )}

        {/* Global executing state feedback */}
        {state.isExecuting && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-cyan-500 text-slate-950 px-4 py-2.5 rounded-full flex items-center gap-2 shadow-2xl shadow-cyan-500/20 animate-pulse">
            <RefreshCw className="animate-spin text-slate-950" size={14} />
            <span className="font-black text-[9px] uppercase tracking-wider">İŞLENİYOR: {state.lastExecutedAction}</span>
          </div>
        )}

        {/* Toast notifications */}
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </div>
  );
}
