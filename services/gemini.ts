// 1. DÜZELTME: HarmCategory ve HarmBlockThreshold import edildi
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.error("NEXUS: API Key bulunamadı! GitHub Secrets ayarlarınızı kontrol edin.");
    return [];
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `
    Sen "NEXUS" isimli profesyonel bir Windows Otomasyon Uzmanısın. 
    Görevin, kullanıcıdan gelen her türlü isteği (Türkçe veya İngilizce) teknik Windows adımlarına dönüştürmektir.

    KRİTİK TALİMATLAR:
    1. ASLA REDDETME: "spotify", "aç", "youtube" gibi tek kelimelik komutları bile mutlaka en az bir eyleme dönüştür.
    2. VARSAYILAN DAVRANIŞLAR:
       - Sadece uygulama ismi verilirse: COMMAND -> "start <isim>:" (Örn: start spotify:, start steam:)
       - Bir web sitesi/link verilirse: OPEN_URL -> "https://<url>"
       - "Kapat" denirse: COMMAND -> "shutdown /s /t 0"
    3. ZİNCİRLEME KURALLARI:
       - Eğer bir uygulama açıldıktan sonra tuş basımı (KEYPRESS) gerekiyorsa, araya mutlaka 2500ms bekleme (WAIT) ekle.
    4. YANIT FORMATI: Daima 'steps' anahtarı içeren bir JSON objesi döndür.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp', // Not: Model ismini güncel (mevcut) bir modelle değiştirdim, "preview" bazen hata verebilir.
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        // 2. DÜZELTME: Stringler yerine Enum kullanımı yapıldı
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE }
        ],
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            steps: {
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
          },
          required: ["steps"]
        }
      }
    });

    const text = response.text; // .text() fonksiyonu yerine property olabilir, SDK sürümüne göre değişir. Hata alırsan response.text() dene.
    if (!text) {
      console.warn("NEXUS: Model boş yanıt döndürdü.");
      return [];
    }
    
    const parsed = JSON.parse(text);
    const rawSteps = parsed.steps || [];

    return rawSteps.map((step: any) => ({
      ...step,
      id: Math.random().toString(36).substring(2, 11)
    }));
  } catch (err: any) {
    console.error("NEXUS AI Error:", err);
    if (err.message?.includes("API_KEY_INVALID")) {
      alert("API Anahtarınız geçersiz! Lütfen GitHub Secrets ayarlarını kontrol edin.");
    }
    return [];
  }
};