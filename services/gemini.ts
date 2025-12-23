
import { GoogleGenAI, Type } from "@google/genai";
import { ActionType, AutomationStep } from "../types";

export const generateMacro = async (prompt: string): Promise<AutomationStep[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const systemInstruction = `
    Sen bir Windows İşletim Sistemi Otomasyon Mimarı ve Teknik Uzmanısın. 
    Görevin: Kullanıcının doğal dil isteklerini hatasız Windows komut zincirlerine dönüştürmek.
    Hata payın %0 olmalı.

    STRATEJİ REHBERİ:
    1. TARAYICI HEDEFLEME: 
       - Eğer kullanıcı belirli bir tarayıcı adı verirse (örn: "Chrome'da aç"), COMMAND tipini kullan.
       - Komut formatı: "start chrome https://url.com" veya "start msedge https://url.com". 
       - Sadece "URL aç" denirse OPEN_URL tipini kullan (varsayılan tarayıcı için).

    2. STEAM & OYUNLAR (URI PROTOKOLÜ):
       - Steam'i açmak: COMMAND -> "start steam://open/main"
       - Kütüphaneyi açmak: COMMAND -> "start steam://nav/library"
       - Oyunu başlatmak: COMMAND -> "start steam://rungameid/APPID"
       - Popüler ID'ler: CS2: 730, EU4: 236850, Dota2: 570, GTA V: 271590.
       - Eğer oyun ID'sini bilmiyorsan, önce "start steam://nav/library" komutunu ver, sonra WAIT (3000ms) ekle.

    3. ZİNCİRLEME & BEKLEME (WAIT):
       - Bir launcher (Steam, Epic, Battle.net) açıldıktan sonra oyun başlatılacaksa araya mutlaka WAIT ekle.
       - Değer formatı milisaniyedir: "3000" (3 saniye).

    4. ÖZEL KOMUTLAR:
       - Ses kapat/aç: COMMAND -> "nircmd.exe mutesysvolume 2" (NirCmd yüklü varsayılır)
       - Bilgisayarı kapat: COMMAND -> "shutdown /s /t 30"
       - Ekran görüntüsü: COMMAND -> "nircmd.exe savescreenshot screen.png"

    FORMAT:
    - Her zaman bir dizi (Array) döndür.
    - 'description' kısmına neden bu komutu seçtiğini (örn: "Chrome'u zorla açmak için start chrome kullanıldı") Türkçe açıkla.
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
