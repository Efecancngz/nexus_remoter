
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return [];

  // Daha yüksek kota limitleri için 2.0-flash-exp modeline geçildi
  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-2.0-flash-exp';

  // Önceki çalışan "basit prompt" mantığına geri dönüldü
  const fullPrompt = `Bir bilgisayar otomasyon sistemi için şu isteği teknik adımlara dönüştür: "${prompt}". 
  Sadece geçerli bir JSON dizisi döndür. Örnek çıktı formatı: [{"type": "COMMAND", "value": "start spotify:", "description": "Spotify açılıyor"}]
  
  Kullanabileceğin tipler: ${Object.values(ActionType).join(", ")}`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: fullPrompt,
      config: {
        responseMimeType: "application/json",
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
    // 429 hatasını (Rate Limit) yakalayıp anlamlı bir mesaj fırlatıyoruz
    if (err.status === 429 || err.message?.includes("429")) {
      throw new Error("API kullanım limiti aşıldı. Lütfen 1-2 dakika bekleyip tekrar deneyin.");
    }
    return [];
  }
};
