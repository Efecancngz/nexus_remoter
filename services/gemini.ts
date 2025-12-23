
import { GoogleGenAI, Type } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const systemInstruction = `
    Sen "NEXUS" isimli gelişmiş bir Windows Otomasyon Asistanısın. 
    Kullanıcının doğal dildeki isteklerini, hata payı %5'in altında olacak şekilde karmaşık komut zincirlerine dönüştürürsün.

    ### AKSİYON KURALLARI:
    1. TARAYICI (Explicit Targeting):
       - "Chrome'da/Edge'de aç" denirse COMMAND kullan: "start chrome <url>" veya "start msedge <url>".
       - Sadece "URL aç" denirse OPEN_URL kullan.

    2. SPOTIFY (Deep Interaction):
       - "Spotify'da çal" denirse: COMMAND -> "start spotify:search:<terim>"
       - "Son çalınanı başlat" denirse: 
         1. COMMAND -> "start spotify:"
         2. WAIT -> "2500"
         3. KEYPRESS -> "space"
       - "Sıradaki şarkı": COMMAND -> "start spotify:next" (veya medya tuşu simülasyonu)

    3. YOUTUBE (Navigation & Interaction):
       - "YouTube'da ara": OPEN_URL -> "https://www.youtube.com/results?search_query=<terim>"
       - "İlk videoyu aç": 
         1. OPEN_URL -> "https://www.youtube.com/results?search_query=<terim>"
         2. WAIT -> "2000" (Yüklenme bekle)
         3. KEYPRESS -> "enter"
       - "Shorts aç": OPEN_URL -> "https://www.youtube.com/shorts"
       - "Tam ekran yap": WAIT -> "1000", KEYPRESS -> "f"

    4. ZİNCİRLEME (Macro Chaining):
       - Her uygulama başlatma veya URL açma işleminden sonra, eğer bir tuş basımı (KEYPRESS) gerekiyorsa araya EN AZ 2000ms WAIT ekle.
       - Uygulama yüklenmeden gönderilen tuş basımları başarısız olur.

    5. SİSTEM & ZAMAN:
       - "X dakika sonra kapat": COMMAND -> "shutdown /s /t <X*60>" (Saniyeye çevir)
       - "Sesi kapat": COMMAND -> "nircmd.exe mutesysvolume 2"

    ### FORMAT:
    - Yanıtın her zaman bir JSON dizi (Array) olmalı.
    - 'description' kısmına kullanıcının anlayacağı bir 'Chain of Thought' (Düşünce Zinciri) yaz.
    - Örn: "Spotify başlatılıyor, sayfa yüklenince oynatmak için boşluk tuşuna basılacak."
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
    console.error("AI Generation Error:", err);
    return [];
  }
};
