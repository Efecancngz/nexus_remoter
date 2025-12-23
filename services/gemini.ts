
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateMacro = async (
  prompt: string, 
  retryCount = 0, 
  onRetry?: (count: number, waitTime: number) => void
): Promise<AutomationStep[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return [];

  // SDK örneğini her denemede tazelemek bazen bağlantı sorunlarını çözer
  const ai = new GoogleGenAI({ apiKey });
  const modelName = 'gemini-3-flash-preview'; 

  const systemInstruction = `Sen NEXUS AI asistanısın. 
  Görevin: Kullanıcı isteğini bilgisayar otomasyon adımlarına çevirmek.
  Önemli: Sadece saf JSON dizisi döndür. Başka açıklama yapma.
  Kullanılabilir Tipler: ${Object.values(ActionType).join(", ")}`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY' as HarmCategory, threshold: HarmBlockThreshold.BLOCK_NONE }
        ],
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: Object.values(ActionType) },
              value: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["type", "value", "description"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];

    const rawSteps = JSON.parse(text);
    return Array.isArray(rawSteps) ? rawSteps.map((step: any) => ({
      ...step,
      id: Math.random().toString(36).substring(2, 11)
    })) : [];

  } catch (err: any) {
    // 429 (Too Many Requests) veya Quota (Kota) hatası kontrolü
    const isRateLimit = err.status === 429 || err.message?.includes("429") || err.message?.includes("quota");
    
    // Maksimum 3 kere dene
    if (isRateLimit && retryCount < 3) {
      // Üstel bekleme (Exponential Backoff): 2s, 4s, 8s
      const waitTime = Math.pow(2, retryCount + 1) * 1000;
      
      // UI'a bilgi gönder
      if (onRetry) onRetry(retryCount + 1, waitTime);
      
      console.warn(`[NEXUS AI] 429 Alındı. Deneme: ${retryCount + 1}. Bekleme: ${waitTime}ms`);
      
      await sleep(waitTime);
      return generateMacro(prompt, retryCount + 1, onRetry);
    }
    
    if (isRateLimit) {
      throw new Error("Google API sınırı aşıldı. Lütfen 30-60 saniye bekleyin.");
    }
    
    throw new Error(err.message || "AI yanıt veremedi.");
  }
};
