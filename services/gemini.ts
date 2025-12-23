
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return [];

  // Google'ın şu an en stabil ve yüksek kotalı modeli
  const ai = new GoogleGenAI({ apiKey });
  const modelName = 'gemini-3-flash-preview';

  const systemInstruction = `Sen teknik bir asistan olan NEXUS'sun. 
  Görevin: Kullanıcı isteğini teknik adımlara çevirmek.
  Kural 1: Sadece JSON dizisi döndür.
  Kural 2: "aç", "başlat" gibi kelimeler için COMMAND tipini kullan (Örn: "start spotify:").
  Kural 3: Linkler için OPEN_URL tipini kullan.`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 }, // Kota dostu: Düşünme işlemini kapatıyoruz
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
    // 429 hatası durumunda kullanıcıyı bilgilendir
    if (err.status === 429 || err.message?.includes("429")) {
      throw new Error("Google API kotası doldu. Lütfen 60 saniye bekleyip tekrar deneyin.");
    }
    return [];
  }
};
