import React, { useState } from 'react';
import { 
  X, Wifi, WifiOff, Shield, Palette, Bot, Database, Info, 
  ChevronRight, RefreshCw, Download, Upload, Trash2, ExternalLink,
  Github, Globe, Monitor
} from 'lucide-react';

interface SettingsPageProps {
  pcIpAddress: string;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  onUpdateIp: (ip: string) => void;
  onDisconnect: () => void;
  onClose: () => void;
  onToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  voiceFeedback: boolean;
  hapticFeedback: boolean;
  countdownDuration: number;
  onUpdateVoiceFeedback: (val: boolean) => void;
  onUpdateHapticFeedback: (val: boolean) => void;
  onUpdateCountdownDuration: (val: number) => void;
}

type SettingsTab = 'connection' | 'appearance' | 'ai' | 'security' | 'data' | 'about';

export default function SettingsPage({
  pcIpAddress, connectionStatus,
  onUpdateIp, onDisconnect, onClose, onToast,
  voiceFeedback, hapticFeedback, countdownDuration,
  onUpdateVoiceFeedback, onUpdateHapticFeedback, onUpdateCountdownDuration
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('connection');
  const [localIp, setLocalIp] = useState(pcIpAddress);

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode; description: string }[] = [
    { id: 'connection', label: 'Bağlantı', icon: <Wifi size={18} />, description: 'IP adresi ve bağlantı durumu' },
    { id: 'security', label: 'Güvenlik', icon: <Shield size={18} />, description: 'PIN kodu ve yetkilendirme' },
    { id: 'appearance', label: 'Görünüm', icon: <Palette size={18} />, description: 'Tema ve arayüz tercihleri' },
    { id: 'ai', label: 'Yapay Zeka', icon: <Bot size={18} />, description: 'Gemini AI ayarları' },
    { id: 'data', label: 'Veri', icon: <Database size={18} />, description: 'Dışa/içe aktarma ve sıfırlama' },
    { id: 'about', label: 'Hakkında', icon: <Info size={18} />, description: 'Versiyon ve proje bilgisi' },
  ];

  const handleSaveConnection = () => {
    onUpdateIp(localIp);
    onToast('Bağlantı ayarları kaydedildi', 'success');
  };

  const handleExport = () => {
    const data = localStorage.getItem('nexus_remote_final_v1');
    if (!data) {
      onToast('Dışa aktarılacak veri bulunamadı', 'warning');
      return;
    }
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast('Veriler başarıyla dışa aktarıldı', 'success');
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          localStorage.setItem('nexus_remote_final_v1', JSON.stringify(data));
          onToast('Veriler içe aktarıldı. Sayfa yenilenecek...', 'success');
          setTimeout(() => location.reload(), 1500);
        } catch {
          onToast('Geçersiz dosya formatı', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleReset = () => {
    if (confirm("Tüm veriler silinecek. Bu işlem geri alınamaz. Emin misiniz?")) {
      localStorage.clear();
      onToast('Tüm veriler silindi. Sayfa yenilenecek...', 'info');
      setTimeout(() => location.reload(), 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950 flex flex-col animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/5 bg-slate-900/60 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black italic tracking-tighter text-white">AYARLAR</h1>
        </div>
        <button onClick={onClose} className="p-3 bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Tab Navigation */}
        <div className="px-4 py-3 flex gap-2 overflow-x-auto border-b border-white/5 scrollbar-hide">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold shrink-0 transition-all ${
                activeTab === tab.id
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'bg-slate-800/50 text-slate-500 border border-transparent hover:text-slate-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6 max-w-lg mx-auto">
          {/* CONNECTION */}
          {activeTab === 'connection' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-2">
                {connectionStatus === 'connected' 
                  ? <Wifi className="text-green-400" size={20} />
                  : <WifiOff className="text-red-400" size={20} />
                }
                <span className={`text-sm font-bold ${connectionStatus === 'connected' ? 'text-green-400' : 'text-red-400'}`}>
                  {connectionStatus === 'connected' ? 'Bağlı' : 'Bağlantı Yok'}
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase">Bilgisayar Yerel IP</label>
                <input
                  type="text"
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-white font-mono focus:ring-2 focus:ring-cyan-500 outline-none transition-all"
                  value={localIp}
                  onChange={e => setLocalIp(e.target.value.trim())}
                  placeholder="Örn: 192.168.1.10"
                />
                <p className="text-[10px] text-slate-600 px-1">
                  Bilgisayarında Nexus Agent'ı başlat ve gösterilen IP adresini buraya gir.
                </p>
              </div>

              <div className="bg-slate-800/30 rounded-2xl p-4 border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 font-bold">Port</span>
                  <span className="text-xs font-mono text-slate-300">8080</span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 font-bold">Protokol</span>
                  <span className="text-xs font-mono text-slate-300">HTTP</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-bold">Polling</span>
                  <span className="text-xs font-mono text-slate-300">1.5 saniye</span>
                </div>
              </div>

              <button
                onClick={handleSaveConnection}
                className="w-full bg-cyan-500 text-slate-950 font-black py-4 rounded-2xl shadow-lg shadow-cyan-500/20 active:scale-95 transition-all"
              >
                KAYDET
              </button>
            </div>
          )}

          {/* SECURITY */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <Shield className="text-amber-400 shrink-0 mt-0.5" size={18} />
                  <div>
                    <p className="text-xs font-bold text-amber-400 mb-1">Oturum Güvenliği</p>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Eşleştirme sırasında Nexus Agent penceresindeki 4 haneli PIN girilir ve
                      cihazına özel bir oturum anahtarı verilir. PIN her başlatmada yenilenir;
                      5 yanlış denemeden sonra 30 saniye kilitleme aktif olur.
                      Agent yeniden başlatılırsa yeniden eşleştirme gerekir.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  onDisconnect();
                  onToast('Oturum sonlandırıldı. Yeniden eşleştirme gerekiyor.', 'info');
                }}
                className="w-full bg-red-500/10 border border-red-500/30 text-red-400 font-black py-4 rounded-2xl active:scale-95 transition-all"
              >
                OTURUMU SONLANDIR & YENİDEN EŞLEŞTİR
              </button>
            </div>
          )}

          {/* APPEARANCE */}
          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div className="bg-slate-800/30 rounded-2xl p-5 border border-white/5 space-y-4">
                <h3 className="text-xs font-black text-slate-400 uppercase">Tema</h3>
                <div className="flex gap-3">
                  <button className="flex-1 bg-slate-900 border-2 border-cyan-500 rounded-2xl p-4 text-center">
                    <div className="w-8 h-8 rounded-full bg-slate-950 mx-auto mb-2 border border-white/10"></div>
                    <span className="text-[10px] font-bold text-cyan-400 uppercase">Koyu</span>
                  </button>
                  <button className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl p-4 text-center opacity-40 cursor-not-allowed">
                    <div className="w-8 h-8 rounded-full bg-white mx-auto mb-2 border border-slate-300"></div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Açık (Yakında)</span>
                  </button>
                </div>
              </div>

              <div className="bg-slate-800/30 rounded-2xl p-5 border border-white/5 space-y-4">
                <h3 className="text-xs font-black text-slate-400 uppercase">Grid Düzeni</h3>
                <p className="text-[10px] text-slate-500">
                  Buton grid düzeni ekran boyutuna göre otomatik ayarlanır (2-6 sütun arası).
                </p>
              </div>
            </div>
          )}

          {/* AI */}
          {activeTab === 'ai' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="bg-slate-800/30 rounded-2xl p-5 border border-white/5 space-y-3">
                <h3 className="text-xs font-black text-slate-400 uppercase">Yapay Zeka Motoru</h3>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300 font-bold">Model</span>
                  <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-3 py-1 rounded-lg">Gemini 2.5 Flash</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300 font-bold">Sıcaklık</span>
                  <span className="text-xs font-mono text-slate-400">0.1 (Deterministik)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300 font-bold">Retry</span>
                  <span className="text-xs font-mono text-slate-400">3 deneme (exponential backoff)</span>
                </div>
              </div>

              {/* Voice Control Settings */}
              <div className="bg-slate-800/30 rounded-2xl p-5 border border-white/5 space-y-4">
                <h3 className="text-xs font-black text-slate-400 uppercase">Sesli Kontrol Ayarları</h3>
                
                {/* Voice Feedback Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-300 font-bold block">Sesli Geri Bildirim (TTS)</span>
                    <span className="text-[10px] text-slate-500">Komut sonuçları sesli olarak okunur.</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={voiceFeedback}
                      onChange={e => onUpdateVoiceFeedback(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500 peer-checked:after:bg-slate-950"></div>
                  </label>
                </div>

                {/* Haptic Feedback Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-300 font-bold block">Titreşim Dönütü (Haptic)</span>
                    <span className="text-[10px] text-slate-500">Mikrofon ve onay anlarında titreşim verir.</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={hapticFeedback}
                      onChange={e => onUpdateHapticFeedback(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500 peer-checked:after:bg-slate-950"></div>
                  </label>
                </div>

                {/* Geri Sayım Süresi Dropdown */}
                <div className="flex flex-col gap-2">
                  <div>
                    <span className="text-sm text-slate-300 font-bold block">Geri Sayım Süresi</span>
                    <span className="text-[10px] text-slate-500">Ses analiz edildikten sonra otomatik çalıştırılma süresi.</span>
                  </div>
                  <select
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-bold text-slate-300 outline-none focus:ring-1 focus:ring-cyan-500"
                    value={countdownDuration}
                    onChange={e => onUpdateCountdownDuration(Number(e.target.value))}
                  >
                    <option value={0}>Devre Dışı (Onay Gerekir)</option>
                    <option value={3}>3 Saniye</option>
                    <option value={5}>5 Saniye</option>
                    <option value={10}>10 Saniye</option>
                  </select>
                </div>
              </div>

              <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <Bot className="text-cyan-400 shrink-0 mt-0.5" size={18} />
                  <div>
                    <p className="text-xs font-bold text-cyan-400 mb-1">Desteklenen Komutlar</p>
                    <ul className="text-[10px] text-slate-400 space-y-1 list-disc ml-3">
                      <li>Uygulama açma (Spotify, Chrome, vb.)</li>
                      <li>URL açma</li>
                      <li>Sistem komutları çalıştırma</li>
                      <li>Tuş basma ve metin yazma</li>
                      <li>Medya kontrolleri</li>
                      <li>Ses seviyesi ayarlama</li>
                      <li>Sistem güç kontrolleri (Kapat, kilitle, uyut)</li>
                      <li>Zamanlama (X dakika sonra Y yap)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DATA */}
          {activeTab === 'data' && (
            <div className="space-y-4">
              <button
                onClick={handleExport}
                className="w-full bg-slate-800 border border-white/5 rounded-2xl p-5 flex items-center justify-between hover:bg-slate-700/50 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <Download className="text-cyan-400" size={20} />
                  <div className="text-left">
                    <span className="text-sm font-bold block text-slate-200">Dışa Aktar</span>
                    <span className="text-[10px] text-slate-500">Buton ve ayarlarını JSON olarak kaydet</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-400" />
              </button>

              <button
                onClick={handleImport}
                className="w-full bg-slate-800 border border-white/5 rounded-2xl p-5 flex items-center justify-between hover:bg-slate-700/50 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <Upload className="text-green-400" size={20} />
                  <div className="text-left">
                    <span className="text-sm font-bold block text-slate-200">İçe Aktar</span>
                    <span className="text-[10px] text-slate-500">Daha önce dışa aktarılan JSON'u yükle</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-400" />
              </button>

              <div className="pt-6 border-t border-white/5">
                <button
                  onClick={handleReset}
                  className="w-full bg-red-500/5 border border-red-500/20 rounded-2xl p-5 flex items-center justify-between hover:bg-red-500/10 transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <Trash2 className="text-red-500" size={20} />
                    <div className="text-left">
                      <span className="text-sm font-bold block text-red-400">Tümünü Sıfırla</span>
                      <span className="text-[10px] text-red-500/60">Tüm verileri sil ve uygulamayı sıfırla</span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-red-800 group-hover:text-red-500" />
                </button>
              </div>
            </div>
          )}

          {/* ABOUT */}
          {activeTab === 'about' && (
            <div className="space-y-6">
              <div className="text-center py-6">
                <h2 className="text-3xl font-black italic tracking-tighter text-white mb-1">NEXUS</h2>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Remote Control</p>
                <div className="mt-3 inline-block bg-cyan-500/10 text-cyan-400 text-xs font-mono font-bold px-4 py-1.5 rounded-full border border-cyan-500/20">
                  v1.0.0
                </div>
              </div>

              <div className="bg-slate-800/30 rounded-2xl p-5 border border-white/5 space-y-3">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Nexus Remote, telefonunuzu yapay zeka destekli bir PC komuta merkezine dönüştürür.
                  Tamamen açık kaynak.
                </p>
              </div>

              <div className="space-y-2">
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-slate-800 border border-white/5 rounded-2xl p-4 flex items-center gap-4 hover:bg-slate-700/50 transition-colors"
                >
                  <Github className="text-slate-400" size={20} />
                  <span className="text-sm font-bold text-slate-300">GitHub</span>
                  <ExternalLink size={14} className="text-slate-600 ml-auto" />
                </a>
              </div>

              <div className="bg-slate-800/30 rounded-2xl p-5 border border-white/5">
                <h3 className="text-xs font-black text-slate-400 uppercase mb-3">Teknolojiler</h3>
                <div className="flex flex-wrap gap-2">
                  {['React', 'TypeScript', 'Vite', 'Tailwind', 'Python', 'Flask', 'Gemini AI'].map(tech => (
                    <span key={tech} className="text-[10px] font-bold bg-slate-700/50 text-slate-400 px-3 py-1.5 rounded-lg border border-white/5">
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
