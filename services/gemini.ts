
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateMacro = async (prompt: string, retryCount = 0): Promise<AutomationStep[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return [];

  const ai = new GoogleGenAI({ apiKey });
  const modelName = 'gemini-3-flash-preview'; // En yüksek kotalı stabil model

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
    console.error(`NEXUS AI ERROR (Deneme ${retryCount + 1}):`, err);
    
    // 429 Hatası veya Kota Sınırı Durumu
    const isRateLimit = err.status === 429 || err.message?.includes("429") || err.message?.includes("quota");
    
    if (isRateLimit && retryCount < 3) {
      // Üstel bekleme: 2s, 4s, 8s bekle ve tekrar dene
      const waitTime = Math.pow(2, retryCount + 1) * 1000;
      console.warn(`${waitTime}ms sonra tekrar deneniyor...`);
      await sleep(waitTime);
      return generateMacro(prompt, retryCount + 1);
    }
    
    if (isRateLimit) {
      throw new Error("Google API kotası kalıcı olarak doldu. Lütfen 1 dakika bekleyin.");
    }
    
    throw new Error("AI şu an yanıt veremiyor. İnternet bağlantınızı kontrol edin.");
  }
};
