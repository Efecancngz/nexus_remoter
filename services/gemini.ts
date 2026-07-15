import { AutomationStep } from "../types";
import { buildAgentUrl } from "./agentUrl";

// The Gemini API key now lives on the desktop agent. The client calls the
// agent's token-protected /ai/* proxy routes instead of Google directly, so the
// key is never shipped in the browser bundle.

const withIds = (rawSteps: any): AutomationStep[] =>
  Array.isArray(rawSteps)
    ? rawSteps.map((step: any) => ({
        ...step,
        id: (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)),
      }))
    : [];

async function callAgent(path: string, ip: string, token: string, body: object): Promise<any> {
  const res = await fetch(buildAgentUrl(ip, path), {
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
  } catch (e: any) {
    // An expired/invalid token must reach the UI as a re-pair prompt, not
    // masquerade as "the AI couldn't parse this".
    if (e?.message === "AUTH_REQUIRED") throw e;
    console.error("Scheduler AI Error:", e);
    return null;
  }
};

export const locate = async (
  ip: string,
  token: string,
  description: string
): Promise<{ found: boolean; x_pct?: number; y_pct?: number; image?: string }> => {
  const data = await callAgent('/ai/locate', ip, token, { description });
  return {
    found: !!data.found,
    x_pct: data.x_pct,
    y_pct: data.y_pct,
    image: data.image,
  };
};

export const nextAction = async (
  ip: string,
  token: string,
  goal: string,
  history: { type: string; description: string }[]
): Promise<{ done: boolean; thought?: string; action?: AutomationStep; summary?: string; image?: string }> => {
  const data = await callAgent('/ai/next-action', ip, token, { goal, history });
  if (data.done) {
    return { done: true, summary: data.summary };
  }
  const a = data.action ?? {};
  return {
    done: false,
    thought: data.thought,
    action: {
      id: (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)),
      type: a.type,
      value: a.value,
      description: a.description,
    },
    image: data.image,
  };
};
