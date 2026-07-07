import React, { useState } from 'react';
import { Clock, Sparkles } from 'lucide-react';
import { parseSchedulerPrompt } from '../services/gemini';
import { buildAgentUrl } from '../services/agentUrl';
import HudPanel from './hud/HudPanel';

interface SchedulerModalProps {
  pcIpAddress: string;
  accessToken: string;
  onClose: () => void;
  onToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export default function SchedulerModal({ pcIpAddress, accessToken, onClose, onToast }: SchedulerModalProps) {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    
    const originalText = prompt;
    setIsLoading(true);
    setPrompt("Zekâ işleniyor...");
    
    try {
      const plan = await parseSchedulerPrompt(originalText, pcIpAddress, accessToken);
      if (plan) {
        const minutes = Math.round(plan.seconds / 60);

        await fetch(buildAgentUrl(pcIpAddress, '/execute'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Nexus-Token': accessToken
          },
          body: JSON.stringify({
            type: 'SCHEDULE_ACTION',
            seconds: plan.seconds,
            action: plan.action
          })
        });
        
        onToast(`✅ ${minutes} dakika sonra: ${plan.action.description}`, 'success');
        onClose();
      } else {
        onToast("AI bu komutu anlayamadı. Lütfen daha açık yazın.", 'error');
        setPrompt(originalText);
      }
    } catch (e: any) {
      if (e?.message === "AUTH_REQUIRED") {
        onToast("⚠️ Oturum geçersiz: Lütfen yeniden eşleştirin!", 'error');
      } else {
        onToast("Hata: " + e.message, 'error');
      }
      setPrompt(originalText);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md animate-in fade-in">
      <HudPanel className="w-full max-w-sm p-8 shadow-2xl">
        <h2 className="text-xl font-display font-black mb-1 flex items-center gap-2">
          <Clock className="text-hud-cyan" /> BOSS MODE
        </h2>
        <p className="text-xs text-slate-500 font-display font-bold mb-6 uppercase tracking-[0.2em]">Zamanlayıcı Asistanı</p>

        <div className="space-y-4">
          <div className="bg-hud-cyan/5 border border-hud-cyan/20 p-4 rounded-sm">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Örn: 1 saat sonra bilgisayarı kapat..."
              className="w-full bg-transparent text-white font-medium text-lg outline-none placeholder:text-slate-600 resize-none h-24"
              disabled={isLoading}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isLoading || !prompt.trim()}
            className="w-full bg-gradient-to-r from-hud-cyan to-hud-gold text-slate-950 font-display font-bold py-4 rounded-sm shadow-lg shadow-hud-cyan/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles size={20} className="text-slate-950" />
            {isLoading ? 'İŞLENİYOR...' : 'EMRİ VER'}
          </button>

          <button
            onClick={onClose}
            className="hud-chip w-full py-2 font-bold text-slate-500 hover:text-white transition-colors"
          >
            İPTAL
          </button>
        </div>
      </HudPanel>
    </div>
  );
}
