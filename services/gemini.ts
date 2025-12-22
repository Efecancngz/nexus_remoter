
import { GoogleGenAI, Type } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Bir PC kumanda uygulaması için şu isteği JSON adımlara dök: "${prompt}". 
    Örnek: "Chrome aç youtube.com git" -> [{type: "OPEN_URL", value: "https://youtube.com", description: "Youtube aç"}]`,
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

  try {
    return JSON.parse(response.text);
  } catch {
    return [];
  }
};
