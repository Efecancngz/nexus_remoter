
import { GoogleGenAI, Type } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  // Gelişmiş Sistem Talimatı
  const systemInstruction = `
    Sen bir Windows Otomasyon Uzmanısısın. Kullanıcının doğal dil isteklerini teknik adımlara dönüştürürsün.
    
    ÖNEMLİ KURALLAR:
    1. TARAYICI: Eğer kullanıcı "Chrome'u aç" veya "Chrome'da X sitesini aç" derse; 
       - Tip: COMMAND
       - Değer: "start chrome https://siteadi.com" (Sadece URL ise "start chrome URL")
       
    2. STEAM: 
       - Kütüphaneyi aç: COMMAND -> "start steam://nav/library"
       - Oyun başlat (ID bilinmiyorsa tahmin et): COMMAND -> "start steam://rungameid/APPID"
       - Mağazayı aç: COMMAND -> "start steam://nav/store"
       
    3. ÖZEL KOMUTLAR:
       - YouTube aç (Özel): COMMAND -> "start chrome https://youtube.com" (Chrome yüklü varsayılır)
       - Bilgisayarı kapat: COMMAND -> "shutdown /s /t 60"
       - Ekranı kilitle: COMMAND -> "rundll32.exe user32.dll,LockWorkStation"

    4. FORMAT: Her adım için benzersiz bir 'id' (örn: s1, s2) üret. 'description' kısmına Türkçe açıklama yaz.
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

    const text = response.text;
    return text ? JSON.parse(text) : [];
  } catch (err) {
    console.error("AI Hatası:", err);
    return [];
  }
};
