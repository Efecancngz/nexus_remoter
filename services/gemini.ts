
import { GoogleGenAI, Type } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const systemInstruction = `
    Sen "NEXUS" isimli profesyonel bir Windows Otomasyon Uzmanısın. 
    Kullanıcının her isteğini (kısa veya uzun fark etmez) mutlaka teknik Windows komutlarına dönüştürmelisin.

    KESİN KURALLAR:
    1. ASLA REDDETME: "spotify", "chrome aç" gibi çok kısa promptları bile eyleme dönüştür.
    2. VARSAYILANLAR:
       - Uygulama ismi verilirse: COMMAND -> "start <isim>:" (Örn: start spotify:, start steam:)
       - URL veya site adı verilirse: OPEN_URL -> "https://<site_adi>.com"
    3. ÖZEL DURUMLAR:
       - "Müzik çal" -> COMMAND: "start spotify:search:<terim>" -> WAIT: 2000 -> KEYPRESS: "enter"
       - "Video aç" -> OPEN_URL: "https://youtube.com/results?search_query=<terim>" -> WAIT: 2000 -> KEYPRESS: "enter"
    4. ZİNCİRLEME: KEYPRESS eyleminden önce daima bir WAIT (en az 2000ms) ekle.

    Daima geçerli bir JSON dizisi döndür. 'id' alanı için rastgele bir string kullan.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
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

    const text = response.text;
    if (!text) return [];
    
    const result = JSON.parse(text);
    return result.map((step: any) => ({
      ...step,
      id: Math.random().toString(36).substr(2, 9)
    }));
  } catch (err) {
    console.error("AI Macro Generation Error:", err);
    return [];
  }
};
