
import { AutomationStep, ActionType } from "../types";
import { buildAgentUrl } from "./agentUrl";

export class ActionExecutor {
  private static instance: ActionExecutor;

  private constructor() { }

  static getInstance(): ActionExecutor {
    if (!ActionExecutor.instance) {
      ActionExecutor.instance = new ActionExecutor();
    }
    return ActionExecutor.instance;
  }


  async run(steps: AutomationStep[], ip: string, token?: string): Promise<{ success: boolean; error?: string }> {
    if (!ip) return { success: false, error: "Lütfen ayarlardan PC IP adresini girin." };

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      console.log(`[EXECUTING] ${step.type}: ${step.value} (${step.description})`);

      // Local Actions (Processed in Phone/App)
      if (step.type === ActionType.WAIT) {
        const ms = parseInt(step.value) || 1000;
        await new Promise(r => setTimeout(r, ms));
        continue;
      }

      // Network Actions (Sent to PC Agent)
      try {
        const response = await fetch(buildAgentUrl(ip, '/execute'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Nexus-Token': token || ''
          },
          body: JSON.stringify({
            id: step.id,
            type: step.type,
            value: step.value,
            description: step.description
          })
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("AUTH_REQUIRED");
          }
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "PC Agent hatası");
        }

        const body = await response.json().catch(() => ({} as any));
        if (body && body.success === false) {
          return {
            success: false,
            error: `"${step.description}" adımı başarısız: ${body.error ?? 'bilinmeyen hata'}`,
          };
        }

      } catch (err: any) {
        console.error("Command delivery failed:", err);

        if (err.message === "AUTH_REQUIRED") {
          return { success: false, error: "AUTH_REQUIRED" };
        }

        return {
          success: false,
          error: `Bağlantı koptu: "${step.description}" adımı yapılamadı.`
        };
      }

      // Auto-delay for app launches to allow window to focus
      if (step.type === ActionType.LAUNCH_APP) {
        console.log("App launched, waiting for window focus...");
        await new Promise(r => setTimeout(r, 4000)); // 4 seconds grace period
      } else if (i < steps.length - 1) {
        // Small internal cooldown before the next action
        await new Promise(r => setTimeout(r, 200));
      }
    }
    return { success: true };
  }

  async ping(ip: string): Promise<boolean> {
    if (!ip) return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(buildAgentUrl(ip, '/ping'), {
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
