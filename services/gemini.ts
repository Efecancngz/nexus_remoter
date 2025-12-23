
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  // Guidelines uyarınca API KEY doğrudan process.env'den alınır
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemInstruction = `
    Sen "NEXUS" isimli profesyonel bir Windows Otomasyon Uzmanısın. 
    Kullanıcıdan gelen isteği teknik Windows adımlarına (JSON dizi formatında) dönüştür.

    EYLEM TİPLERİ:
    - COMMAND: 'start spotify:', 'start chrome https://google.com', 'shutdown /s /t 0'
    - OPEN_URL: 'https://youtube.com', 'https://netflix.com'
    - WAIT: '2000' (milisaniye)
    - KEYPRESS: 'enter', 'space', 'media_play_pause'

    KURALLAR:
    1. ASLA REDDETME: "spotify", "aç", "youtube" gibi tek kelimelik komutları bile mutlaka en az bir eyleme dönüştür.
    2. VARSAYILAN: Eğer sadece bir uygulama adı verilirse COMMAND: "start <isim>:" kullan.
    3. ÇIKTI: Sadece geçerli bir JSON dizisi döndür.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        // Güvenlik filtrelerini kapatıyoruz ki "PC kontrolü" tehlikeli sayılmasın
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
    if (!text) {
      console.error("NEXUS AI: Model boş yanıt döndürdü.");
      return [];
    }

    console.log("NEXUS AI RAW RESPONSE:", text);
    
    const rawSteps = JSON.parse(text);
    if (!Array.isArray(rawSteps)) return [];

    return rawSteps.map((step: any) => ({
      ...step,
      id: Math.random().toString(36).substring(2, 11)
    }));
  } catch (err: any) {
    console.error("NEXUS AI ERROR:", err);
    return [];
  }
};
