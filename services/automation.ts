
import { AutomationStep } from "../types";

export class ActionExecutor {
  private static instance: ActionExecutor;
  
  private constructor() {}

  static getInstance(): ActionExecutor {
    if (!ActionExecutor.instance) {
      ActionExecutor.instance = new ActionExecutor();
    }
    return ActionExecutor.instance;
  }

  private sanitizeIp(ip: string): string {
    // IP adresinden http://, https:// ve sondaki / işaretlerini temizle
    return ip.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
  }

  async run(steps: AutomationStep[], ip: string): Promise<{success: boolean; error?: string}> {
    if (!ip) return { success: false, error: "IP Adresi gerekli. Lütfen bilgisayarınızın yerel IP adresini girin." };
    
    const cleanIp = this.sanitizeIp(ip);
    
    for (const step of steps) {
      try {
        const response = await fetch(`http://${cleanIp}:8080/execute`, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(step)
        });
        
        if (!response.ok) throw new Error(`Sunucu Hatası: ${response.status}`);
        
        // Adımlar arası kısa bekleme (PC'nin komutu işlemesi için)
        await new Promise(r => setTimeout(r, 600));
      } catch (err: any) {
        console.error("Adım başarısız:", step.description, err);
        
        let errorDetail = "Bilgisayardaki ajana ulaşılamadı.";
        if (window.location.protocol === 'https:') {
          errorDetail = "Güvenlik Engeli (Mixed Content): Tarayıcı HTTPS üzerinden HTTP isteğine izin vermiyor. Çözüm: Telefonunuzdan bu uygulamayı HTTP üzerinden açın veya PC ajanı için HTTPS tüneli (ngrok vb.) kullanın.";
        }
        
        return { 
          success: false, 
          error: `${step.description} başarısız: ${errorDetail}` 
        };
      }
    }
    return { success: true };
  }

  async ping(ip: string): Promise<boolean> {
    if (!ip) return false;
    const cleanIp = this.sanitizeIp(ip);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://${cleanIp}:8080/ping`, { 
        method: 'GET',
        mode: 'cors',
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const executor = ActionExecutor.getInstance();
