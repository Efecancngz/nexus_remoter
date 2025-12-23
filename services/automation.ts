
import { AutomationStep, ActionType } from "../types";

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
    return ip.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
  }

  async run(steps: AutomationStep[], ip: string): Promise<{success: boolean; error?: string}> {
    if (!ip) return { success: false, error: "Lütfen ayarlardan PC IP adresini girin." };
    
    const cleanIp = this.sanitizeIp(ip);
    
    for (const step of steps) {
      console.log(`[EXECUTING] ${step.type}: ${step.value} (${step.description})`);

      // Local Actions (Processed in Phone/App)
      if (step.type === ActionType.WAIT) {
        const ms = parseInt(step.value) || 1000;
        await new Promise(r => setTimeout(r, ms));
        continue;
      }

      // Network Actions (Sent to PC Agent)
      try {
        const response = await fetch(`http://${cleanIp}:8080/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: step.id,
            type: step.type,
            value: step.value,
            description: step.description
          })
        });
        
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "PC Agent hatası");
        }
        
        // Small internal cooldown to prevent OS race conditions
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error("Command delivery failed:", err);
        return { 
          success: false, 
          error: `Bağlantı koptu: "${step.description}" adımı yapılamadı.` 
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
