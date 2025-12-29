
# 🚀 Nexus Remote Controller

[TR] Nexus Remote, telefonunuzu akıllı bir uzaktan kumandaya dönüştüren, Gemini AI destekli bir PC otomasyon sistemidir.
[EN] Nexus Remote is a Gemini AI-powered PC automation system that turns your smartphone into a smart remote controller.

---

## 🇹🇷 Türkçe Açıklama

### ✨ Özellikler
- **AI Destekli Makro Oluşturma:** "Netflix'i aç ve dizi başlat" gibi doğal dildeki komutları teknik adımlara dönüştürür.
- **Kişiselleştirilebilir Arayüz:** Kendi butonlarınızı oluşturun, renk ve ikon atayın.
- **Gerçek Zamanlı Bağlantı:** Bilgisayarınızla yerel ağ üzerinden düşük gecikmeli iletişim.
- **Akıllı Hata Yönetimi:** Google API kota sınırları (429) için otomatik "Exponential Backoff" (Üstel Bekleme) mekanizması.
- **PWA Desteği:** Telefonunuza uygulama olarak yükleyebilir ve tam ekran kullanabilirsiniz.

### 🛠️ Kurulum

#### 1. Frontend (Telefon Uygulaması)
1. Bu repoyu fork'layın veya kendi GitHub hesabınıza yükleyin.
2. `Settings > Secrets and variables > Actions` kısmına gidin.
3. `New repository secret` oluşturun:
   - **Name:** `API_KEY`
   - **Value:** Gemini API Key (ai.google.dev adresinden ücretsiz alınabilir).
4. Kodunuzu `main` branchine pushladığınızda GitHub Actions uygulamayı otomatik olarak yayınlar. Linki `Settings > Pages` kısmında bulabilirsiniz.

#### 2. PC Agent (Bilgisayar Ajanı)
Bilgisayarınızda komutları çalıştıracak olan sunucuyu kurun:

1. **Gereksinimler:** Python 3.x yüklü olmalıdır.
2. **Kütüphaneler:**
   ```bash
   pip install flask flask-cors
   ```
3. **Çalıştırma:** Aşağıdaki kodu `nexus_agent.py` olarak kaydedin ve çalıştırın:
   ```python
   from flask import Flask, request, jsonify
   from flask_cors import CORS
   import os, webbrowser, subprocess

   app = Flask(__name__)
   CORS(app)

   @app.route('/ping', methods=['GET'])
   def ping(): return jsonify({"status": "ok"}), 200

   @app.route('/execute', methods=['POST'])
   def execute():
       data = request.json
       action_type = data.get('type')
       value = data.get('value')
       
       try:
           if action_type == 'OPEN_URL':
               webbrowser.open(value)
           elif action_type == 'COMMAND':
               os.system(value)
           elif action_type == 'LAUNCH_APP':
               subprocess.Popen(value)
           return jsonify({"success": True}), 200
       except Exception as e:
           return jsonify({"success": False, "error": str(e)}), 500

   if __name__ == '__main__':
       app.run(host='0.0.0.0', port=8080)
   ```

---

## 🇺🇸 English Description

### ✨ Features
- **AI-Powered Macro Generation:** Converts natural language like "Open Spotify and play rock hits" into automation steps.
- **Customizable Interface:** Create your own buttons with custom colors, labels, and icons.
- **Real-time Connectivity:** Low-latency communication with your PC over the local network.
- **Robust Error Handling:** Built-in "Exponential Backoff" mechanism for Google API rate limits (429 errors).
- **PWA Ready:** Install it as a standalone app on your mobile device for a native feel.

### 🛠️ Installation

#### 1. Frontend (Mobile App)
1. Fork or upload this repository to your GitHub account.
2. Go to `Settings > Secrets and variables > Actions`.
3. Create a `New repository secret`:
   - **Name:** `API_KEY`
   - **Value:** Your Gemini API Key.
4. Push to `main` branch, and the app will deploy automatically via GitHub Actions. Find the link in `Settings > Pages`.

#### 2. PC Agent (Local Server)
Set up the command executor on your computer:

1. **Prerequisites:** Python 3.x must be installed.
2. **Dependencies:**
   ```bash
   pip install flask flask-cors
   ```
3. **Running:** Save the Python code provided in the Turkish section above as `nexus_agent.py` and run it:
   ```bash
   python nexus_agent.py
   ```

---

### ⚠️ Important Note / Önemli Not
[TR] Telefonunuz ve bilgisayarınız **aynı Wi-Fi ağına** bağlı olmalıdır. Uygulama ayarlarından bilgisayarınızın yerel IP adresini (örn: 192.168.1.15) girmeyi unutmayın.
[EN] Your phone and PC must be connected to the **same Wi-Fi network**. Don't forget to enter your PC's local IP address (e.g., 192.168.1.15) in the app settings.

### 🤖 AI Limits
[TR] Ücretsiz Gemini API kotası aşıldığında uygulama otomatik olarak bekleyip tekrar dener. Sorun devam ederse 1 dakika bekleyip tekrar deneyin.
[EN] If the free Gemini API quota is exceeded, the app will automatically wait and retry. If the issue persists, please wait 1 minute.
