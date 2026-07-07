import React, { useState } from 'react';
import { Shield, Wifi, Loader2, ArrowRight, ExternalLink } from 'lucide-react';
import { buildAgentUrl, sanitizeIp } from '../services/agentUrl';
import HudPanel from './hud/HudPanel';

interface ConnectScreenProps {
  onPair: (ip: string, pin: string) => Promise<{ success: boolean; error?: string }>;
  initialIp?: string;
  initialPin?: string;
}

export default function ConnectScreen({ onPair, initialIp = '', initialPin = '' }: ConnectScreenProps) {
  const [ip, setIp] = useState(initialIp);
  const [pin, setPin] = useState(initialPin);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // buildAgentUrl throws on an IP that sanitizes to empty (e.g. the user has
  // typed exactly "http://" so far), which must not crash the render.
  const trustUrl = sanitizeIp(ip) ? buildAgentUrl(ip, '/') : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ip.trim()) {
      setError('Lütfen bilgisayarınızın IP adresini girin.');
      return;
    }
    if (pin.length !== 4) {
      setError('PIN kodu 4 haneli olmalıdır.');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await onPair(ip, pin);
    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Bağlantı kurulamadı.');
    }
  };

  return (
    <div className="min-h-screen bg-hud-bg flex flex-col items-center justify-center p-6 text-slate-100 font-sans relative overflow-hidden">
      {/* Arc reactor backdrop */}
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] rounded-full pointer-events-none opacity-40"
        style={{
          background:
            'radial-gradient(circle, transparent 54%, rgb(34 211 238 / 0.25) 55%, transparent 57%), ' +
            'radial-gradient(circle, transparent 40%, rgb(34 211 238 / 0.18) 41%, transparent 43%), ' +
            'radial-gradient(circle, transparent 25%, rgb(34 211 238 / 0.12) 26%, transparent 28%), ' +
            'radial-gradient(circle, rgb(34 211 238 / 0.10) 0%, transparent 18%)',
        }}
      />

      <div className="w-full max-w-sm flex flex-col gap-8 relative z-10">
        {/* Header / Brand */}
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 hud-panel flex items-center justify-center">
            <Shield size={32} className="text-hud-cyan hud-glow" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold tracking-[0.2em] text-slate-100 hud-glow">
              NEXUS REMOTE
            </h1>
            <p className="text-xs font-medium text-slate-400 mt-1 uppercase tracking-widest">
              Güvenli PC Kumandası
            </p>
          </div>
        </div>

        {/* Form Card */}
        <HudPanel className="p-6 shadow-2xl space-y-6">
          <div className="space-y-1 text-center">
            <h2 className="text-base font-bold text-slate-200">Eşleştirme Gerekli</h2>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Bilgisayarınızda çalışan Nexus agent'taki IP adresini ve PIN kodunu girin.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* IP Address Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-display font-black text-hud-cyan/70 uppercase tracking-wider block px-1">
                PC IP ADRESİ
              </label>
              <div className="relative flex items-center">
                <Wifi size={18} className="absolute left-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Örn: 192.168.68.57"
                  className="w-full bg-hud-bg/80 border border-hud-dim rounded-sm py-4 pl-12 pr-4 text-slate-100 font-data text-sm placeholder:text-slate-600 focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 outline-none transition-all"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            {trustUrl && (
              <a
                href={trustUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-hud-cyan/80 hover:text-hud-cyanBright transition-colors py-1"
              >
                <ExternalLink size={12} />
                İlk bağlantı mı? Önce sertifikayı onaylayın
              </a>
            )}

            {/* PIN Code Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-display font-black text-hud-cyan/70 uppercase tracking-wider block px-1">
                GÜVENLİK PIN KODU
              </label>
              <input
                type="text"
                maxLength={4}
                placeholder="0000"
                className="w-full bg-hud-bg/80 border border-hud-dim rounded-sm py-4 text-center font-data font-black text-2xl tracking-[0.5em] text-hud-cyan placeholder:text-slate-700 placeholder:tracking-normal placeholder:text-sm focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 outline-none transition-all"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                disabled={loading}
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-sm p-3 text-center text-xs font-bold animate-shake">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-hud-cyan to-hud-gold text-slate-950 font-display font-bold py-4 rounded-sm flex items-center justify-center gap-2 shadow-lg shadow-hud-cyan/15 active:scale-[0.98] disabled:opacity-50 transition-all text-sm uppercase tracking-[0.15em] hover:brightness-110"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Bağlanıyor...
                </>
              ) : (
                <>
                  Bağlan ve Başlat
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        </HudPanel>

        {/* Helpful Tip */}
        <div className="text-center">
          <span className="text-[10px] text-slate-600 font-medium">
            PC Agent sürümü v1.0.0 • Güvenli Yerel Ağ Bağlantısı
          </span>
        </div>
      </div>
    </div>
  );
}
