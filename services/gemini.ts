
import { GoogleGenAI, Type } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const systemInstruction = `
    Sen "NEXUS" isimli profesyonel bir Windows Otomasyon Uzmanısın.
    Görevin: Kullanıcının isteğini %0 hatayla Windows komut dizilerine dönüştürmek.

    ÖZEL PROTOKOLLER:
    1. SPOTIFY:
       - "Müzik çal/ara": COMMAND -> "start spotify:search:<terim>"
       - "Durdur/Oynat": KEYPRESS -> "space"
       - "Sıradaki": COMMAND -> "start spotify:next"
    
    2. YOUTUBE & TARAYICI:
       - "YouTube'da ara": OPEN_URL -> "https://www.youtube.com/results?search_query=<terim>"
       - "Shorts aç": OPEN_URL -> "https://www.youtube.com/shorts"
       - "İlk videoyu aç": 
          Adım 1: OPEN_URL -> "https://www.youtube.com/results?search_query=<terim>"
          Adım 2: WAIT -> "2500" (Sayfa yüklenme)
          Adım 3: KEYPRESS -> "enter" (İlk videoya tıkla)
       - "Tam ekran": WAIT -> "1000", KEYPRESS -> "f"

    3. SİSTEM:
       - "PC kapat": COMMAND -> "shutdown /s /t 60"
       - "Sesi kapat": COMMAND -> "nircmd.exe mutesysvolume 2"

    KURALLAR:
    - Klavye tuşu (KEYPRESS) göndermeden önce mutlaka WAIT (en az 2000ms) ekle.
    - Her zaman JSON dizi döndür.
    - 'description' kısmına işlemi neden yaptığını Türkçe açıkla.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
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

    return JSON.parse(response.text || '[]');
  } catch (err) {
    console.error("AI Hatası:", err);
    return [];
  }
};
