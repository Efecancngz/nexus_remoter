
import { GoogleGenAI, Type } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const systemInstruction = `
    Sen "NEXUS" Windows Otomasyon Uzmanısın. Kullanıcıdan gelen kısa veya uzun komutları teknik Windows adımlarına dönüştürürsün.
    
    KRİTİK KURALLAR:
    1. Reddetme Yok: "Spotifyı aç" veya "youtube" gibi tek kelimelik komutları bile mutlaka eyleme dönüştür.
    2. Varsayılanlar:
       - "Aç" veya sadece "Uygulama Adı" denirse: COMMAND -> "start <app_name>:" (Örn: start spotify:, start steam:)
       - "Web sitesi" veya ".com" denirse: OPEN_URL -> "https://<url>"
    3. Spotify Özel: "Çal" komutu için "start spotify:search:<terim>" protokolünü kullan.
    4. YouTube Özel: "Ara" için "https://www.youtube.com/results?search_query=<terim>" kullan.
    5. Zincirleme: Eğer bir uygulama açılıp sonra tuşa basılacaksa mutlaka araya WAIT (2500ms) ekle.

    ÖRNEK ÇIKTILAR:
    - "spotify aç" -> [{ id: "1", type: "COMMAND", value: "start spotify:", description: "Spotify başlatılıyor" }]
    - "youtube shorts" -> [{ id: "1", type: "OPEN_URL", value: "https://youtube.com/shorts", description: "Shorts açılıyor" }]

    Yanıtın daima geçerli bir JSON dizisi olmalıdır.
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

    const result = JSON.parse(response.text || '[]');
    // Ensure IDs are unique for the new steps
    return result.map((step: any) => ({ ...step, id: Math.random().toString(36).substr(2, 9) }));
  } catch (err) {
    console.error("AI Generation Error:", err);
    return [];
  }
};
