
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return [];

  // Gemini 3 Flash Preview: En hızlı ve en yüksek kotalı model
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
        thinkingConfig: { thinkingBudget: 0 }, // Token tasarrufu ve hız için kapalı
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
    console.error("NEXUS AI ERROR:", err);
    
    // 429 hatası genellikle "Rate Limit" yani istek sayısı sınırıdır
    if (err.status === 429 || err.message?.includes("429")) {
      throw new Error("Dakikalık AI isteği sınırına ulaşıldı. Lütfen 20 saniye bekleyip tekrar deneyin.");
    }
    
    // Diğer hatalar (örn: internet yok veya API key geçersiz)
    throw new Error("AI şu an yanıt veremiyor. Lütfen bağlantınızı kontrol edin.");
  }
};
