# 🇹🇷 Nexus Remote Kontrol Merkezi

![Nexus Remote](https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2070&auto=format&fit=crop)

**Nexus Remote**, telefonunuzu yapay zeka destekli bir PC komuta merkezine dönüştürür. İster sadece kullanın, ister kodlarını inceleyip geliştirin. Tamamen Açık Kaynak (Open Source).

---

## 🏁 Hızlı Başlangıç (Kullanıcılar İçin)
Kodlarla uğraşmak istemiyor musunuz? Sadece uygulamayı kullanmak için:

### 1. 📥 İndir
GitHub sayfasının sağ tarafındaki **[Releases]** kısmından en son sürüm `NexusAgent.exe` dosyasını indirin.

### 2. 🖱️ Çalıştır
İndirdiğiniz `NexusAgent.exe` dosyasını bilgisayarınızda çalıştırın. (Kurulum gerektirmez, direkt çalışır).

### 3. 📱 Bağlan
1.  Telefondan web arayüzüne girin.
2.  Sol üstteki **NEXUS** logosuna tıklayın.
3.  Bilgisayar ekranında gördüğünüz **PIN Kodunu** ve **IP Adresini** telefona girin.
4.  Artık bilgisayarınızı yönetebilirsiniz!

---

## 👨‍💻 Geliştirici Rehberi (Kodlar & Build)
Bu proje açık kaynaktır. Kendi özelliklerinizi ekleyebilir, sistemi baştan yaratabilirsiniz.

### 📂 Proje Yapısı
*   `/nexus_desktop`: Bilgisayarda çalışan Python ajanı (Backend).
*   `/src` (Ana Dizin): React ile yazılmış telefon arayüzü (Frontend).

### 🛠️ Nexus Agent'ı Kaynaktan Çalıştırma
EXE kullanmak yerine Python kodlarını doğrudan çalıştırabilirsiniz:

```bash
# Gereksinimleri yükle
pip install flask flask-cors pyinstaller psutil

# Ajanı başlat
python nexus_desktop/main.py
```

### 📦 Kendi EXE Dosyanızı Oluşturun (Build)
Kodu değiştirdiniz ve arkadaşlarınızla paylaşmak için tekrar EXE yapmak mı istiyorsunuz? İşte sihirli komut:

```bash
cd nexus_desktop
# PyInstaller ile paketle (Tüm modülleri gömerek)
py -m PyInstaller --onefile --noconsole --name "NexusAgent" --paths . --collect-all services --collect-all core --collect-all utils main.py
```
*Oluşan dosya `dist/NexusAgent.exe` klasöründe olacaktır.*

### 🎨 Frontend Geliştirme
Arayüzü değiştirmek isterseniz:
```bash
npm install
npm run dev
```

---
[🏠 Ana Sayfaya Dön](README.md)
