import { AutomationStep } from "../types";

// The Gemini API key now lives on the desktop agent. The client calls the
// agent's token-protected /ai/* proxy routes instead of Google directly, so the
// key is never shipped in the browser bundle.

const sanitizeIp = (ip: string) => ip.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();

const withIds = (rawSteps: any): AutomationStep[] =>
  Array.isArray(rawSteps)
    ? rawSteps.map((step: any) => ({
        ...step,
        id: (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)),
      }))
    : [];

async function callAgent(path: string, ip: string, token: string, body: object): Promise<any> {
  const cleanIp = sanitizeIp(ip);
  if (!cleanIp) throw new Error("PC IP adresi ayarlı değil.");

  const res = await fetch(`http://${cleanIp}:8080${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nexus-Token': token || '',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("AUTH_REQUIRED");
  if (res.status === 503) throw new Error("AI ajanı yapılandırılmamış. PC'de GEMINI_API_KEY ayarlayın.");
  if (!res.ok || !data.success) throw new Error(data.error || "AI yanıt veremedi.");
  return data;
}

export const generateMacro = async (
  prompt: string,
  ip: string,
  token: string
): Promise<AutomationStep[]> => {
  const data = await callAgent('/ai/macro', ip, token, { prompt });
  return withIds(data.steps);
};

export const generateMacroFromAudio = async (
  base64Audio: string,
  mimeType: string,
  ip: string,
  token: string
): Promise<AutomationStep[]> => {
  const data = await callAgent('/ai/audio', ip, token, { audio: base64Audio, mimeType });
  return withIds(data.steps);
};

export const parseSchedulerPrompt = async (
  prompt: string,
  ip: string,
  token: string
): Promise<{ seconds: number; action: AutomationStep } | null> => {
  try {
    const data = await callAgent('/ai/schedule', ip, token, { prompt });
    return data.plan ?? null;
  } catch (e) {
    console.error("Scheduler AI Error:", e);
    return null;
  }
};
