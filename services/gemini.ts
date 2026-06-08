import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { ActionType, AutomationStep } from "../types";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateMacro = async (
  prompt: string,
  retryCount = 0,
  onRetry?: (count: number, waitTime: number) => void
): Promise<AutomationStep[]> => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    console.error("API Key is missing! Check .env file.");
    throw new Error("API Anahtarı eksik! .env dosyasını kontrol edin.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `Sen NEXUS AI asistanısın. 
    Görevin: Kullanıcı isteğini bilgisayar otomasyon adımlarına çevirmek.
    Önemli: Sadece saf JSON dizisi döndür. Başka açıklama yapma.
    
    Örnekler:
    - "Spotify aç": { type: "LAUNCH_APP", value: "start spotify:", description: "Spotify açılıyor" }
    - "Sesi kapat": { type: "VOLUME_MUTE", value: "true", description: "Ses kapatılıyor" }
    - "Youtube'u aç": { type: "OPEN_URL", value: "https://youtube.com", description: "Youtube açılıyor" }
    - "Whatsapp": { type: "LAUNCH_APP", value: "start whatsapp:", description: "Whatsapp başlatılıyor" }
    - "DeepL aç": { type: "LAUNCH_APP", value: "DeepL", description: "DeepL başlatılıyor" }

    Dikkat: Ardışık işlemlerde (Örn: "Notepad aç ve Merhaba yaz") araya mutlaka bekleme (WAIT) koy.
    Örnek:
    [
      { type: "LAUNCH_APP", value: "notepad", description: "Notepad açılıyor" },
      { type: "WAIT", value: "2000", description: "Pencere bekleniyor" },
      { type: "KEYPRESS", value: "Merhaba dunya", description: "Yazı yazılıyor" }
    ]

    Kullanılabilir Tipler: ${Object.values(ActionType).join(", ")}`
  });

  try {
    const chatSession = model.startChat({
      generationConfig: {
        temperature: 0.1,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              type: { type: SchemaType.STRING, enum: Object.values(ActionType) },
              value: { type: SchemaType.STRING },
              description: { type: SchemaType.STRING }
            },
            required: ["type", "value", "description"]
          }
        }
      },
      history: [],
    });

    const result = await chatSession.sendMessage(prompt);
    const text = result.response.text();

    if (!text) return [];

    const rawSteps = JSON.parse(text);
    return Array.isArray(rawSteps) ? rawSteps.map((step: any) => ({
      ...step,
      id: Math.random().toString(36).substring(2, 11)
    })) : [];

  } catch (err: any) {
    // 429 ve Quota hatası kontrolü
    const isRateLimit = err.response?.status === 429 || err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("RESOURCE_EXHAUSTED");

    if (isRateLimit && retryCount < 3) {
      const waitTime = Math.pow(2, retryCount + 1) * 1000;
      if (onRetry) onRetry(retryCount + 1, waitTime);
      console.warn(`[NEXUS AI] 429 Alındı. Deneme: ${retryCount + 1}. Bekleme: ${waitTime}ms`);
      await sleep(waitTime);
      return generateMacro(prompt, retryCount + 1, onRetry);
    }

    console.error("Gemini Error:", err);
    throw new Error(err.message || "AI yanıt veremedi.");
  }
};

export const generateMacroFromAudio = async (
  base64Audio: string,
  mimeType: string,
  retryCount = 0,
  onRetry?: (count: number, waitTime: number) => void
): Promise<AutomationStep[]> => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) {
    throw new Error("API Anahtarı eksik! .env dosyasını kontrol edin.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `Sen NEXUS AI asistanısın. 
    Görevin: Gelen ses kaydındaki Türkçe komutu dinlemek ve bunu bilgisayar otomasyon adımlarına çevirmek.
    Önemli: Sadece saf JSON dizisi döndür. Başka açıklama yapma.
    
    Örnekler:
    - Sesli komut: "Spotify aç" -> { type: "LAUNCH_APP", value: "start spotify:", description: "Spotify açılıyor" }
    - Sesli komut: "Sesi kapat" -> { type: "VOLUME_MUTE", value: "true", description: "Ses kapatılıyor" }
    - Sesli komut: "Youtube'da rahatlatıcı müzik aç" -> { type: "OPEN_URL", value: "https://www.youtube.com/results?search_query=rahatlatici+muzik", description: "Youtube'da arama yapılıyor" }
    - Sesli komut: "Notepad aç ve Merhaba yaz" -> 
      [
        { type: "LAUNCH_APP", value: "notepad", description: "Notepad açılıyor" },
        { type: "WAIT", value: "2000", description: "Pencere bekleniyor" },
        { type: "KEYPRESS", value: "Merhaba", description: "Yazı yazılıyor" }
      ]

    Kullanılabilir Tipler: ${Object.values(ActionType).join(", ")}`
  });

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64Audio,
                mimeType: mimeType
              }
            },
            {
              text: "Lütfen bu ses kaydını dinle ve komutu bilgisayar otomasyon zincirine dönüştür."
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              type: { type: SchemaType.STRING, enum: Object.values(ActionType) },
              value: { type: SchemaType.STRING },
              description: { type: SchemaType.STRING }
            },
            required: ["type", "value", "description"]
          }
        }
      }
    });

    const text = result.response.text();
    if (!text) return [];

    const rawSteps = JSON.parse(text);
    return Array.isArray(rawSteps) ? rawSteps.map((step: any) => ({
      ...step,
      id: Math.random().toString(36).substring(2, 11)
    })) : [];

  } catch (err: any) {
    const isRateLimit = err.response?.status === 429 || err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("RESOURCE_EXHAUSTED");

    if (isRateLimit && retryCount < 3) {
      const waitTime = Math.pow(2, retryCount + 1) * 1000;
      if (onRetry) onRetry(retryCount + 1, waitTime);
      await sleep(waitTime);
      return generateMacroFromAudio(base64Audio, mimeType, retryCount + 1, onRetry);
    }

    console.error("Gemini Audio Error:", err);
    throw new Error(err.message || "Sesli komut işlenemedi.");
  }
};

export const parseSchedulerPrompt = async (prompt: string): Promise<{ seconds: number, action: AutomationStep } | null> => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) throw new Error("API Key eksik");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `Sen bir ZAMANLAYICI asistanısın.
    Kullanıcı sana "1 saat sonra kapat", "30dk sonra spotifyı durdur" gibi komutlar verecek.
    Senin görevin bunu JSON'a çevirmek.
    
    Çıktı Formatı:
    {
      "seconds": (saniye cinsinden bekleme süresi, number),
      "action": {
         "type": (ActionType enum),
         "value": (komut değeri),
         "description": (kısa açıklama)
      }
    }

    Örnekler:
    - "10 dakika sonra kapat" -> { "seconds": 600, "action": { "type": "COMMAND", "value": "shutdown /s /t 0", "description": "Sistem Kapatılıyor" } }
    - "Yarım saat sonra müziği durdur" -> { "seconds": 1800, "action": { "type": "MEDIA_PLAY_PAUSE", "value": "", "description": "Müzik Durduruluyor" } }
    - "5 dk sonra calc aç" -> { "seconds": 300, "action": { "type": "COMMAND", "value": "calc", "description": "Hesap Makinesi" } }

    ActionType Enum: COMMAND, OPEN_URL, LAUNCH_APP, KEYPRESS, MEDIA_PLAY_PAUSE, MEDIA_NEXT, MEDIA_PREV, VOLUME_SET, VOLUME_MUTE
    `
  });

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error("Scheduler AI Error:", e);
    return null;
  }
};
