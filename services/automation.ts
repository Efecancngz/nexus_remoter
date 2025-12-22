
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
    return ip.replace(/^https?:\/\//, '').replace(/\/$/, '').split(':')[0].trim();
  }

  async run(steps: AutomationStep[], ip: string): Promise<{success: boolean; error?: string}> {
    if (!ip) return { success: false, error: "IP Adresi gerekli." };
    
    const cleanIp = this.sanitizeIp(ip);
    
    for (const step of steps) {
      try {
        const response = await fetch(`http://${cleanIp}:8080/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(step)
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await new Promise(r => setTimeout(r, 800));
      } catch (err) {
        console.error("Adım hatası:", err);
        return { 
          success: false, 
          error: "Bilgisayara ulaşılamadı. Python ajanının açık olduğundan ve IP adresinin doğruluğundan emin olun." 
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
