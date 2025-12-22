
import { GoogleGenAI, Type } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  if (!process.env.API_KEY) {
    console.error("API_KEY bulunamadı.");
    return [];
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Bilgisayar otomasyonu için şu isteği JSON adımlara dönüştür: "${prompt}".
      Uygulama isimlerini (chrome, steam, spotify) ve URL'leri kullan.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              type: { type: Type.STRING, enum: Object.values(ActionType) },
              value: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["id", "type", "value", "description"]
          }
        }
      }
    });

    return JSON.parse(response.text || '[]');
  } catch (err) {
    console.error("AI Hatası:", err);
    return [];
  }
};
